import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CliProvider } from '../../../src/services/providers/cli-provider.js';
import type { CliProviderConfig, UserConfig, ConversationMessage } from '../../../src/services/providers/types.js';

// Mock logger to verify debug output on parse failures
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../../src/utils/logger.js', () => ({ logger: mockLogger }));

// Mock child_process.spawn for callCli tests
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockProc = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  on: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../../src/config/prompts.js', () => ({
  buildSystemPrompt: vi.fn(() => 'System prompt'),
}));

// Mock executeTool to control tool results in the ask() loop
vi.mock('../../../src/services/tools/index.js', () => ({
  getToolSpecs: vi.fn(() => [
    { name: 'test_tool', description: 'Test', input_schema: { type: 'object', properties: {} } },
  ]),
  executeTool: vi.fn(async (id: string) => ({
    toolUseId: id,
    content: 'tool output',
    isError: false,
  })),
}));

describe('CliProvider', () => {
  const config: CliProviderConfig = {
    cliPath: 'claude',
    model: 'sonnet',
    maxTokens: 2048,
    maxToolCalls: 10,
    maxIterations: 20,
    cliTimeoutMs: 300000,
    contextWindowTokens: 200000,
    contextTruncationThreshold: 0.85,
    contextWarningThreshold: 0.7,
  };

  const defaultUserConfig: UserConfig = {
    disabledTools: [],
    toolConfig: {
      allowedDirs: ['/tmp'],
      maxFileSizeKb: 100,
      maxLogLines: 50,
    },
  };

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      const provider = new CliProvider(config);
      expect(provider.name).toBe('cli');
    });
  });

  describe('parseResponse', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    function parseResponse(response: string) {
      const provider = new CliProvider(config);
      const parse = (provider as unknown as { parseResponse: (r: string) => { text: string; toolCallRequests: unknown[]; failedParseCount: number } }).parseResponse.bind(provider);
      return parse(response);
    }

    it('should extract text when no tool calls present', () => {
      const response = 'This is a simple response with no tool calls.';
      const result = parseResponse(response);

      expect(result.text).toBe('This is a simple response with no tool calls.');
      expect(result.toolCallRequests).toHaveLength(0);
    });

    it('should parse a single tool call', () => {
      const response = `Let me check the container status.

\`\`\`tool_call
{
  "tool": "get_container_status",
  "input": { "container": "nginx" }
}
\`\`\`

I'll analyze the results.`;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.toolCallRequests[0]).toMatchObject({
        name: 'get_container_status',
        input: { container: 'nginx' },
      });
      expect(result.text).toContain('Let me check the container status.');
      expect(result.text).toContain("I'll analyze the results.");
      expect(result.text).not.toContain('tool_call');
    });

    it('should parse multiple tool calls', () => {
      const response = `I need to check multiple things.

\`\`\`tool_call
{
  "tool": "get_container_status",
  "input": {}
}
\`\`\`

\`\`\`tool_call
{
  "tool": "get_system_resources",
  "input": {}
}
\`\`\`

Let me analyze both.`;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(2);
      expect(result.toolCallRequests[0]).toMatchObject({
        name: 'get_container_status',
      });
      expect(result.toolCallRequests[1]).toMatchObject({
        name: 'get_system_resources',
      });
    });

    it('should handle invalid JSON gracefully', () => {
      const response = `Here's a tool call:

\`\`\`tool_call
{ this is not valid json }
\`\`\`

But I continue anyway.`;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(0);
      expect(result.text).toContain('Here');
      expect(result.text).toContain('But I continue anyway.');
    });

    it('should handle tool call with missing input', () => {
      const response = `\`\`\`tool_call
{
  "tool": "get_disk_usage"
}
\`\`\``;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.toolCallRequests[0]).toMatchObject({
        name: 'get_disk_usage',
        input: {},
      });
    });

    it('should assign unique IDs to each tool call', () => {
      const response = `\`\`\`tool_call
{"tool": "tool1", "input": {}}
\`\`\`

\`\`\`tool_call
{"tool": "tool2", "input": {}}
\`\`\``;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(2);
      const ids = result.toolCallRequests.map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('should handle empty response', () => {
      const result = parseResponse('');

      expect(result.text).toBe('');
      expect(result.toolCallRequests).toHaveLength(0);
    });

    it('should handle response with only whitespace around tool calls', () => {
      const response = `
\`\`\`tool_call
{"tool": "test", "input": {}}
\`\`\`
   `;

      const result = parseResponse(response);

      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.text.trim()).toBe('');
    });

    it('should skip tool calls with missing tool name', () => {
      const response = `\`\`\`tool_call
{"input": {"key": "val"}}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(0);
    });

    it('should skip tool calls where tool is not a string', () => {
      const response = `\`\`\`tool_call
{"tool": 123, "input": {}}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(0);
    });

    it('should handle nested code fences in tool call body', () => {
      const response = `\`\`\`tool_call
{"tool": "create_github_issue", "input": {"title": "Test issue", "body": "## Fix\\n\\n\`\`\`bash\\nsudo ufw reload\\n\`\`\`\\n\\nDone."}}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.toolCallRequests[0].name).toBe('create_github_issue');
      const input = result.toolCallRequests[0].input as { body: string };
      expect(input.body).toContain('sudo ufw reload');
    });

    it('should handle multi-line body with multiple code fences', () => {
      const body = '## Summary\\n\\n```python\\nprint(1)\\n```\\n\\n```yaml\\nkey: value\\n```';
      const response = `\`\`\`tool_call
{"tool": "create_github_issue", "input": {"title": "Multi fence", "body": "${body}"}}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.toolCallRequests[0].name).toBe('create_github_issue');
    });

    it('should report failedParseCount when tool_call block has invalid JSON', () => {
      const response = `\`\`\`tool_call
{invalid json here}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(0);
      expect(result.failedParseCount).toBe(1);
    });

    it('should emit a debug log with raw content and error when tool_call JSON fails to parse', () => {
      const malformedBlock = '{invalid json here}';
      const response = `\`\`\`tool_call\n${malformedBlock}\n\`\`\``;

      const result = parseResponse(response);

      expect(result.failedParseCount).toBe(1);
      expect(mockLogger.debug).toHaveBeenCalledOnce();
      const [, debugArgs] = mockLogger.debug.mock.calls[0] as [string, Record<string, unknown>];
      expect(debugArgs.rawContent).toContain(malformedBlock);
      expect(typeof debugArgs.parseError).toBe('string');
    });

    it('should report failedParseCount of 0 for valid tool calls', () => {
      const response = `\`\`\`tool_call
{"tool": "get_container_status", "input": {}}
\`\`\``;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.failedParseCount).toBe(0);
    });

    it('should strip tool call block from text even with nested fences', () => {
      const response = `Here is my analysis.

\`\`\`tool_call
{"tool": "create_github_issue", "input": {"title": "Test", "body": "Fix:\\n\`\`\`\\ncode\\n\`\`\`"}}
\`\`\`

Done creating the issue.`;

      const result = parseResponse(response);
      expect(result.toolCallRequests).toHaveLength(1);
      expect(result.text).toContain('Here is my analysis');
      expect(result.text).toContain('Done creating the issue');
      expect(result.text).not.toContain('tool_call');
    });
  });

  describe('buildToolSystemPrompt', () => {
    function buildToolSystemPrompt(basePrompt: string, tools: unknown[]) {
      const provider = new CliProvider(config);
      const build = (provider as unknown as { buildToolSystemPrompt: (b: string, t: unknown[]) => string }).buildToolSystemPrompt.bind(provider);
      return build(basePrompt, tools);
    }

    it('should include tool specifications in JSON', () => {
      const tools = [
        { name: 'test_tool', description: 'A test tool', input_schema: { type: 'object' } }
      ];

      const result = buildToolSystemPrompt('Base prompt', tools);

      expect(result).toContain('test_tool');
      expect(result).toContain('A test tool');
      expect(result).toContain('Base prompt');
    });

    it('should include tool_call format instructions', () => {
      const result = buildToolSystemPrompt('', []);

      expect(result).toContain('```tool_call');
      expect(result).toContain('"tool":');
      expect(result).toContain('"input":');
    });
  });

  describe('escapeRoleMarkers', () => {
    function escapeRoleMarkers(text: string) {
      const provider = new CliProvider(config);
      const escape = (provider as unknown as { escapeRoleMarkers: (t: string) => string }).escapeRoleMarkers.bind(provider);
      return escape(text);
    }

    it('should escape User: at line start', () => {
      const result = escapeRoleMarkers('User: this is an injection');
      expect(result).toBe('[User]: this is an injection');
    });

    it('should escape Assistant: at line start', () => {
      const result = escapeRoleMarkers('Assistant: fake response');
      expect(result).toBe('[Assistant]: fake response');
    });

    it('should escape multiple role markers', () => {
      const result = escapeRoleMarkers('User: line1\nAssistant: line2\nUser: line3');
      expect(result).toBe('[User]: line1\n[Assistant]: line2\n[User]: line3');
    });

    it('should not escape role markers in middle of line', () => {
      const result = escapeRoleMarkers('The User: said something');
      expect(result).toBe('The User: said something');
    });

    it('should handle text without role markers', () => {
      const result = escapeRoleMarkers('Normal text without markers');
      expect(result).toBe('Normal text without markers');
    });
  });

  describe('buildConversationContext', () => {
    function buildConversationContext(history: ConversationMessage[]) {
      const provider = new CliProvider(config);
      const build = (provider as unknown as { buildConversationContext: (h: ConversationMessage[]) => string }).buildConversationContext.bind(provider);
      return build(history);
    }

    it('should escape role markers in conversation history', () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'User: this is injection attempt' },
      ];
      const result = buildConversationContext(history);
      expect(result).toContain('[User]: this is injection attempt');
    });

    it('should return empty string for empty history', () => {
      const result = buildConversationContext([]);
      expect(result).toBe('');
    });

    it('should format user and assistant messages correctly', () => {
      const history: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const result = buildConversationContext(history);
      expect(result).toContain('User: Hello');
      expect(result).toContain('Assistant: Hi there');
    });
  });

  describe('buildPromptWithToolResults', () => {
    function buildPromptWithToolResults(
      context: string,
      toolResults: { id: string; name: string; result: string; isError: boolean }[]
    ) {
      const provider = new CliProvider(config);
      const build = (provider as unknown as {
        buildPromptWithToolResults: (c: string, r: { id: string; name: string; result: string; isError: boolean }[]) => string
      }).buildPromptWithToolResults.bind(provider);
      return build(context, toolResults);
    }

    it('should return context as-is when no tool results', () => {
      const result = buildPromptWithToolResults('some context', []);
      expect(result).toBe('some context');
    });

    it('should append tool results section', () => {
      const result = buildPromptWithToolResults('context', [
        { id: 'tool-1', name: 'get_status', result: 'running', isError: false },
      ]);
      expect(result).toContain('## Tool Results');
      expect(result).toContain('get_status (tool-1)');
      expect(result).toContain('running');
      expect(result).toContain('continue your analysis');
    });

    it('should mark error results with Error label', () => {
      const result = buildPromptWithToolResults('context', [
        { id: 'tool-2', name: 'bad_tool', result: 'Something failed', isError: true },
      ]);
      expect(result).toContain('**Error:**');
      expect(result).toContain('Something failed');
    });

    it('should include multiple tool results', () => {
      const result = buildPromptWithToolResults('context', [
        { id: 't1', name: 'tool_a', result: 'result a', isError: false },
        { id: 't2', name: 'tool_b', result: 'result b', isError: true },
      ]);
      expect(result).toContain('tool_a (t1)');
      expect(result).toContain('tool_b (t2)');
      expect(result).toContain('result a');
      expect(result).toContain('result b');
    });
  });

  describe('ask() method', () => {
    let provider: CliProvider;

    beforeEach(() => {
      vi.clearAllMocks();
      provider = new CliProvider(config);

      // Reset mockProc handlers
      mockProc.on.mockReset();
      mockStdout.on.mockReset();
      mockStderr.on.mockReset();
      mockStdin.write.mockReset();
      mockStdin.end.mockReset();
    });

    function setupCliResponse(response: string) {
      // Simulate spawn behavior: stdout data event, then close with code 0
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          cb(Buffer.from(response));
        }
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          // Use setTimeout to allow stdin.write/end to be called first
          setTimeout(() => cb(0), 0);
        }
      });
    }

    it('should return response for simple question (no tool calls)', async () => {
      setupCliResponse('The server is running fine.');

      const result = await provider.ask('How is the server?', [], defaultUserConfig);

      expect(result.response).toBe('The server is running fine.');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(result.contextStatus).toBeDefined();
    });

    it('should include contextStatus in response', async () => {
      setupCliResponse('All good.');

      const result = await provider.ask('status?', [], defaultUserConfig);

      expect(result.contextStatus).toBeDefined();
      expect(result.contextStatus?.wasTruncated).toBe(false);
      expect(result.contextStatus?.removedCount).toBe(0);
      expect(typeof result.contextStatus?.percentUsed).toBe('number');
    });

    it('should fire onProgress callbacks', async () => {
      setupCliResponse('Final answer.');
      const progressEvents: unknown[] = [];

      await provider.ask('question', [], defaultUserConfig, {
        onProgress: (event) => progressEvents.push(event),
      });

      expect(progressEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: 'Final answer.' }),
          expect.objectContaining({ type: 'done' }),
        ])
      );
    });

    it('should warn about base64 images without crashing', async () => {
      setupCliResponse('I see your image.');

      const result = await provider.ask('describe this', [], defaultUserConfig, {
        images: [{ data: 'base64data', mediaType: 'image/png' }],
      });

      expect(result.response).toBe('I see your image.');
    });

    it('should prepend image path to question when localImagePath provided', async () => {
      setupCliResponse('It is a cat.');

      await provider.ask('what is this?', [], defaultUserConfig, {
        localImagePath: '/tmp/image.jpg',
      });

      // Verify stdin.write was called with a prompt that includes the image path
      expect(mockStdin.write).toHaveBeenCalled();
      const writtenPrompt = mockStdin.write.mock.calls[0]?.[0] as string;
      expect(writtenPrompt).toContain('/tmp/image.jpg');
      expect(writtenPrompt).toContain('what is this?');
    });

    it('should reject relative localImagePath', async () => {
      await expect(
        provider.ask('what?', [], defaultUserConfig, {
          localImagePath: 'relative/path.jpg',
        })
      ).rejects.toThrow('localImagePath must be an absolute path');
    });

    it('should return fallback response on empty CLI output', async () => {
      setupCliResponse('');

      const result = await provider.ask('hello', [], defaultUserConfig);

      expect(result.response).toContain('unable to generate a response');
    });

    it('should handle tool call loop', async () => {
      const { executeTool } = await import('../../../src/services/tools/index.js');
      vi.mocked(executeTool).mockResolvedValue({
        toolUseId: 'test-id',
        content: 'container is running',
        isError: false,
      });

      let callCount = 0;
      // First call returns tool call, second call returns final answer
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          callCount++;
          if (callCount === 1) {
            cb(Buffer.from('Let me check.\n\n```tool_call\n{"tool": "test_tool", "input": {}}\n```'));
          } else {
            cb(Buffer.from('The container is running.'));
          }
        }
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });

      const result = await provider.ask('check containers', [], defaultUserConfig);

      expect(result.response).toBe('The container is running.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('test_tool');
    });

    it('should enforce tool call limit', async () => {
      const limitConfig = { ...config, maxToolCalls: 1 };
      const limitProvider = new CliProvider(limitConfig);

      const { executeTool } = await import('../../../src/services/tools/index.js');
      vi.mocked(executeTool).mockResolvedValue({
        toolUseId: 'test-id',
        content: 'result',
        isError: false,
      });

      // Return 2 tool calls in a single response (exceeding limit of 1)
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          cb(Buffer.from(`Analysis:
\`\`\`tool_call
{"tool": "tool1", "input": {}}
\`\`\`
\`\`\`tool_call
{"tool": "tool2", "input": {}}
\`\`\``));
        }
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });

      const result = await limitProvider.ask('do many things', [], defaultUserConfig);

      expect(result.response).toContain('maximum number of tool calls');
      expect(result.response).toContain('Analysis');
    });

    it('should enforce max iterations', async () => {
      const iterConfig = { ...config, maxIterations: 1 };
      const iterProvider = new CliProvider(iterConfig);

      const { executeTool } = await import('../../../src/services/tools/index.js');
      vi.mocked(executeTool).mockResolvedValue({
        toolUseId: 'test-id',
        content: 'result',
        isError: false,
      });

      // Always return a tool call so the loop never exits naturally
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          cb(Buffer.from('```tool_call\n{"tool": "test_tool", "input": {}}\n```'));
        }
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });

      const result = await iterProvider.ask('infinite loop', [], defaultUserConfig);

      expect(result.response).toContain('maximum iterations reached');
    });
  });

  describe('callCli', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockProc.on.mockReset();
      mockStdout.on.mockReset();
      mockStderr.on.mockReset();
      mockStdin.write.mockReset();
      mockStdin.end.mockReset();
    });

    function callCli(prompt: string, systemPrompt: string) {
      const provider = new CliProvider(config);
      const call = (provider as unknown as { callCli: (p: string, sp: string) => Promise<string> }).callCli.bind(provider);
      return call(prompt, systemPrompt);
    }

    it('should resolve with stdout on exit code 0', async () => {
      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from('Hello '));
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(0), 0);
      });

      const result = await callCli('test prompt', 'system prompt');
      expect(result).toBe('Hello');
      expect(mockStdin.write).toHaveBeenCalledWith('test prompt');
      expect(mockStdin.end).toHaveBeenCalled();
    });

    it('should reject with timeout error on exit code 143', async () => {
      mockStdout.on.mockImplementation(() => { /* noop */ });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(143), 0);
      });

      await expect(callCli('prompt', 'system')).rejects.toThrow('Claude took too long');
    });

    it('should reject with stderr on non-zero exit code', async () => {
      mockStdout.on.mockImplementation(() => { /* noop */ });
      mockStderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from('authentication failed'));
      });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(1), 0);
      });

      await expect(callCli('prompt', 'system')).rejects.toThrow('exited with code 1');
    });

    it('should reject on spawn error', async () => {
      mockStdout.on.mockImplementation(() => { /* noop */ });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (err: Error) => void) => {
        if (event === 'error') setTimeout(() => cb(new Error('ENOENT')), 0);
      });

      await expect(callCli('prompt', 'system')).rejects.toThrow('Failed to spawn Claude CLI');
    });

    it('should clean up temp file on success', async () => {
      const { unlinkSync } = await import('fs');

      mockStdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from('ok'));
      });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(0), 0);
      });

      await callCli('prompt', 'system');
      expect(unlinkSync).toHaveBeenCalled();
    });

    it('should clean up temp file on error', async () => {
      const { unlinkSync } = await import('fs');

      mockStdout.on.mockImplementation(() => { /* noop */ });
      mockStderr.on.mockImplementation(() => { /* noop */ });
      mockProc.on.mockImplementation((event: string, cb: (err: Error) => void) => {
        if (event === 'error') setTimeout(() => cb(new Error('boom')), 0);
      });

      await callCli('prompt', 'system').catch(() => { /* expected */ });
      expect(unlinkSync).toHaveBeenCalled();
    });
  });

  describe('cleanupTmpFile', () => {
    it('should not throw when file does not exist', async () => {
      const provider = new CliProvider(config);
      const cleanup = (provider as unknown as { cleanupTmpFile: (p: string) => void }).cleanupTmpFile.bind(provider);

      const fs = await import('fs');
      vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('ENOENT'); });

      // Should not throw
      expect(() => cleanup('/tmp/nonexistent')).not.toThrow();
    });
  });

});
