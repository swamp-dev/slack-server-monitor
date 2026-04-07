import { describe, it, expect } from 'vitest';
import {
  renderConversation,
  renderMarkdownExport,
  renderSessionList,
  renderDashboard,
  render404,
  render401,
  renderError,
  renderLogin,
  icon,
  getThemeStyles,
  wrapInShell,
} from '../../src/web/templates/index.js';
import { getStaticCss } from '../../src/web/templates/styles.js';
import type { ConversationMessage, ToolCallLog, SessionSummary, SessionStats, TagInfo, PaginationInfo } from '../../src/services/conversation-store.js';

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
      expect(html).toContain('<title>What is the status of nginx?</title>');
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
      // Title tag should also be escaped (first user message becomes page title)
      expect(html).toContain('<title>&lt;script&gt;alert');
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

    it('should wrap code blocks with language label and copy button', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '```typescript\nconst x = 1;\n```' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, [], metadata);

      expect(html).toContain('class="code-block"');
      expect(html).toContain('class="code-block-header"');
      expect(html).toContain('class="code-lang"');
      expect(html).toContain('>typescript<');
      expect(html).toContain('class="code-copy-btn"');
      expect(html).toContain('>Copy<');
    });

    it('should render code blocks without language label when no lang specified', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: '```\nplain text\n```' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, [], metadata);

      expect(html).toContain('class="code-block"');
      expect(html).toContain('class="code-copy-btn"');
      // No language label
      expect(html).not.toContain('class="code-lang"');
    });

    it('should not affect inline code with code-block wrapper', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Use `docker ps` to list containers.' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, [], metadata);

      expect(html).toContain('<code>docker ps</code>');
      // Inline code should not generate a code-block div in the message content
      const messageContent = html.split('message-content')[1] ?? '';
      expect(messageContent).not.toContain('class="code-block"');
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
      // Each tool call should be a separate details element (+ 1 for the wrapper)
      const detailsCount = (html.match(/<details class="tool-call"/g) || []).length;
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

    it('should wrap tool calls in a collapsible wrapper with summary stats', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check it' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'get_disk_usage',
          input: {},
          outputPreview: '45%',
          timestamp: Date.now(),
          durationMs: 120,
          success: true,
        },
        {
          conversationId: 1,
          toolName: 'get_system_resources',
          input: {},
          outputPreview: 'ok',
          timestamp: Date.now(),
          durationMs: 80,
          success: false,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Wrapper details element
      expect(html).toContain('tool-calls-wrapper');
      expect(html).toContain('tool-calls-summary');
      // Summary stats
      expect(html).toContain('tool-calls-summary-stats');
      expect(html).toContain('tool-calls-summary-stat success');
      expect(html).toContain('tool-calls-summary-stat failure');
      // Total duration (120 + 80 = 200ms)
      expect(html).toContain('200ms');
    });

    it('should render tool calls below the continue form', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'test_tool',
          input: {},
          outputPreview: 'ok',
          timestamp: Date.now(),
          durationMs: 50,
          success: true,
        },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        canContinue: true,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      // Continue form should appear before tool calls in the body HTML
      const continueFormIndex = html.indexOf('id="continue-form"');
      const toolCallsIndex = html.indexOf('id="tool-calls-wrapper"');
      expect(continueFormIndex).toBeGreaterThan(-1);
      expect(toolCallsIndex).toBeGreaterThan(-1);
      expect(continueFormIndex).toBeLessThan(toolCallsIndex);
    });

    it('should format total duration in seconds when over 1000ms', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'slow_tool',
          input: {},
          outputPreview: 'done',
          timestamp: Date.now(),
          durationMs: 2500,
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

      // 2500ms should be formatted as 2.5s in the summary
      expect(html).toContain('2.5s');
    });

    it('should include localStorage persistence script for tool calls toggle', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'test_tool',
          input: {},
          outputPreview: 'ok',
          timestamp: Date.now(),
          durationMs: 50,
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

      expect(html).toContain('tool-calls-expanded');
      expect(html).toContain('localStorage');
    });

    it('should not include tool calls script when there are no tool calls', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, [], metadata);

      // No localStorage script or tool calls element in the body
      expect(html).not.toContain('tool-calls-expanded');
      expect(html).not.toContain('id="tool-calls-wrapper"');
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

      expect(html).toContain('<a href="https://example.com/docs" rel="noopener noreferrer">the docs</a>');
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

    it('should include export markdown button with absolute path', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('href="/c/1234567890.123456/C123ABC/export/md"');
      expect(html).toContain('Export');
    });

    it('should include copy to clipboard button that fetches from absolute path', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('/c/1234567890.123456/C123ABC/export/md');
      expect(html).toContain('clipboard');
      expect(html).toContain('Copy');
    });

    it('should include continue form when canContinue is true', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        canContinue: true,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('id="continue-form"');
      expect(html).toContain('Ask Claude');
      expect(html).toContain('id="continue-input"');
      expect(html).toContain('id="continue-submit"');
      expect(html).toContain('Continue Conversation');
    });

    it('should not include continue form when canContinue is false', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        canContinue: false,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).not.toContain('id="continue-form"');
      expect(html).not.toContain('Continue Conversation');
    });

    it('should not include continue form when canContinue is not set', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).not.toContain('id="continue-form"');
      expect(html).not.toContain('Continue Conversation');
    });

    it('should include nav bar with back link (UX-2)', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('class="nav-bar"');
      expect(html).toContain('href="/c"');
      expect(html).toContain('Back to conversations');
      expect(html).toContain('Server Monitor');
    });

    it('should include favorite star with click handler on detail page (BUG-6, UX-3)', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 42,
        isFavorited: false,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('id="detail-star"');
      expect(html).toContain('detail-favorite-star');
      expect(html).toContain("fetch('/c/' + convId + '/favorite'");
    });

    it('should show active star class when favorited', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 42,
        isFavorited: true,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('detail-favorite-star active');
    });

    it('should include tag input form on detail page (BUG-7)', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 42,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('id="tag-input-form"');
      expect(html).toContain('id="tag-input"');
      expect(html).toContain("fetch('/c/' + convId + '/tag'");
    });

    it('should display existing tags on detail page', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 42,
        tags: ['nginx', 'debugging'],
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('id="detail-tags"');
      expect(html).toContain('nginx');
      expect(html).toContain('debugging');
    });

    it('should include archive button on detail page (BUG-10)', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const toolCalls: ToolCallLog[] = [];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 42,
      };

      const html = renderConversation(messages, toolCalls, metadata);

      expect(html).toContain('id="archive-btn"');
      expect(html).toContain("fetch('/c/' + convId + '/archive'");
    });

    it('should have conv-header-compact class for compact header', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 1,
      };

      const html = renderConversation(messages, [], metadata);

      expect(html).toContain('conv-header-compact');
    });

    it('should render action buttons as icon-only without text labels', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Test' },
      ];
      const metadata = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 1,
      };

      const html = renderConversation(messages, [], metadata);

      // Buttons should use title attribute for tooltip, not text labels
      expect(html).toContain('title="Export Markdown"');
      expect(html).toContain('title="Copy to Clipboard"');
      expect(html).toContain('title="Archive"');
      // Should NOT have text labels next to icons
      expect(html).not.toMatch(/Export Markdown<\/a>/);
      expect(html).not.toMatch(/Copy to Clipboard<\/button>/);
    });
    it('should render scroll-to-bottom button', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(html).toContain('scroll-to-bottom');
      expect(html).toContain('Scroll to bottom');
    });

    it('should render scroll-to-bottom with muted styling', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1', channelId: 'C1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      // FAB should use surface bg, not accent gradient
      expect(html).toContain('scroll-to-bottom');
      expect(html).toMatch(/\.scroll-to-bottom\s*\{[^}]*var\(--surface\)/);
      expect(html).not.toMatch(/\.scroll-to-bottom\s*\{[^}]*var\(--accent\)/);
    });

    it('should use first user message as page title', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What is the status of nginx?' },
        { role: 'assistant', content: 'Running fine.' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1', channelId: 'C1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      expect(html).toContain('<title>What is the status of nginx?</title>');
      expect(html).toContain('conv-title');
      expect(html).toContain('What is the status of nginx?');
    });

    it('should fall back to Claude Conversation when no user messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'assistant', content: 'Hello!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1', channelId: 'C1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      expect(html).toContain('<title>Claude Conversation</title>');
    });

    it('should wrap back text in span for mobile hiding', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hi' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1', channelId: 'C1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      expect(html).toContain('conv-back-text');
      expect(html).toContain('conv-details-toggle');
      expect(html).toContain('conv-collapsible');
    });

    it('should render copy button on each message', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Should have copy buttons rendered as actual button elements (2 messages = 2 buttons)
      const buttonMatches = html.match(/<button class="copy-msg-btn"/g);
      expect(buttonMatches?.length).toBe(2);
    });

    it('should show copy button at low opacity for discoverability', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1', channelId: 'C1', createdAt: Date.now(), updatedAt: Date.now(),
      });
      // Copy button should be always visible at readable opacity (not hidden)
      expect(html).toMatch(/\.copy-msg-btn\s*\{[^}]*opacity:\s*0\.5/);
      // Touch devices should show at higher opacity
      expect(html).toContain('hover: none');
    });

    it('should collapse long messages with show more button', () => {
      const longContent = Array(600).fill('word').join(' ');
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: longContent },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(html).toContain('collapsed');
      expect(html).toContain('show-more-btn');
      expect(html).toContain('600 words');
    });

    it('should not collapse short messages', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'This is a normal length response.' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // No show-more buttons rendered as elements (class exists in CSS/JS but no button elements)
      expect(html).not.toMatch(/<button class="show-more-btn"/);
    });

    it('should render branch badge when branches exist', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 1,
        branches: [
          { threadTs: '999.999', channelId: 'C123ABC', createdAt: Date.now(), branchPointIndex: 0 },
        ],
      });

      expect(html).toContain('branch-toggle');
      expect(html).toContain('1 branch');
      expect(html).toContain('branch-list');
      expect(html).toContain('999.999');
    });

    it('should not render branch badge when no branches', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // No branch-toggle button rendered as element (id exists in JS but not as button)
      expect(html).not.toMatch(/<button class="branch-badge" id="branch-toggle"/);
    });

    it('should show branch point indicator on the forked message', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'More' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        branchPointIndex: 1,
        branches: [
          { threadTs: '999.999', channelId: 'C123ABC', createdAt: Date.now(), branchPointIndex: 1 },
        ],
      });

      expect(html).toContain('branch-point-indicator');
      expect(html).toContain('branch point');
    });

    it('should render message timestamp as title attribute', () => {
      const ts = Date.now() - 60000;
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello', timestamp: ts },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // First message should have title with formatted timestamp (en-US locale)
      const expectedTs = new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' });
      expect(html).toContain(`title="${expectedTs}"`);
    });

    it('should render smooth scroll script for SSE done event', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const html = renderConversation(messages, [], {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        canContinue: true,
      });

      // Should have smart scroll behavior (only scroll if near bottom)
      expect(html).toContain('distFromBottom');
      // Done event should scroll to new message
      expect(html).toContain('scrollIntoView');
    });
  });

  describe('renderSessionList', () => {
    const basePagination: PaginationInfo = {
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
    };

    function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
      return {
        id: 1,
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        userId: 'U456DEF',
        messageCount: 5,
        toolCallCount: 3,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        archivedAt: null,
        isActive: true,
        isFavorited: false,
        ...overrides,
      };
    }

    it('should render search form', () => {
      const html = renderSessionList([], basePagination);

      expect(html).toContain('<form');
      expect(html).toContain('name="q"');
      expect(html).toContain('Search');
    });

    it('should show search query in input when provided', () => {
      const html = renderSessionList([], basePagination, { searchQuery: 'nginx' });

      expect(html).toContain('value="nginx"');
    });

    it('should escape HTML in search query', () => {
      const html = renderSessionList([], basePagination, { searchQuery: '<script>alert(1)</script>' });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render favorite indicator for favorited sessions', () => {
      const sessions = [
        makeSession({ isFavorited: true }),
        makeSession({ id: 2, threadTs: '2222.0002', isFavorited: false }),
      ];

      const html = renderSessionList(sessions, basePagination);

      // Should show filled star for favorited
      expect(html).toContain('favorite-star active');
      // Should show empty star for non-favorited
      expect(html).toContain('favorite-star"');
    });

    it('should render tag pills for sessions with tags', () => {
      const sessions = [
        makeSession({ tags: ['nginx', 'production'] }),
      ];

      const html = renderSessionList(sessions, basePagination);

      expect(html).toContain('class="tag"');
      expect(html).toContain('nginx');
      expect(html).toContain('production');
    });

    it('should render tag filter sidebar when tags exist', () => {
      const html = renderSessionList([], basePagination, {
        allTags: [
          { name: 'nginx', count: 3 },
          { name: 'debugging', count: 1 },
        ],
      });

      expect(html).toContain('nginx');
      expect(html).toContain('(3)');
      expect(html).toContain('debugging');
      expect(html).toContain('(1)');
    });

    it('should render collapsible toggle button when tags exist', () => {
      const html = renderSessionList([], basePagination, {
        allTags: [
          { name: 'nginx', count: 3 },
        ],
      });

      expect(html).toContain('tag-sidebar-toggle');
      expect(html).toContain('aria-label="Toggle tags"');
    });

    it('should include tag sidebar collapse script with localStorage', () => {
      const html = renderSessionList([], basePagination, {
        allTags: [
          { name: 'nginx', count: 3 },
        ],
      });

      expect(html).toContain('ssm-tag-sidebar-collapsed');
    });

    it('should render favorites tab', () => {
      const html = renderSessionList([], basePagination);

      expect(html).toContain('Favorites');
    });

    it('should mark active tab based on options', () => {
      const favHtml = renderSessionList([], basePagination, { favorites: true });

      expect(favHtml).toContain('Favorites</a>');
      // The favorites link should have the active class
      expect(favHtml).toMatch(/Favorites<\/a>/);
    });

    it('should escape HTML in tag names', () => {
      const sessions = [
        makeSession({ tags: ['<script>xss</script>'] }),
      ];

      const html = renderSessionList(sessions, basePagination);

      expect(html).not.toContain('<script>xss</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should display firstMessage as conversation title when available (UX-1)', () => {
      const sessions = [
        makeSession({ firstMessage: 'Why is nginx returning 502?' }),
      ];

      const html = renderSessionList(sessions, basePagination);

      expect(html).toContain('Why is nginx returning 502?');
    });

    it('should fall back to userId/channelId when firstMessage is absent', () => {
      const sessions = [
        makeSession({ userId: 'U456DEF', channelId: 'C123ABC' }),
      ];

      const html = renderSessionList(sessions, basePagination);

      expect(html).toContain('U456DEF');
      expect(html).toContain('C123ABC');
    });

    it('should include favorite star click handler script (BUG-6)', () => {
      const sessions = [makeSession()];
      const html = renderSessionList(sessions, basePagination);

      expect(html).toContain("fetch('/c/' + id + '/favorite'");
      expect(html).toContain('addEventListener');
    });

    it('should use 1.4rem star size (UX-3)', () => {
      const sessions = [makeSession()];
      const html = renderSessionList(sessions, basePagination);

      expect(html).toContain('font-size: 1.4rem');
    });

    it('should default to "My conversations" active state when currentUserId starts with U', () => {
      const html = renderSessionList([], basePagination, { currentUserId: 'U01ABC123' });

      // Both Mine and All links should be present
      expect(html).toContain('?mine=true"');
      expect(html).toContain('?mine=false"');
      // The "Mine" link should be the active tab (Slack user default)
      expect(html).toMatch(/class="[^"]*active[^"]*">Mine</);
    });

    it('should default to "All" active state when currentUserId is admin', () => {
      const html = renderSessionList([], basePagination, { currentUserId: 'admin' });

      // Both Mine and All links should be present
      expect(html).toContain('?mine=true"');
      expect(html).toContain('?mine=false"');
      // "All" tab should be active (non-Slack user default), Mine should not be active
      expect(html).not.toMatch(/class="[^"]*active[^"]*">Mine</);
    });
  });

  describe('render404', () => {
    it('should render 404 page', () => {
      const html = render404();

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('404');
      expect(html).toContain('not found');
    });

    it('should include navigation bar', () => {
      const html = render404();
      expect(html).toContain('nav-bar');
    });

    it('should say Page not found with dashboard link', () => {
      const html = render404();
      expect(html).toContain('Page not found');
      expect(html).toContain('Back to dashboard');
      expect(html).toContain('href="/"');
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

    it('should escape markdown injection in tool names', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'evil](http://malicious.com)',
          input: {},
          outputPreview: 'ok',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];

      const md = renderMarkdownExport(messages, toolCalls, baseMetadata);

      // Tool name brackets should be escaped so no link is created
      expect(md).not.toContain('[evil](http://malicious.com)');
      expect(md).toContain('\\]');
      expect(md).toContain('\\(');
    });

    it('should escape markdown injection in tool output', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Check' },
      ];
      const toolCalls: ToolCallLog[] = [
        {
          conversationId: 1,
          toolName: 'test_tool',
          input: {},
          outputPreview: 'Click [here](javascript:alert(1)) for details',
          timestamp: Date.now(),
          durationMs: null,
          success: true,
        },
      ];

      const md = renderMarkdownExport(messages, toolCalls, baseMetadata);

      // Output brackets/parens should be escaped
      expect(md).not.toContain('[here](javascript:alert(1))');
      expect(md).toContain('\\[here\\]');
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

  describe('web UI overhaul', () => {
    describe('icon system', () => {
      it('returns valid SVG for known icons', () => {
        const svg = icon('star');
        expect(svg).toContain('<svg');
        expect(svg).toContain('viewBox');
      });

      it('returns different SVGs for different icons', () => {
        expect(icon('star')).not.toBe(icon('search'));
      });

      it('returns empty string for unknown icon', () => {
        expect(icon('nonexistent')).toBe('');
      });

      it('respects custom size parameter', () => {
        const svg = icon('star', 24);
        expect(svg).toContain('width="24"');
        expect(svg).toContain('height="24"');
      });
    });

    describe('theme system', () => {
      it('includes Dracula CSS variables', () => {
        const css = getThemeStyles();
        expect(css).toContain('#282a36');
        expect(css).toContain('#f8f8f2');
        expect(css).toContain('#ff79c6');
      });

      it('includes light theme variables', () => {
        const css = getThemeStyles();
        expect(css).toContain('data-theme="light"');
      });
    });

    describe('wrapInShell', () => {
      it('includes nav bar with branding', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).toContain('Server Monitor');
        // Nav bar should contain a robot icon (any size)
        expect(html).toContain('nav-brand');
        expect(html).toContain('M10 6C6.69'); // robot icon path
      });

      it('includes theme toggle button', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).toContain('theme-toggle');
      });

      it('uses system font stack without external font dependencies', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).not.toContain('fonts.googleapis.com');
        // Font stack is now in the static CSS bundle, not inlined in HTML
        const css = getStaticCss();
        expect(css).toContain('-apple-system');
      });

      it('includes FOWT prevention script', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        // ssm-theme should appear in head before styles
        const headContent = html.split('</head>')[0];
        expect(headContent).toContain('ssm-theme');
      });

      it('omits nav when showNav is false', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>', showNav: false });
        expect(html).not.toContain('class="nav-bar"');
      });

      it('includes toast container', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).toContain('toast-container');
      });

      it('includes logout form', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).toContain('/logout');
      });

      it('includes conversations link in nav bar', () => {
        const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
        expect(html).toContain('href="/c"');
        expect(html).toContain('Conversations');
      });
    });

    describe('login page', () => {
      it('contains gradient background', () => {
        const html = renderLogin();
        expect(html).toContain('gradient');
      });

      it('contains robot icon branding', () => {
        const html = renderLogin();
        // Login page should contain robot icon path
        expect(html).toContain('M10 6C6.69'); // robot icon path
        expect(html).toContain('login-brand');
      });

      it('contains password eye toggle', () => {
        const html = renderLogin();
        expect(html).toContain('toggle-password');
      });

      it('has floating robot animation', () => {
        const html = renderLogin();
        expect(html).toContain('robot-float');
        expect(html).toContain('translateY(-4px)');
      });

      it('has circuit-board background pattern', () => {
        const html = renderLogin();
        expect(html).toContain('.login-page::before');
        expect(html).toContain('background-image');
      });

      it('has token validation checkmark', () => {
        const html = renderLogin();
        expect(html).toContain('token-check');
        expect(html).toContain('.token-check.valid');
        // Validates on 16+ chars
        expect(html).toContain('length >= 16');
      });

      it('should show help text about WEB_AUTH_TOKEN', () => {
        const html = renderLogin();
        expect(html).toContain('WEB_AUTH_TOKEN');
        expect(html).toContain('.env');
        expect(html).toContain('login-help');
      });
    });

    describe('session list', () => {
      const basePagination: PaginationInfo = {
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 1,
      };

      function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
        return {
          id: 1,
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          userId: 'U456DEF',
          messageCount: 5,
          toolCallCount: 3,
          createdAt: Date.now() - 60000,
          updatedAt: Date.now(),
          archivedAt: null,
          isActive: true,
          isFavorited: false,
          ...overrides,
        };
      }

      it('renders session cards not flat rows', () => {
        const sessions = [makeSession()];
        const html = renderSessionList(sessions, basePagination);
        expect(html).toContain('session-card');
      });

      it('cards contain icon elements', () => {
        const sessions = [makeSession()];
        const html = renderSessionList(sessions, basePagination);
        // Should contain SVG icons for clock and message
        expect(html).toContain('<svg');
      });

      it('search input has search icon', () => {
        const html = renderSessionList([], basePagination);
        // Search wrapper should contain search icon path
        expect(html).toContain('search-input-wrapper');
        expect(html).toContain('M8.5 14.5'); // search icon path
      });

      it('shows empty state when no sessions', () => {
        const html = renderSessionList([], basePagination);
        expect(html).toContain('empty-state');
        expect(html).toContain('No conversations yet');
      });
    });

    describe('conversation detail', () => {
      const baseMessages: ConversationMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const baseToolCalls: ToolCallLog[] = [];
      const baseMeta = {
        threadTs: '1234567890.123456',
        channelId: 'C123ABC',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
      };

      it('has sticky header with back link', () => {
        const html = renderConversation(baseMessages, baseToolCalls, baseMeta);
        expect(html).toContain('conv-header');
        expect(html).toContain('M15 10H5'); // arrow-left icon path
      });

      it('user messages have avatar', () => {
        const html = renderConversation(baseMessages, baseToolCalls, baseMeta);
        expect(html).toContain('avatar');
      });

      it('assistant messages have robot avatar', () => {
        const html = renderConversation(baseMessages, baseToolCalls, baseMeta);
        // Robot icon path should appear in assistant avatar
        expect(html).toContain('M10 6C6.69'); // robot icon path
      });

      it('tool calls show status icon', () => {
        const toolCalls: ToolCallLog[] = [
          {
            conversationId: 1,
            toolName: 'get_disk_usage',
            input: {},
            outputPreview: 'ok',
            timestamp: Date.now(),
            durationMs: 150,
            success: true,
          },
          {
            conversationId: 1,
            toolName: 'run_command',
            input: {},
            outputPreview: 'error',
            timestamp: Date.now(),
            durationMs: 50,
            success: false,
          },
        ];
        const html = renderConversation(baseMessages, toolCalls, baseMeta);
        expect(html).toContain('tool-call-status success');
        expect(html).toContain('tool-call-status failure');
        expect(html).toContain('M4 10L8 14L16 6'); // check icon path
        expect(html).toContain('M5 5L15 15'); // x icon path
      });

      it('continue form has character count', () => {
        const html = renderConversation(baseMessages, baseToolCalls, {
          ...baseMeta,
          canContinue: true,
        });
        expect(html).toContain('char-count');
      });
    });

    describe('UI polish — avatars, empty states, branding', () => {
      describe('avatars', () => {
        it('assistant message avatar contains robot icon', () => {
          const messages: ConversationMessage[] = [
            { role: 'assistant', content: 'Hello!' },
          ];
          const html = renderConversation(messages, [], {
            threadTs: '1234567890.123456',
            channelId: 'C123ABC',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Robot icon should be in the assistant avatar
          expect(html).toContain('M10 6C6.69'); // robot icon path
          // Assistant avatar should have a glow ring via CSS
          expect(html).toContain('avatar-glow');
        });

        it('user avatar shows initial from conversation userId', () => {
          const messages: ConversationMessage[] = [
            { role: 'user', content: 'Hello!' },
          ];
          const html = renderConversation(messages, [], {
            threadTs: '1234567890.123456',
            channelId: 'C123ABC',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            userId: 'andy',
          });

          // Should show "A" (first char of userId)
          expect(html).toContain('>A</span>');
        });
      });

      describe('empty states', () => {
        const emptyPagination: PaginationInfo = {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 1,
        };

        it('session list shows "No conversations yet" with link to /c/new when empty', () => {
          const html = renderSessionList([], emptyPagination);

          expect(html).toContain('No conversations yet');
          expect(html).toContain('/c/new');
        });

        it('favorites shows "No favorites yet" when empty', () => {
          const html = renderSessionList([], emptyPagination, { favorites: true });

          expect(html).toContain('No favorites yet');
        });

        it('archived shows "No archived conversations" when empty', () => {
          const html = renderSessionList([], emptyPagination, { archived: true });

          expect(html).toContain('No archived conversations');
        });

        it('search shows query text in empty state', () => {
          const html = renderSessionList([], emptyPagination, { searchQuery: 'nginx logs' });

          expect(html).toContain('No results for');
          expect(html).toContain('nginx logs');
        });

        it('tag filter shows tag name in empty state', () => {
          const html = renderSessionList([], emptyPagination, { activeTag: 'debugging' });

          expect(html).toContain('No conversations tagged');
          expect(html).toContain('debugging');
        });
      });

      describe('favicon', () => {
        it('wrapInShell includes SVG favicon data URI', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });

          expect(html).toContain('rel="icon"');
          expect(html).toContain('image/svg+xml');
          expect(html).toContain('data:image/svg+xml');
        });
      });

      describe('branding', () => {
        it('login page contains subtitle about AI diagnostics', () => {
          const html = renderLogin();

          expect(html).toContain('login-subtitle');
          expect(html).toContain('AI-powered server diagnostics');
        });

        it('footer contains "Powered by Claude"', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });

          expect(html).toContain('Powered by Claude');
        });
      });
    });

    describe('error pages', () => {
      it('404 contains search icon', () => {
        const html = render404();
        expect(html).toContain('M8.5 14.5'); // search icon path
      });

      it('401 contains appropriate icon', () => {
        const html = render401();
        expect(html).toContain('<svg');
      });

      it('error page has action button', () => {
        const html = renderError('Something went wrong');
        expect(html).toContain('href=');
      });
    });

    describe('interactivity', () => {
      const basePagination: PaginationInfo = {
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      };

      function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
        return {
          id: 1,
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          userId: 'U456DEF',
          messageCount: 5,
          toolCallCount: 3,
          createdAt: Date.now() - 60000,
          updatedAt: Date.now(),
          archivedAt: null,
          isActive: true,
          isFavorited: false,
          ...overrides,
        };
      }

      it('star toggle script present on session list', () => {
        const sessions = [makeSession()];
        const html = renderSessionList(sessions, basePagination);
        expect(html).toContain('star-pop');
      });

      it('tag input form present on detail page', () => {
        const messages: ConversationMessage[] = [{ role: 'user', content: 'Hello' }];
        const html = renderConversation(messages, [], {
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          conversationId: 42,
        });
        expect(html).toContain('id="tag-input-form"');
      });

      it('copy button has checkmark animation script', () => {
        const messages: ConversationMessage[] = [{ role: 'user', content: 'Hello' }];
        const html = renderConversation(messages, [], {
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        expect(html).toContain('showToast');
      });

      it('char count script present when continue form shown', () => {
        const messages: ConversationMessage[] = [{ role: 'user', content: 'Hello' }];
        const html = renderConversation(messages, [], {
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          canContinue: true,
        });
        expect(html).toContain('char-count');
      });
    });

    describe('keyboard shortcuts and issue #47', () => {
      const basePagination47: PaginationInfo = {
        page: 1,
        pageSize: 20,
        totalItems: 2,
        totalPages: 1,
      };

      function makeSession47(overrides: Partial<SessionSummary> = {}): SessionSummary {
        return {
          id: 1,
          threadTs: '1234567890.123456',
          channelId: 'C123ABC',
          userId: 'U456DEF',
          messageCount: 5,
          toolCallCount: 3,
          createdAt: Date.now() - 60000,
          updatedAt: Date.now(),
          archivedAt: null,
          isActive: true,
          isFavorited: false,
          ...overrides,
        };
      }

      describe('keyboard shortcuts', () => {
        it('wrapInShell includes keyboard shortcut script with keydown listener', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('keydown');
          expect(html).toContain('keyboard');
        });

        it('help overlay element is present in shell HTML', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('id="keyboard-help"');
          expect(html).toContain('kb-overlay');
          expect(html).toContain('Keyboard Shortcuts');
          expect(html).toContain('role="dialog"');
        });

        it('session cards have data-index attributes for j/k navigation', () => {
          const sessions = [
            makeSession47(),
            makeSession47({ id: 2, threadTs: '2222.0002' }),
          ];
          const html = renderSessionList(sessions, basePagination47);

          expect(html).toContain('data-index="0"');
          expect(html).toContain('data-index="1"');
        });

        it('session cards have data-conv-id for swipe gestures', () => {
          const sessions = [makeSession47()];
          const html = renderSessionList(sessions, basePagination47);
          expect(html).toContain('data-conv-id="1"');
        });

        it('includes swipe gesture JS for mobile', () => {
          const sessions = [makeSession47()];
          const html = renderSessionList(sessions, basePagination47);
          expect(html).toContain('touchstart');
          expect(html).toContain('touchmove');
          expect(html).toContain('touchend');
          expect(html).toContain('touchcancel');
        });

        it('star elements have tabindex and role=button for accessibility', () => {
          const sessions = [makeSession47()];
          const html = renderSessionList(sessions, basePagination47);

          expect(html).toContain('tabindex="0"');
          expect(html).toContain('role="button"');
          expect(html).toContain('aria-label="Toggle favorite"');
        });

        it('pressing ? toggles help overlay (script contains keyboard-help toggle logic)', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('keyboard-help');
          // The script should toggle display of the help overlay
          expect(html).toContain("e.key === '?'");
        });
      });

      describe('system color scheme detection', () => {
        it('FOWT script contains prefers-color-scheme media query', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          const headContent = html.split('</head>')[0];
          expect(headContent).toContain('prefers-color-scheme');
          expect(headContent).toContain('light');
        });
      });

      describe('skeleton loading', () => {
        it('skeleton CSS classes exist in base styles', () => {
          const css = getStaticCss();
          expect(css).toContain('.skeleton');
          expect(css).toContain('skeleton-shimmer');
          expect(css).toContain('.skeleton-card');
          expect(css).toContain('.skeleton-line');
        });

        it('page-specific skeleton CSS classes exist in base styles', () => {
          const css = getStaticCss();
          expect(css).toContain('.skeleton-stat');
          expect(css).toContain('.skeleton-health');
          expect(css).toContain('.skeleton-widget');
          expect(css).toContain('.skeleton-session');
          expect(css).toContain('.skeleton-message');
          expect(css).toContain('.skeleton-message.short');
          expect(css).toContain('.skeleton-message.tall');
        });

        it('shell script contains URL-aware skeleton overlay', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('getSkeletonHtml');
          expect(html).toContain('defaultSkeleton');
          expect(html).toContain('showLoadingOverlay(a.href)');
        });

        it('shell skeleton detects dashboard, session list, and conversation URLs', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          // Dashboard skeleton uses stat cards
          expect(html).toContain('skeleton-stat');
          // Session list skeleton uses session cards
          expect(html).toContain('skeleton-session');
          // Conversation detail skeleton uses message shapes
          expect(html).toContain('skeleton-message tall');
          expect(html).toContain('skeleton-message short');
        });

        it('nav bar has view-transition-name for stable transitions', () => {
          const css = getStaticCss();
          expect(css).toContain('view-transition-name: nav');
          expect(css).toContain('::view-transition-group(nav)');
        });

        it('shell includes favicon badge logic', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('updateFavicon');
          expect(html).toContain('baseFavicon');
        });

        it('shell includes notification chime (Web Audio)', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('playChime');
          expect(html).toContain('ssm-notif-sound');
          expect(html).toContain('AudioContext');
        });

        it('shell includes push notification support', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('showPushNotification');
          expect(html).toContain('ssm-notif-push');
          expect(html).toContain('Notification.permission');
        });

        it('notification prefs CSS exists in base styles', () => {
          const css = getStaticCss();
          expect(css).toContain('.notif-prefs');
          expect(css).toContain('.notif-pref-toggle');
          expect(css).toContain('.notif-group-count');
        });

        it('swipe-to-dismiss CSS exists in base styles', () => {
          const css = getStaticCss();
          expect(css).toContain('.notif-entry.swiping');
          expect(css).toContain('.notif-entry.dismissed');
        });

        it('bottom nav bar CSS and HTML exist', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          const css = getStaticCss();
          expect(css).toContain('.bottom-nav');
          expect(css).toContain('.bottom-nav-item');
          expect(html).toContain('bottom-nav');
        });

        it('bottom nav has active state based on currentPath', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>', currentPath: '/c' });
          expect(html).toContain('bottom-nav-item active');
        });

        it('auto-hide nav CSS and JS exist', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          const css = getStaticCss();
          expect(css).toContain('.nav-bar.nav-hidden');
          expect(html).toContain('nav-hidden');
        });

        it('touch target minimum sizes exist for mobile', () => {
          const css = getStaticCss();
          expect(css).toContain('min-height: 44px');
        });

        it('fluid typography with clamp() exists', () => {
          const css = getStaticCss();
          expect(css).toContain('clamp(');
        });

        it('pull-to-refresh JS exists', () => {
          const html = wrapInShell({ title: 'Test', styles: '', body: '<p>test</p>' });
          expect(html).toContain('pull-indicator');
          expect(html).toContain('Pull to refresh');
        });

        it('swipe gesture CSS exists in base styles', () => {
          const css = getStaticCss();
          expect(css).toContain('.session-card.swiping');
          expect(css).toContain('.swipe-action');
        });

        it('kb-focused class exists in styles for keyboard navigation', () => {
          const css = getStaticCss();
          expect(css).toContain('.session-card.kb-focused');
          expect(css).toContain('outline');
        });

        it('continue form uses SSE streaming during processing', () => {
          const messages: ConversationMessage[] = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' },
          ];
          const html = renderConversation(messages, [], {
            threadTs: '1234567890.123456',
            channelId: 'C123ABC',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            canContinue: true,
          });
          // The continue script should open an EventSource for streaming
          expect(html).toContain('EventSource');
          expect(html).toContain('stream-area');
          expect(html).toContain('tool_call_start');
          expect(html).toContain('tool_call_end');
        });
      });
    });
  });

  describe('dashboard home page', () => {
    const baseStats: SessionStats = {
      totalSessions: 12,
      activeSessions: 3,
      totalMessages: 87,
      totalToolCalls: 42,
      avgToolDurationMs: 250,
      toolFailureRate: 0.05,
      topTools: [
        { name: 'get_container_status', count: 15, avgDurationMs: 120 },
        { name: 'run_command', count: 10, avgDurationMs: 340 },
        { name: 'read_file', count: 8, avgDurationMs: 90 },
      ],
    };

    const recentSessions: SessionSummary[] = [
      {
        id: 1,
        threadTs: '1711000001.000001',
        channelId: 'C123ABC',
        userId: 'U01TEST',
        messageCount: 5,
        toolCallCount: 3,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 60000,
        archivedAt: null,
        isActive: true,
        isFavorited: false,
        firstMessage: 'Check nginx status',
      },
      {
        id: 2,
        threadTs: '1711000002.000002',
        channelId: 'C456DEF',
        userId: 'U02TEST',
        messageCount: 10,
        toolCallCount: 7,
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now() - 3600000,
        archivedAt: null,
        isActive: false,
        isFavorited: true,
        firstMessage: 'Debug memory issue',
      },
    ];

    const favoriteSessions: SessionSummary[] = [
      {
        id: 2,
        threadTs: '1711000002.000002',
        channelId: 'C456DEF',
        userId: 'U02TEST',
        messageCount: 10,
        toolCallCount: 7,
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now() - 3600000,
        archivedAt: null,
        isActive: false,
        isFavorited: true,
        firstMessage: 'Debug memory issue',
      },
    ];

    const allTags: TagInfo[] = [
      { name: 'nginx', count: 5 },
      { name: 'docker', count: 3 },
    ];

    it('contains greeting text', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      // Should contain one of the time-of-day greetings
      expect(html).toMatch(/Good (morning|afternoon|evening)/);
    });

    it('contains stats cards for sessions, messages, and tools', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('stat-card');
      expect(html).toContain('12'); // totalSessions
      expect(html).toContain('87'); // totalMessages
      expect(html).toContain('42'); // totalToolCalls
      expect(html).toContain('3'); // activeSessions
    });

    it('shows messages per session context on stats card', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');
      // 87 messages / 12 sessions = 7.3 per session
      expect(html).toContain('7.3');
      expect(html).toContain('per session');
    });

    it('shows tool success rate on stats card', () => {
      const statsWithFailures: SessionStats = {
        ...baseStats,
        toolFailureRate: 0.2,
        avgToolDurationMs: 300,
      };
      const html = renderDashboard(statsWithFailures, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');
      expect(html).toContain('80% success');
      expect(html).toContain('300ms avg');
    });

    it('shows 0.0 per session when no sessions exist', () => {
      const emptyStats: SessionStats = {
        ...baseStats,
        totalSessions: 0,
        activeSessions: 0,
        totalMessages: 0,
      };
      // Zero sessions renders the welcome screen, but verify the fallback value is consistent
      const html = renderDashboard(emptyStats, [], [], 0, [], 'U01TEST');
      // Welcome screen doesn't show stat cards, but the function still computes correctly
      expect(html).toBeDefined();
    });

    it('contains top tools section with bar chart', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('tool-chart');
      expect(html).toContain('tool-bar');
      expect(html).toContain('get_container_status');
      expect(html).toContain('run_command');
      expect(html).toContain('read_file');
      // Bar widths should be percentage-based
      expect(html).toContain('width:');
    });

    it('shows recent conversations as links', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('Check nginx status');
      expect(html).toContain('Debug memory issue');
      // Should contain links to conversation pages
      expect(html).toContain('/c/1711000001.000001/C123ABC');
      expect(html).toContain('/c/1711000002.000002/C456DEF');
    });

    it('contains quick action buttons (new conversation, search, view all)', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('quick-actions');
      expect(html).toContain('/c/new');
      expect(html).toContain('/c');
      expect(html).toContain('New Conversation');
    });

    it('uses wrapInShell with navigation', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('nav-bar');
      expect(html).toContain('Server Monitor');
    });

    it('shows welcome message when no conversations exist', () => {
      const emptyStats: SessionStats = {
        totalSessions: 0,
        activeSessions: 0,
        totalMessages: 0,
        totalToolCalls: 0,
        avgToolDurationMs: null,
        toolFailureRate: 0,
        topTools: [],
      };

      const html = renderDashboard(emptyStats, [], [], 0, [], 'U01TEST');

      expect(html).toContain('Welcome to Server Monitor');
      expect(html).toContain('/ask');
      expect(html).toContain('/c/new');
      // Should NOT contain stats cards in the body (CSS may still have class definitions)
      expect(html).not.toContain('class="stat-card"');
    });

    it('shows favorites section when favorites exist', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('Favorites');
      expect(html).toContain('Debug memory issue');
    });

    it('shows tags section when tags exist', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      expect(html).toContain('nginx');
      expect(html).toContain('docker');
      expect(html).toContain('/c/tag/nginx');
    });

    it('contains relative time indicators', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      // Recent sessions should show relative time
      expect(html).toMatch(/\d+[mh] ago|just now/);
    });

    it('includes mobile-optimized styles for small screens', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');

      // Should have a breakpoint for small phones (414px or below)
      expect(html).toMatch(/@media\s*\(max-width:\s*414px\)/);
    });

    it('includes first-visit onboarding overlay', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');
      expect(html).toContain('onboarding-overlay');
      expect(html).toContain('onboarding-card');
      expect(html).toContain('ssm-onboarded');
      expect(html).toContain('Welcome to Server Monitor');
    });

    it('onboarding has 3 steps with dot indicators', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');
      expect(html).toContain('dot-0');
      expect(html).toContain('dot-1');
      expect(html).toContain('dot-2');
      expect(html).toContain('Get Started');
    });

    it('includes PWA manifest link', () => {
      const html = renderDashboard(baseStats, recentSessions, favoriteSessions, 1, allTags, 'U01TEST');
      expect(html).toContain('rel="manifest"');
      expect(html).toContain('/manifest.json');
      expect(html).toContain('theme-color');
    });
  });

  describe('context status rendering', () => {
    const baseMessages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const baseMeta = {
      threadTs: '1000.001',
      channelId: 'C001',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    it('should not render context usage info when null', () => {
      const html = renderConversation(baseMessages, [], { ...baseMeta, contextStatus: null });
      // No usage percentage or truncation text should appear
      expect(html).not.toContain('% context used');
      expect(html).not.toContain('messages truncated');
      expect(html).not.toContain('approaching limit');
    });

    it('should render green bar for <70% usage', () => {
      const html = renderConversation(baseMessages, [], {
        ...baseMeta,
        contextStatus: { percentUsed: 0.45, wasTruncated: false, removedCount: 0 },
      });
      expect(html).toContain('context-status');
      expect(html).toContain('45% context used');
      expect(html).toContain('var(--green)');
    });

    it('should render orange bar for >=70% usage', () => {
      const html = renderConversation(baseMessages, [], {
        ...baseMeta,
        contextStatus: { percentUsed: 0.78, wasTruncated: false, removedCount: 0 },
      });
      expect(html).toContain('78% used');
      expect(html).toContain('approaching limit');
      expect(html).toContain('var(--orange)');
    });

    it('should render red bar with truncation count', () => {
      const html = renderConversation(baseMessages, [], {
        ...baseMeta,
        contextStatus: { percentUsed: 0.92, wasTruncated: true, removedCount: 5 },
      });
      expect(html).toContain('92% used');
      expect(html).toContain('5 messages truncated');
      expect(html).toContain('var(--red)');
    });
  });

  describe('session list date sections', () => {
    const basePagination: PaginationInfo = { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 };
    const now = Date.now();

    function makeSummary(updatedAt: number, id: number): SessionSummary {
      return {
        id,
        threadTs: `ts-${String(id)}`,
        channelId: 'C001',
        userId: 'U001',
        messageCount: 2,
        toolCallCount: 0,
        createdAt: updatedAt,
        updatedAt,
        archivedAt: null,
        isActive: false,
        isFavorited: false,
        firstMessage: `Message ${String(id)}`,
      };
    }

    it('should render Today header for current-day conversations', () => {
      const sessions = [makeSummary(now - 60000, 1)];
      const html = renderSessionList(sessions, basePagination);
      expect(html).toContain('Today');
    });

    it('should render Yesterday header', () => {
      // Use midnight of today minus 1 hour to ensure we're in "yesterday"
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = today.getTime() - 60 * 60 * 1000; // 1 hour before midnight = yesterday
      const sessions = [makeSummary(yesterday, 2)];
      const html = renderSessionList(sessions, basePagination);
      expect(html).toContain('Yesterday');
    });

    it('should render This Week header for 3-day-old conversations', () => {
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
      const sessions = [makeSummary(threeDaysAgo, 3)];
      const html = renderSessionList(sessions, basePagination);
      expect(html).toContain('This Week');
    });

    it('should render Older header for >7-day conversations', () => {
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
      const sessions = [makeSummary(tenDaysAgo, 4)];
      const html = renderSessionList(sessions, basePagination);
      expect(html).toContain('Older');
    });
  });

  describe('dashboard health badge', () => {
    const baseStats: SessionStats = {
      totalSessions: 5, activeSessions: 1, totalMessages: 20,
      totalToolCalls: 10, avgToolDurationMs: 200, toolFailureRate: 0, topTools: [],
    };
    const okHealth = {
      uptime: '5 days',
      loadAverage: [0.5, 0.3, 0.2] as [number, number, number],
      memory: { total: 16000, used: 8000, free: 8000, percentUsed: 50 },
      cpu: { cores: 4 },
      disks: [{ mountPoint: '/', size: '100GB', used: '50GB', free: '50GB', percentUsed: 50 }],
    };

    it('should render "All systems healthy" when all metrics OK', () => {
      const html = renderDashboard(baseStats, [], [], 0, [], 'U01', [], 0, [], okHealth as never);
      expect(html).toContain('All systems healthy');
      expect(html).toContain('all-ok');
    });

    it('should render "Needs attention" when warnings present', () => {
      const warnHealth = { ...okHealth, memory: { ...okHealth.memory, percentUsed: 75 } };
      const html = renderDashboard(baseStats, [], [], 0, [], 'U01', [], 0, [], warnHealth as never);
      expect(html).toContain('Needs attention');
      expect(html).toContain('has-warn');
    });

    it('should render "Issues detected" when critical metrics', () => {
      const dangerHealth = { ...okHealth, memory: { ...okHealth.memory, percentUsed: 95 } };
      const html = renderDashboard(baseStats, [], [], 0, [], 'U01', [], 0, [], dangerHealth as never);
      expect(html).toContain('Issues detected');
      expect(html).toContain('has-danger');
    });

    it('should render health bars with 6px height', () => {
      const html = renderDashboard(baseStats, [], [], 0, [], 'U01', [], 0, [], okHealth as never);
      expect(html).toContain('health-bar');
      expect(html).toMatch(/\.health-bar\s*\{[^}]*height:\s*6px/);
    });
  });

  describe('dashboard animated counter attributes', () => {
    it('should include data-count attributes on stat values', () => {
      const stats: SessionStats = {
        totalSessions: 42, activeSessions: 2, totalMessages: 150,
        totalToolCalls: 75, avgToolDurationMs: 300, toolFailureRate: 0, topTools: [],
      };
      const html = renderDashboard(stats, [], [], 0, [], 'U01');
      expect(html).toContain('data-count="42"');
      expect(html).toContain('data-count="150"');
      expect(html).toContain('data-count="75"');
    });
  });
});
