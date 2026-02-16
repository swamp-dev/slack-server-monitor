import { describe, it, expect } from 'vitest';
import {
  renderConversation,
  renderMarkdownExport,
  render404,
  render401,
  renderError,
} from '../../src/web/templates.js';
import type { ConversationMessage, ToolCallLog } from '../../src/services/conversation-store.js';

describe('web templates', () => {
  describe('renderConversation', () => {
    it('should render a basic conversation page', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is the status of nginx?' },
        { role: 'assistant', content: 'The nginx container is running.' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Claude Conversation</title>');
      expect(html).toContain('What is the status of nginx?');
      expect(html).toContain('The nginx container is running.');
      expect(html).toContain('class="message user"');
      expect(html).toContain('class="message assistant"');
    });

    it('should escape HTML in messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: '<script>alert("xss")</script>' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // User-supplied script tag should be escaped, not rendered as HTML
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should format code blocks', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Here is some code:\n```javascript\nconsole.log("hello");\n```' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<pre><code class="language-javascript">');
      expect(html).toContain('console.log(&quot;hello&quot;);');
    });

    it('should format inline code', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Run `docker ps` to see containers.' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<code>docker ps</code>');
    });

    it('should format bold and italic text', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'This is **bold** and *italic* text.' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    it('should render tool calls section', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk usage' },
        { role: 'assistant', content: 'Disk usage is 45%' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('Tool Calls (1)');
      expect(html).toContain('get_disk_usage');
      expect(html).toContain('45% used');
    });

    it('should render tool calls as collapsible details/summary elements', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('</details>');
    });

    it('should use language-json class for tool call input JSON', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('class="language-json"');
    });

    it('should display tool call timestamps', () => {
      const fixedTimestamp = Date.now();
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: fixedTimestamp,
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: fixedTimestamp - 60000,
        updatedAt: fixedTimestamp,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Should contain the tool-call-time element with a time string (HH:MM:SS format)
      expect(html).toContain('tool-call-time');
      expect(html).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('should render multiple tool calls as separate collapsible items', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check everything' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
        {
          conversationId: 1,
          toolName: 'get_system_resources',
          input: {},
          outputPreview: 'CPU: 12%',
          timestamp: Date.now() + 1000,
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('Tool Calls (2)');
      expect(html).toContain('get_disk_usage');
      expect(html).toContain('get_system_resources');
      // Each tool call should be a separate details element
      const detailsCount = (html.match(/<details/g) || []).length;
      expect(detailsCount).toBe(2);
    });

    it('should render tool call output in a code block', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used on /',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Output should be in a styled element, not just plain text
      expect(html).toContain('class="tool-call-output"');
      expect(html).toContain('45% used on /');
    });

    it('should handle tool calls with no output preview', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Do something' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'run_command',
          input: { command: 'uptime' },
          outputPreview: '',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('run_command');
      // Should not render an output div for empty output
      expect(html).not.toContain('class="tool-call-output"');
    });

    it('should handle empty conversation', () => {
      const messages: ConversationMessage[] = [];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('No messages in this conversation.');
    });

    it('should safely render links with https', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Check [the docs](https://example.com/docs)' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<a href="https://example.com/docs" rel="noopener">the docs</a>');
    });

    it('should not render javascript: links', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Check [click me](javascript:alert(1))' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Should not convert to a link since it's not http/https
      expect(html).not.toContain('href="javascript:');
    });

    it('should escape quotes in href to prevent attribute injection', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '[click](https://x.com?a="onload="alert(1))' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Quotes in href must be escaped so attribute can't break out
      expect(html).not.toContain('href="https://x.com?a="onload');
      expect(html).toContain('&quot;');
    });

    it('should escape HTML in link text', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '[<img src=x onerror=alert(1)>](https://example.com)' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // img tag in link text must be escaped, not rendered as HTML element
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('should render headings', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '# Main Title\n\n## Subtitle\n\n### Section' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<h1>Main Title</h1>');
      expect(html).toContain('<h2>Subtitle</h2>');
      expect(html).toContain('<h3>Section</h3>');
    });

    it('should render unordered lists', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '- Item one\n- Item two\n- Item three' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<ul>');
      expect(html).toContain('<li>Item one</li>');
      expect(html).toContain('<li>Item two</li>');
      expect(html).toContain('</ul>');
    });

    it('should render ordered lists', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '1. First\n2. Second\n3. Third' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<ol>');
      expect(html).toContain('<li>First</li>');
      expect(html).toContain('</ol>');
    });

    it('should render blockquotes', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '> This is a quote' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<blockquote>');
      expect(html).toContain('This is a quote');
      expect(html).toContain('</blockquote>');
    });

    it('should render tables', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '| Name | Status |\n| --- | --- |\n| nginx | running |\n| redis | stopped |' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<table>');
      expect(html).toContain('<th>Name</th>');
      expect(html).toContain('<td>nginx</td>');
      expect(html).toContain('<td>running</td>');
      expect(html).toContain('</table>');
    });

    it('should render horizontal rules', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Above\n\n---\n\nBelow' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<hr');
    });

    it('should render strikethrough text', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'This is ~~deleted~~ text.' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('<del>deleted</del>');
    });

    it('should include highlight.js for syntax highlighting', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('highlight');
      expect(html).toContain('hljs');
    });
  });

  describe('render404', () => {
    it('should render 404 page', () => {
      const html = render404();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('404');
      expect(html).toContain('not found');
    });
  });

  describe('render401', () => {
    it('should render 401 page', () => {
      const html = render401();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('401');
      expect(html).toContain('Authentication required');
    });
  });

  describe('renderError', () => {
    it('should render error page with escaped message', () => {
      const html = renderError('<script>bad</script>');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Error');
      expect(html).not.toContain('<script>bad</script>');
      expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    });
  });

  describe('renderMarkdownExport', () => {
    const baseMetadata = {
      threadTs: '1234567890.123456',
      channelId: 'C123ABC',
      createdAt: 1708099200000, // Feb 16, 2024 UTC
      updatedAt: 1708099260000,
    };

    it('should format messages as markdown with role headers', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is the status of nginx?' },
        { role: 'assistant', content: 'The nginx container is running.' },
      ];

      const md = renderMarkdownExport(messages, [], baseMetadata);

      expect(md).toContain('### User');
      expect(md).toContain('What is the status of nginx?');
      expect(md).toContain('### Claude');
      expect(md).toContain('The nginx container is running.');
    });

    it('should include metadata header', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const md = renderMarkdownExport(messages, [], baseMetadata);

      expect(md).toContain('# Claude Conversation');
      expect(md).toContain('Thread: `1234567890.123456`');
      expect(md).toContain('Channel: `C123ABC`');
    });

    it('should include tool calls when provided', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
        { role: 'assistant', content: 'Disk is at 45%.' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];

      const md = renderMarkdownExport(messages, toolCalls, baseMetadata);

      expect(md).toContain('## Tool Calls');
      expect(md).toContain('get_disk_usage');
      expect(md).toContain('45% used');
    });

    it('should exclude tool calls when empty array', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const md = renderMarkdownExport(messages, [], baseMetadata);

      expect(md).not.toContain('## Tool Calls');
    });

    it('should format tool call input as JSON code block', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check disk' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: 'ok',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];

      const md = renderMarkdownExport(messages, toolCalls, baseMetadata);

      expect(md).toContain('```json');
      expect(md).toContain('"mount": "/"');
    });

    it('should preserve markdown formatting in message content', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Here is **bold** and `code` and\n```bash\necho hello\n```' },
      ];

      const md = renderMarkdownExport(messages, [], baseMetadata);

      // Content should be preserved as-is (it's already markdown)
      expect(md).toContain('**bold**');
      expect(md).toContain('`code`');
      expect(md).toContain('```bash');
      expect(md).toContain('echo hello');
    });

    it('should handle empty conversation', () => {
      const md = renderMarkdownExport([], [], baseMetadata);

      expect(md).toContain('# Claude Conversation');
      expect(md).not.toContain('### User');
      expect(md).not.toContain('### Claude');
    });

    it('should include multiple tool calls', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check everything' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: { mount: '/' },
          outputPreview: '45% used',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
        {
          conversationId: 1,
          toolName: 'get_system_resources',
          input: {},
          outputPreview: 'CPU: 12%',
          timestamp: Date.now() + 1000,
          durationMs: null,
          success: true,
        },
      ];

      const md = renderMarkdownExport(messages, toolCalls, baseMetadata);

      expect(md).toContain('get_disk_usage');
      expect(md).toContain('get_system_resources');
      expect(md).toContain('45% used');
      expect(md).toContain('CPU: 12%');
    });
  });
});
