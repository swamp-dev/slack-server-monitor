import Anthropic from '@anthropic-ai/sdk';
import { getToolSpecs, executeTool } from '../tools/index.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { logger } from '../../utils/logger.js';
import type {
  ClaudeProvider,
  SdkProviderConfig,
  UserConfig,
  ConversationMessage,
  AskResult,
  AskOptions,
  ToolCallLog,
} from './types.js';
import type { ToolSpec } from '../tools/types.js';

/**
 * Map our ToolSpec to Anthropic's tool format
 */
function toAnthropicTool(spec: ToolSpec): Anthropic.Tool {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.input_schema as Anthropic.Tool.InputSchema,
  };
}

/**
 * Claude provider using Anthropic SDK (direct API)
 *
 * This provider uses the official @anthropic-ai/sdk with native tool_use
 * and multimodal support. It's preferred over CLI when an API key is available.
 */
export class SdkProvider implements ClaudeProvider {
  readonly name = 'sdk';

  private client: Anthropic;
  private config: SdkProviderConfig;

  constructor(config: SdkProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  /**
   * Ask Claude a question with native tool_use support
   */
  async ask(
    question: string,
    conversationHistory: ConversationMessage[],
    userConfig: UserConfig,
    options?: AskOptions
  ): Promise<AskResult> {
    const toolCalls: ToolCallLog[] = [];
    let toolCallCount = 0;

    // Get available tools in Anthropic format
    const toolSpecs = getToolSpecs(userConfig.disabledTools);
    const tools = toolSpecs.map(toAnthropicTool);

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      userAddition: userConfig.systemPromptAddition,
      contextDirContent: userConfig.contextDirContent,
    });

    // Build initial messages from conversation history
    const messages: Anthropic.MessageParam[] = conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Build user content with optional images
    const userContent: Anthropic.ContentBlockParam[] = [];

    // Add images first if provided
    if (options?.images && options.images.length > 0) {
      for (const image of options.images) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: image.data,
          },
        });
      }
      logger.debug('Added images to request', { imageCount: options.images.length });
    }

    // Add question text
    userContent.push({
      type: 'text',
      text: question,
    });

    // Add user message
    messages.push({
      role: 'user',
      content: userContent,
    });

    // Agentic tool loop
    let iteration = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (iteration++ < this.config.maxIterations) {
      logger.debug('Calling Anthropic API', {
        provider: this.name,
        model: this.config.model,
        iteration,
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

      // Track token usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      logger.debug('Anthropic API response', {
        provider: this.name,
        stopReason: response.stop_reason,
        contentBlocks: response.content.length,
      });

      // Check stop reason
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract text response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const responseText =
          textBlocks.map((b) => b.text).join('\n') ||
          'I apologize, but I was unable to generate a response.';

        return {
          response: responseText,
          toolCalls,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      }

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // Check tool call limit
        toolCallCount += toolUseBlocks.length;
        if (toolCallCount > this.config.maxToolCalls) {
          logger.warn('Tool call limit reached', { limit: this.config.maxToolCalls });

          // Extract any text that was generated before tool calls
          const textBlocks = response.content.filter(
            (block): block is Anthropic.TextBlock => block.type === 'text'
          );
          const partialText = textBlocks.map((b) => b.text).join('\n');

          return {
            response: `I reached the maximum number of tool calls (${String(this.config.maxToolCalls)}) while investigating. Here's what I found so far:\n\n${partialText}`,
            toolCalls,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          };
        }

        // Add assistant response to messages
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        // Execute tools and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const result = await executeTool(
            toolUse.id,
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            userConfig.toolConfig
          );

          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            outputPreview: result.content.slice(0, 200),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.content,
            is_error: result.isError,
          });

          logger.debug('Tool executed', {
            tool: toolUse.name,
            isError: result.isError,
            outputLength: result.content.length,
          });
        }

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults,
        });

        continue;
      }

      // Unexpected stop reason
      logger.warn('Unexpected stop reason from Anthropic API', {
        stopReason: response.stop_reason,
      });
      break;
    }

    // Safety fallback
    logger.error('Max iterations reached in SDK tool loop', {
      iterations: this.config.maxIterations,
    });
    return {
      response: 'I was unable to complete the analysis - maximum iterations reached.',
      toolCalls,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    };
  }
}
