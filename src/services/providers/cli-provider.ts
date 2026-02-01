import { spawn } from 'child_process';
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
    // CLI provider doesn't support images - warn and continue
    if (options?.images && options.images.length > 0) {
      logger.warn('CLI provider does not support images, ignoring image input', {
        imageCount: options.images.length,
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
    });

    const systemPromptWithTools = this.buildToolSystemPrompt(baseSystemPrompt, tools);

    // Build conversation context with escaped role markers
    let context = this.buildConversationContext(conversationHistory);
    context += `\nUser: ${this.escapeRoleMarkers(question)}\n`;

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
      const { text, toolCallRequests } = this.parseResponse(response);

      if (toolCallRequests.length === 0) {
        // No tool calls - this is the final response
        return {
          response: text || 'I apologize, but I was unable to generate a response.',
          toolCalls,
          usage: {
            inputTokens: 0, // CLI doesn't expose token usage
            outputTokens: 0,
          },
        };
      }

      // Check tool call limit
      toolCallCount += toolCallRequests.length;
      if (toolCallCount > this.config.maxToolCalls) {
        logger.warn('Tool call limit reached', { limit: this.config.maxToolCalls });
        return {
          response: `I reached the maximum number of tool calls (${String(this.config.maxToolCalls)}) while investigating. Here's what I found so far:\n\n${text}`,
          toolCalls,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }

      // Execute tool calls
      toolResults = [];
      for (const toolRequest of toolCallRequests) {
        const result = await executeTool(
          toolRequest.id,
          toolRequest.name,
          toolRequest.input,
          userConfig.toolConfig
        );

        toolCalls.push({
          name: toolRequest.name,
          input: toolRequest.input,
          outputPreview: result.content.slice(0, 200),
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
  private parseResponse(response: string): { text: string; toolCallRequests: ToolCallRequest[] } {
    const toolCallRequests: ToolCallRequest[] = [];

    // Match tool_call code blocks
    const toolCallPattern = /```tool_call\s*([\s\S]*?)```/g;
    let match;
    let callIndex = 0;

    while ((match = toolCallPattern.exec(response)) !== null) {
      try {
        const captured = match[1];
        if (!captured) continue;

        const jsonStr = captured.trim();
        const parsed = JSON.parse(jsonStr) as { tool: string; input: Record<string, unknown> };

        if (parsed.tool && typeof parsed.tool === 'string') {
          const toolId = `cli-${String(Date.now())}-${String(callIndex++)}`;
          toolCallRequests.push({
            id: toolId,
            name: parsed.tool,
            input: parsed.input,
          });
        }
      } catch (e) {
        logger.warn('Failed to parse tool call JSON', {
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    // Remove tool_call blocks from response text
    const text = response.replace(toolCallPattern, '').trim();

    return { text, toolCallRequests };
  }

  /**
   * Call Claude CLI and return response
   */
  private callCli(prompt: string, systemPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build args: claude -p "prompt" --model model --print --system-prompt "system" --tools ""
      // IMPORTANT: --tools "" disables all built-in Claude Code tools (Bash, Read, Edit, etc.)
      // This forces Claude to use our custom text-based tool protocol instead
      const args = [
        '-p', prompt,
        '--model', this.config.model,
        '--print',
        '--system-prompt', systemPrompt,
        '--tools', '',
      ];

      logger.debug('Spawning Claude CLI', {
        path: this.config.cliPath,
        model: this.config.model,
      });

      const proc = spawn(this.config.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000, // 2 minute timeout
      });

      // Close stdin to signal EOF - Claude CLI waits for EOF before processing
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
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          // Scrub stderr before logging or returning to prevent secret leakage
          const scrubbedStderr = scrubSensitiveData(stderr);
          logger.error('Claude CLI failed', { code, stderr: scrubbedStderr });
          reject(new Error(`Claude CLI exited with code ${String(code)}: ${scrubbedStderr}`));
        }
      });

      proc.on('error', (err) => {
        // Scrub error message to be safe
        const scrubbedError = scrubSensitiveData(err.message);
        logger.error('Claude CLI spawn error', { error: scrubbedError });
        reject(new Error(`Failed to spawn Claude CLI: ${scrubbedError}`));
      });
    });
  }
}
