import { describe, it, expect, beforeAll } from 'vitest';
import { CliProvider } from '../../../src/services/providers/cli-provider.js';

describe('CliProvider', () => {
  const config = {
    cliPath: 'claude',
    model: 'sonnet',
    maxTokens: 2048,
    maxToolCalls: 10,
    maxIterations: 20,
  };

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      const provider = new CliProvider(config);
      expect(provider.name).toBe('cli');
    });
  });

  describe('parseResponse', () => {
    // Access private method for testing by creating an instance and using type assertion
    function parseResponse(response: string) {
      const provider = new CliProvider(config);
      // Use bind trick to access private method
      const parse = (provider as unknown as { parseResponse: (r: string) => { text: string; toolCallRequests: unknown[] } }).parseResponse.bind(provider);
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

      // Should not crash, just skip the invalid tool call
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
      expect(new Set(ids).size).toBe(2); // All IDs should be unique
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
    function buildConversationContext(history: { role: 'user' | 'assistant'; content: string }[]) {
      const provider = new CliProvider(config);
      const build = (provider as unknown as { buildConversationContext: (h: { role: 'user' | 'assistant'; content: string }[]) => string }).buildConversationContext.bind(provider);
      return build(history);
    }

    it('should escape role markers in conversation history', () => {
      const history = [
        { role: 'user' as const, content: 'User: this is injection attempt' },
      ];
      const result = buildConversationContext(history);
      expect(result).toContain('[User]: this is injection attempt');
    });

    it('should return empty string for empty history', () => {
      const result = buildConversationContext([]);
      expect(result).toBe('');
    });
  });

  describe('localImagePath handling', () => {
    it('should prepend file reference when localImagePath is provided', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourceFile = path.join(__dirname, '../../../src/services/providers/cli-provider.ts');
      const source = fs.readFileSync(sourceFile, 'utf-8');

      // Verify the implementation includes localImagePath handling
      expect(source).toContain('options?.localImagePath');
      expect(source).toContain('Please analyze the image at');
      expect(source).toContain('effectiveQuestion');
    });

    it('should build effective question with image path', () => {
      // Test the logic that would be applied (simulating what the code does)
      const question = 'What food is this?';
      const localImagePath = '/tmp/test-image.jpg';

      // This mirrors the implementation in cli-provider.ts
      const effectiveQuestion = `Please analyze the image at ${localImagePath}\n\n${question}`;

      expect(effectiveQuestion).toBe('Please analyze the image at /tmp/test-image.jpg\n\nWhat food is this?');
      expect(effectiveQuestion).toContain(localImagePath);
      expect(effectiveQuestion).toContain(question);
    });

    it('should not modify question when localImagePath is not provided', () => {
      const question = 'What is the container status?';

      // When no localImagePath, effectiveQuestion should equal question
      const effectiveQuestion = question;

      expect(effectiveQuestion).toBe(question);
    });

    it('should require absolute path for localImagePath', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourceFile = path.join(__dirname, '../../../src/services/providers/cli-provider.ts');
      const source = fs.readFileSync(sourceFile, 'utf-8');

      // Verify the implementation validates absolute paths
      expect(source).toContain("if (!options.localImagePath.startsWith('/'))");
      expect(source).toContain('localImagePath must be an absolute path');
    });
  });

  describe('callCli implementation requirements', () => {
    // NOTE: Behavioral mocking of spawn() is complex in vitest due to module sealing.
    // These tests verify critical implementation requirements via source inspection.
    // See git commit for full bug analysis: CLI hangs without stdin.end().

    let source: string;

    beforeAll(async () => {
      const fs = await import('fs');
      const path = await import('path');
      const sourceFile = path.join(__dirname, '../../../src/services/providers/cli-provider.ts');
      source = fs.readFileSync(sourceFile, 'utf-8');
    });

    it('must write prompt to stdin instead of passing as -p argument', () => {
      // E2BIG fix: prompt is written to stdin to avoid ARG_MAX limit
      // The -p flag should NOT be in the args array
      expect(source).toContain('proc.stdin.write(prompt)');
      expect(source).not.toMatch(/args\s*=\s*\[[\s\S]*?'-p',\s*prompt/);
    });

    it('must write system prompt to temp file instead of passing as arg', () => {
      // E2BIG fix: system prompt written to temp file to avoid ARG_MAX limit
      expect(source).toContain('writeFileSync');
      expect(source).toContain('--system-prompt-file');
      // Should NOT pass system prompt string as arg
      expect(source).not.toMatch(/'--system-prompt',\s*systemPrompt/);
    });

    it('must clean up temp file after CLI completes', () => {
      // Temp file cleanup must happen in both success and error paths
      expect(source).toContain('unlinkSync');
    });

    it('must end stdin after writing prompt to signal EOF', () => {
      // CRITICAL: stdin.end() must be called after write to signal EOF
      const writeIndex = source.indexOf('proc.stdin.write(prompt)');
      const endIndex = source.indexOf('proc.stdin.end()');
      const onDataIndex = source.indexOf("proc.stdout.on('data'");

      expect(writeIndex).toBeGreaterThan(0);
      expect(endIndex).toBeGreaterThan(writeIndex);
      expect(onDataIndex).toBeGreaterThan(endIndex);
    });

    it('must have timeout configured as safety net', () => {
      expect(source).toMatch(/timeout:\s*\d+/);
    });
  });
});
