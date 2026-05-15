import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getToolSpecs, executeTool } from '../tools/index.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { scrubSensitiveData } from '../../formatters/scrub.js';
import { logger } from '../../utils/logger.js';
import type {
  ClaudeProvider,
  CliProviderConfig,
  UserConfig,
  ConversationMessage,
  AskResult,
  AskOptions,
  ToolCallLog,
} from './types.js';
import {
  truncateConversation,
  getContextStatus,
} from '../../utils/token-estimate.js';

/**
 * Maximum context size in characters to prevent unbounded growth
 * Approximately 100K characters ~ 25K tokens
 */
const MAX_CONTEXT_SIZE = 100000;

/**
 * Tool call request parsed from Claude's response
 */
interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Claude provider using Claude CLI (claude command)
 *
 * This provider shells out to the Claude CLI and implements a manual tool loop.
 * Since the CLI doesn't expose tool use directly, we embed tool specs in the prompt
 * and ask Claude to format tool calls as JSON that we can parse and execute.
 */
export class CliProvider implements ClaudeProvider {
  readonly name = 'cli';

  private config: CliProviderConfig;

  constructor(config: CliProviderConfig) {
    this.config = config;
  }

  /**
   * Ask Claude a question with tool access via CLI
   */
  async ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig,
    options?: AskOptions
  ): Promise<AskResult> {
    // Handle image options
    // CLI provider supports localImagePath (passed to CLI for Read tool)
    // Base64 images are not supported (would need SDK)
    if (options?.images && options.images.length > 0) {
      logger.warn('CLI provider does not support base64 images, use localImagePath instead', {
        imageCount: options.images.length,
      });
    }

    // If localImagePath is provided, validate and prepend file reference to question
    let effectiveQuestion = question;
    if (options?.localImagePath) {
      // Validate path is absolute to prevent directory traversal
      if (!options.localImagePath.startsWith('/')) {
        throw new Error('localImagePath must be an absolute path');
      }
      effectiveQuestion = `Please analyze the image at ${options.localImagePath}\n\n${question}`;
      logger.debug('CLI provider: including local image path in prompt', {
        localImagePath: options.localImagePath,
      });
    }

    const toolCalls: ToolCallLog[] = [];
    let toolCallCount = 0;

    // Get available tools
    const tools = getToolSpecs(userConfig.disabledTools);

    // Build system prompt with tool instructions
    const baseSystemPrompt = buildSystemPrompt({
      userAddition: userConfig.systemPromptAddition,
      contextDirContent: userConfig.contextDirContent,
      githubRepos: userConfig.githubRepos,
      githubDefaultRepo: userConfig.toolConfig.githubRepo,
    });

    const systemPromptWithTools = this.buildToolSystemPrompt(baseSystemPrompt, tools);

    // Truncate conversation history if approaching context window limits.
    // This is a message-level truncation that preserves the first message and most recent
    // exchanges. The char-based MAX_CONTEXT_SIZE guard below in the tool loop is a separate
    // safety net for when tool call outputs cause the serialized context string to grow
    // beyond the pre-loop estimate — percentUsed reflects the pre-tool-call snapshot.
    let contextStatusInfo: AskResult['contextStatus'];
    let effectiveHistory = conversationHistory;

    {
      const truncationResult = truncateConversation(
        conversationHistory,
        systemPromptWithTools,
        this.config.contextWindowTokens,
        this.config.contextTruncationThreshold
      );

      if (truncationResult.truncated) {
        logger.warn('Conversation history truncated to fit context window', {
          originalMessages: conversationHistory.length,
          keptMessages: truncationResult.messages.length,
          removedCount: truncationResult.removedCount,
          estimatedTokens: truncationResult.estimatedTokens,
          contextWindowTokens: this.config.contextWindowTokens,
        });
        effectiveHistory = truncationResult.messages;
      }

      // Check post-truncation status (include the new question in estimate)
      const allMessages: ConversationMessage[] = [
        ...effectiveHistory,
        { role: 'user' as const, content: effectiveQuestion },
      ];
      const status = getContextStatus(
        allMessages,
        systemPromptWithTools,
        this.config.contextWindowTokens,
        this.config.contextWarningThreshold,
        this.config.contextTruncationThreshold
      );

      contextStatusInfo = {
        wasTruncated: truncationResult.truncated,
        removedCount: truncationResult.removedCount,
        percentUsed: status.percentUsed,
        isWarning: status.level === 'warning',
      };
    }

    // Build conversation context with escaped role markers
    let context = this.buildConversationContext(effectiveHistory);
    context += `\nUser: ${this.escapeRoleMarkers(effectiveQuestion)}\n`;

    // Tool loop with iteration limit (defense in depth)
    let iteration = 0;
    let toolResults: { id: string; name: string; result: string; isError: boolean }[] = [];

    while (iteration++ < this.config.maxIterations) {
      // Truncate context if it exceeds max size (keep most recent)
      if (context.length > MAX_CONTEXT_SIZE) {
        logger.warn('Context size exceeded limit, truncating', {
          originalSize: context.length,
          maxSize: MAX_CONTEXT_SIZE,
        });
        context = '... [earlier context truncated] ...\n' + context.slice(-MAX_CONTEXT_SIZE + 50);
      }

      // Build the full prompt including any pending tool results
      const prompt = this.buildPromptWithToolResults(context, toolResults);

      logger.debug('Calling Claude CLI', {
        provider: this.name,
        model: this.config.model,
        iteration,
        promptLength: prompt.length,
      });

      // Call Claude CLI
      const response = await this.callCli(prompt, systemPromptWithTools);

      logger.debug('Claude CLI response', {
        provider: this.name,
        responseLength: response.length,
      });

      // Check for tool calls in the response
      const { text, toolCallRequests, failedParseCount } = this.parseResponse(response);

      if (toolCallRequests.length === 0) {
        // If tool_call blocks were found but failed to parse, append a warning
        let finalText = text || 'I apologize, but I was unable to generate a response.';
        if (failedParseCount > 0) {
          logger.error('Tool call blocks found but failed to parse', { failedParseCount, iteration });
          finalText += `\n\n⚠️ _${String(failedParseCount)} tool call(s) failed to execute due to a parsing error. The action was not completed. Please try again or rephrase the request._`;
        }
        options?.onProgress?.({ type: 'text', text: finalText });
        options?.onProgress?.({ type: 'done' });
        return {
          response: finalText,
          toolCalls,
          usage: {
            inputTokens: 0, // CLI doesn't expose token usage
            outputTokens: 0,
          },
          contextStatus: contextStatusInfo,
        };
      }

      // Check tool call limit
      toolCallCount += toolCallRequests.length;
      if (toolCallCount > this.config.maxToolCalls) {
        logger.warn('Tool call limit reached', { limit: this.config.maxToolCalls });
        const limitText = `I reached the maximum number of tool calls (${String(this.config.maxToolCalls)}) while investigating. Here's what I found so far:\n\n${text}`;
        options?.onProgress?.({ type: 'text', text: limitText });
        options?.onProgress?.({ type: 'done' });
        return {
          response: limitText,
          toolCalls,
          usage: { inputTokens: 0, outputTokens: 0 },
          contextStatus: contextStatusInfo,
        };
      }

      // Execute tool calls
      toolResults = [];
      for (const toolRequest of toolCallRequests) {
        options?.onProgress?.({ type: 'tool_call_start', toolName: toolRequest.name, input: toolRequest.input });

        const startTime = Date.now();
        const result = await executeTool(
          toolRequest.id,
          toolRequest.name,
          toolRequest.input,
          userConfig.toolConfig
        );
        const durationMs = Date.now() - startTime;

        options?.onProgress?.({
          type: 'tool_call_end',
          toolName: toolRequest.name,
          output: result.content.slice(0, 500),
          durationMs,
          isError: result.isError ?? false,
        });

        toolCalls.push({
          name: toolRequest.name,
          input: toolRequest.input,
          outputPreview: result.content.slice(0, 200),
          durationMs,
          isError: result.isError ?? false,
        });

        toolResults.push({
          id: toolRequest.id,
          name: toolRequest.name,
          result: result.content,
          isError: result.isError ?? false,
        });

        logger.debug('Tool executed', {
          tool: toolRequest.name,
          isError: result.isError,
          outputLength: result.content.length,
        });
      }

      // Update context with assistant response and tool results for next iteration
      context += `\nAssistant: ${response}\n`;
    }

    // Safety fallback
    logger.error('Max iterations reached in CLI tool loop', { iterations: this.config.maxIterations });
    return {
      response: 'I was unable to complete the analysis - maximum iterations reached.',
      toolCalls,
      usage: { inputTokens: 0, outputTokens: 0 },
      contextStatus: contextStatusInfo,
    };
  }

  /**
   * Build system prompt that includes tool specifications
   */
  private buildToolSystemPrompt(basePrompt: string, tools: unknown[]): string {
    const toolInstructions = `
## Tool Usage

You have access to the following tools. When you need to use a tool, output a JSON block like this:

\`\`\`tool_call
{
  "tool": "tool_name",
  "input": { "param1": "value1" }
}
\`\`\`

You can make multiple tool calls in a single response. After tool results are provided, continue your analysis.

When you have enough information to answer, provide your final response WITHOUT any tool_call blocks.

### Available Tools

${JSON.stringify(tools, null, 2)}

---

`;

    return toolInstructions + basePrompt;
  }

  /**
   * Build conversation context from history with role markers escaped
   */
  private buildConversationContext(history: ConversationMessage[]): string {
    if (history.length === 0) return '';

    return history
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${this.escapeRoleMarkers(msg.content)}`)
      .join('\n\n');
  }

  /**
   * Escape role markers in user input to prevent conversation format injection
   * Replaces "User:" and "Assistant:" at line starts with escaped versions
   */
  private escapeRoleMarkers(text: string): string {
    return text
      .replace(/^User:/gm, '[User]:')
      .replace(/^Assistant:/gm, '[Assistant]:');
  }

  /**
   * Build prompt with tool results from previous iteration
   */
  private buildPromptWithToolResults(
    context: string,
    toolResults: { id: string; name: string; result: string; isError: boolean }[]
  ): string {
    if (toolResults.length === 0) {
      return context;
    }

    let toolResultsSection = '\n\n## Tool Results\n\n';
    for (const result of toolResults) {
      toolResultsSection += `### ${result.name} (${result.id})\n`;
      if (result.isError) {
        toolResultsSection += `**Error:**\n`;
      }
      toolResultsSection += `\`\`\`\n${result.result}\n\`\`\`\n\n`;
    }
    toolResultsSection += 'Please continue your analysis based on these results.\n';

    return context + toolResultsSection;
  }

  /**
   * Parse response for text and tool call requests
   */
  private parseResponse(response: string): { text: string; toolCallRequests: ToolCallRequest[]; failedParseCount: number } {
    const toolCallRequests: ToolCallRequest[] = [];
    let callIndex = 0;
    let failedParseCount = 0;
    let cleanedResponse = response;

    // Extract tool_call blocks by finding the JSON object via bracket matching.
    // This avoids the regex non-greedy match issue where nested code fences
    // (triple backticks inside the JSON body field) cause premature termination.
    const marker = '```tool_call';
    let searchFrom = 0;

    let blockStart = cleanedResponse.indexOf(marker, searchFrom);
    while (blockStart !== -1) {

      // Find the opening brace of the JSON object
      const jsonStart = cleanedResponse.indexOf('{', blockStart + marker.length);
      if (jsonStart === -1) { searchFrom = blockStart + marker.length; continue; }

      // Find the matching closing brace using bracket counting
      let depth = 0;
      let inString = false;
      let escaped = false;
      let jsonEnd = -1;

      for (let i = jsonStart; i < cleanedResponse.length; i++) {
        const ch = cleanedResponse[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) { jsonEnd = i; break; }
        }
      }

      if (jsonEnd === -1) { searchFrom = blockStart + marker.length; continue; }

      const jsonStr = cleanedResponse.substring(jsonStart, jsonEnd + 1);

      try {
        const parsed = JSON.parse(jsonStr) as { tool: string; input: Record<string, unknown> };

        if (parsed.tool && typeof parsed.tool === 'string') {
          const toolId = `cli-${String(Date.now())}-${String(callIndex++)}`;
          toolCallRequests.push({
            id: toolId,
            name: parsed.tool,
            input: parsed.input,
          });
        }

        // Remove the entire tool_call block (from marker to closing ```)
        const closingBackticks = cleanedResponse.indexOf('```', jsonEnd + 1);
        const blockEnd = closingBackticks !== -1 ? closingBackticks + 3 : jsonEnd + 1;
        cleanedResponse = cleanedResponse.substring(0, blockStart) + cleanedResponse.substring(blockEnd);
        // Don't advance searchFrom — the splice shifted content backward
      } catch (e) {
        failedParseCount++;
        logger.warn('Failed to parse tool call JSON from bracket-matched block', {
          error: e instanceof Error ? e.message : 'Unknown error',
          jsonLength: jsonStr.length,
        });
        searchFrom = blockStart + marker.length;
      }
      blockStart = cleanedResponse.indexOf(marker, searchFrom);
    }

    return { text: cleanedResponse.trim(), toolCallRequests, failedParseCount };
  }

  /**
   * Call Claude CLI and return response
   *
   * Prompt is written to stdin and system prompt to a temp file to avoid
   * hitting the OS ARG_MAX limit (~2MB) on long conversations.
   */
  private callCli(prompt: string, systemPrompt: string): Promise<string> {
    // Write system prompt to temp file to keep args small
    const tmpFile = join(tmpdir(), `claude-sp-${randomBytes(8).toString('hex')}.txt`);
    writeFileSync(tmpFile, systemPrompt, { encoding: 'utf-8', mode: 0o600 });

    return new Promise<string>((resolve, reject) => {
      // IMPORTANT: --tools "" disables all built-in Claude Code tools (Bash, Read, Edit, etc.)
      // This forces Claude to use our custom text-based tool protocol instead
      // Prompt is piped via stdin; system prompt read from temp file
      const args = [
        '--print',
        '--model', this.config.model,
        '--system-prompt-file', tmpFile,
        '--tools', '',
      ];

      logger.debug('Spawning Claude CLI', {
        path: this.config.cliPath,
        model: this.config.model,
        promptLength: prompt.length,
      });

      const proc = spawn(this.config.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.config.cliTimeoutMs,
      });

      // Write prompt to stdin and signal EOF so CLI processes it
      proc.stdin.write(prompt);
      proc.stdin.end();

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        this.cleanupTmpFile(tmpFile);
        if (code === 0) {
          resolve(stdout.trim());
        } else if (code === 143) {
          // Exit code 143 = SIGTERM, typically means the process was killed by timeout
          logger.error('Claude CLI timed out (exit code 143)', {
            code,
            timeoutMs: this.config.cliTimeoutMs,
          });
          reject(new Error(
            'Claude took too long to respond. Try a simpler question or increase CLAUDE_CLI_TIMEOUT_MS.'
          ));
        } else {
          const scrubbedStderr = scrubSensitiveData(stderr);
          logger.error('Claude CLI failed', { code, stderr: scrubbedStderr });
          reject(new Error(`Claude CLI exited with code ${String(code)}: ${scrubbedStderr}`));
        }
      });

      proc.on('error', (err) => {
        this.cleanupTmpFile(tmpFile);
        const scrubbedError = scrubSensitiveData(err.message);
        logger.error('Claude CLI spawn error', { error: scrubbedError });
        reject(new Error(`Failed to spawn Claude CLI: ${scrubbedError}`));
      });
    });
  }

  /**
   * Best-effort cleanup of temp file
   */
  private cleanupTmpFile(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch {
      logger.warn('Failed to clean up temp file', { path: filePath });
    }
  }
}
