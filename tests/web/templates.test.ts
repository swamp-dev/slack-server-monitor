import { describe, it, expect } from 'vitest';
import {
  renderConversation,
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

      expect(html).not.toContain('<script>');
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
});
