import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  TextBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import { getToolSpecs, executeTool } from './tools/index.js';
import type { ToolConfig } from './tools/types.js';
import { buildSystemPrompt } from '../config/prompts.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration for Claude service
 */
export interface ClaudeConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  maxToolCalls: number;
}

/**
 * User-specific configuration
 */
export interface UserConfig {
  systemPromptAddition?: string;
  contextDirContent?: string;
  disabledTools: string[];
  toolConfig: ToolConfig;
}

/**
 * Tool call log entry
 */
export interface ToolCallLog {
  name: string;
  input: Record<string, unknown>;
  outputPreview: string;
}

/**
 * Result from asking Claude
 */
export interface AskResult {
  response: string;
  toolCalls: ToolCallLog[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Simple message for conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Claude AI service with tool use support
 */
export class ClaudeService {
  private client: Anthropic;
  private config: ClaudeConfig;

  constructor(config: ClaudeConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  /**
   * Ask Claude a question with tool access
   */
  async ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig
  ): Promise<AskResult> {
    const toolCalls: ToolCallLog[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallCount = 0;

    // Build messages from conversation history
    const messages: MessageParam[] = this.buildMessages(conversationHistory, question);

    // Get available tools (respecting user's disabled tools)
    const tools = getToolSpecs(userConfig.disabledTools);

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      userAddition: userConfig.systemPromptAddition,
      contextDirContent: userConfig.contextDirContent,
    });

    // Tool use loop with hard iteration limit (defense in depth)
    const MAX_ITERATIONS = 20;
    let iteration = 0;

    while (iteration++ < MAX_ITERATIONS) {
      logger.debug('Calling Claude API', {
        messageCount: messages.length,
        toolCount: tools.length,
      });

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        tools,
        messages,
      });

      // Track usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      logger.debug('Claude API response', {
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
        usage: response.usage,
      });

      // Check if we have tool calls to process
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        // No more tool calls - extract final text response
        const textBlocks = response.content.filter(
          (block): block is TextBlock => block.type === 'text'
        );

        const finalResponse = textBlocks.map(b => b.text).join('\n');

        return {
          response: finalResponse || 'I apologize, but I was unable to generate a response.',
          toolCalls,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      // Check tool call limit
      toolCallCount += toolUseBlocks.length;
      if (toolCallCount > this.config.maxToolCalls) {
        logger.warn('Tool call limit reached', { limit: this.config.maxToolCalls });
        return {
          response: `I reached the maximum number of tool calls (${String(this.config.maxToolCalls)}) while investigating. Here's what I found so far:\n\n${this.extractPartialResponse(response.content)}`,
          toolCalls,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      // Execute tool calls
      const toolResults: ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const result = await executeTool(
          toolBlock.id,
          toolBlock.name,
          toolBlock.input as Record<string, unknown>,
          userConfig.toolConfig
        );

        // Log the tool call
        toolCalls.push({
          name: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          outputPreview: result.content.slice(0, 200),
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: result.toolUseId,
          content: result.content,
          is_error: result.isError,
        });

        logger.debug('Tool executed', {
          tool: toolBlock.name,
          isError: result.isError,
          outputLength: result.content.length,
        });
      }

      // Add assistant response and tool results to messages
      messages.push({
        role: 'assistant',
        content: response.content as ContentBlockParam[],
      });

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    // Safety fallback - should not reach here if loop exits normally
    logger.error('Max iterations reached in tool loop', { iterations: MAX_ITERATIONS });
    return {
      response: 'I was unable to complete the analysis - maximum iterations reached.',
      toolCalls,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    };
  }

  /**
   * Build messages array from conversation history plus new question
   */
  private buildMessages(
    history: ConversationMessage[],
    newQuestion: string
  ): MessageParam[] {
    const messages: MessageParam[] = [];

    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add new question
    messages.push({
      role: 'user',
      content: newQuestion,
    });

    return messages;
  }

  /**
   * Extract any text response from a partial content array
   */
  private extractPartialResponse(content: Anthropic.Messages.ContentBlock[]): string {
    const textBlocks = content.filter(
      (block): block is TextBlock => block.type === 'text'
    );
    return textBlocks.map(b => b.text).join('\n') || 'No partial response available.';
  }
}

// Singleton instance
let claudeService: ClaudeService | null = null;

/**
 * Get or create the Claude service singleton
 */
export function getClaudeService(config: ClaudeConfig): ClaudeService {
  claudeService ??= new ClaudeService(config);
  return claudeService;
}
