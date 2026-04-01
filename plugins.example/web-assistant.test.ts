/**
 * Tests for the web-assistant plugin
 *
 * Tests cover: web_search tool, fetch_page tool, URL validation,
 * HTML parsing, and error handling.
 *
 * All network requests are mocked via global.fetch.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isUrlSafe,
  stripHtmlTags,
  decodeHtmlEntities,
  parseDdgResults,
  formatSearchResults,
} from './web-assistant.js';

// Import the plugin to access tools
import webAssistant from './web-assistant.js';
import type { ToolConfig } from '../src/services/tools/types.js';

// =============================================================================
// Test Setup
// =============================================================================

const toolConfig: ToolConfig = {
  allowedDirs: [],
  maxFileSizeKb: 100,
  maxLogLines: 50,
};

function getWebSearchTool() {
  const tool = webAssistant.tools?.find((t) => t.spec.name === 'web_search');
  if (!tool) throw new Error('web_search tool not found');
  return tool;
}

function getFetchPageTool() {
  const tool = webAssistant.tools?.find((t) => t.spec.name === 'fetch_page');
  if (!tool) throw new Error('fetch_page tool not found');
  return tool;
}

// Sample DuckDuckGo HTML response
const SAMPLE_DDG_HTML = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.com/page1">Example Page One</a>
    </h2>
    <a class="result__snippet" href="https://example.com/page1">This is the first result snippet.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.com/page2">Example &amp; Page Two</a>
    </h2>
    <a class="result__snippet" href="https://example.com/page2">Second result with &lt;html&gt; entities.</a>
  </div>
</div>
`;

// =============================================================================
// Pure Function Tests
// =============================================================================

describe('isUrlSafe', () => {
  it('should accept http URLs', () => {
    expect(isUrlSafe('http://example.com')).toEqual({ safe: true });
  });

  it('should accept https URLs', () => {
    expect(isUrlSafe('https://example.com/path?q=test')).toEqual({ safe: true });
  });

  it('should reject non-http(s) URLs', () => {
    expect(isUrlSafe('ftp://example.com').safe).toBe(false);
    expect(isUrlSafe('file:///etc/passwd').safe).toBe(false);
    expect(isUrlSafe('javascript:alert(1)').safe).toBe(false);
  });

  it('should block 127.x.x.x addresses', () => {
    const result = isUrlSafe('http://127.0.0.1/admin');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('private/internal');
  });

  it('should block 10.x.x.x addresses', () => {
    const result = isUrlSafe('http://10.0.0.1:8080');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('private/internal');
  });

  it('should block 192.168.x.x addresses', () => {
    const result = isUrlSafe('http://192.168.1.1');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('private/internal');
  });

  it('should block 172.16-31.x.x addresses', () => {
    expect(isUrlSafe('http://172.16.0.1').safe).toBe(false);
    expect(isUrlSafe('http://172.31.255.255').safe).toBe(false);
    // 172.32.x.x is not private
    expect(isUrlSafe('http://172.32.0.1').safe).toBe(true);
  });

  it('should block localhost', () => {
    expect(isUrlSafe('http://localhost').safe).toBe(false);
    expect(isUrlSafe('http://localhost:3000').safe).toBe(false);
  });

  it('should block ::1 (IPv6 loopback)', () => {
    expect(isUrlSafe('http://[::1]').safe).toBe(false);
  });

  it('should block IPv4-mapped IPv6 (SSRF bypass)', () => {
    expect(isUrlSafe('http://[::ffff:127.0.0.1]').safe).toBe(false);
    expect(isUrlSafe('http://[::ffff:10.0.0.1]').safe).toBe(false);
    expect(isUrlSafe('http://[::ffff:192.168.1.1]').safe).toBe(false);
  });

  it('should block IPv6 private ranges', () => {
    expect(isUrlSafe('http://[fc00::1]').safe).toBe(false);
    expect(isUrlSafe('http://[fd12::1]').safe).toBe(false);
    expect(isUrlSafe('http://[fe80::1]').safe).toBe(false);
  });

  it('should block .local mDNS hostnames', () => {
    expect(isUrlSafe('http://nas.local').safe).toBe(false);
    expect(isUrlSafe('http://printer.local:9100').safe).toBe(false);
  });

  it('should reject non-http(s) schemes', () => {
    expect(isUrlSafe('ftp://example.com').safe).toBe(false);
    expect(isUrlSafe('file:///etc/passwd').safe).toBe(false);
  });
});

describe('stripHtmlTags', () => {
  it('should remove HTML tags', () => {
    expect(stripHtmlTags('<b>bold</b> text')).toBe('bold text');
  });

  it('should handle nested tags', () => {
    expect(stripHtmlTags('<div><span>hello</span></div>')).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('should strip script blocks including content', () => {
    expect(stripHtmlTags('<p>hi</p><script>var x="secret";</script><p>bye</p>')).toBe('hibye');
  });

  it('should strip style blocks including content', () => {
    expect(stripHtmlTags('<p>hi</p><style>.x{color:red}</style><p>bye</p>')).toBe('hibye');
  });
});

describe('decodeHtmlEntities', () => {
  it('should decode &amp;', () => {
    expect(decodeHtmlEntities('one &amp; two')).toBe('one & two');
  });

  it('should decode &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
  });

  it('should decode &quot; and &#x27;', () => {
    expect(decodeHtmlEntities('&quot;quoted&#x27;')).toBe('"quoted\'');
  });

  it('should decode &nbsp;', () => {
    expect(decodeHtmlEntities('hello&nbsp;world')).toBe('hello world');
  });
});

describe('parseDdgResults', () => {
  it('should parse results from DuckDuckGo HTML', () => {
    const results = parseDdgResults(SAMPLE_DDG_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Example Page One',
      url: 'https://example.com/page1',
      snippet: 'This is the first result snippet.',
    });
    expect(results[1]).toEqual({
      title: 'Example & Page Two',
      url: 'https://example.com/page2',
      snippet: 'Second result with <html> entities.',
    });
  });

  it('should return empty array for no results', () => {
    const results = parseDdgResults('<html><body>No results</body></html>');
    expect(results).toEqual([]);
  });

  it('should limit to 5 results', () => {
    // Build HTML with 7 results
    let html = '';
    for (let i = 0; i < 7; i++) {
      html += `<a class="result__a" href="https://example.com/${i}">Result ${i}</a>`;
      html += `<a class="result__snippet">Snippet ${i}</a>`;
    }
    const results = parseDdgResults(html);
    expect(results).toHaveLength(5);
  });
});

describe('formatSearchResults', () => {
  it('should format results with numbered list', () => {
    const results = [
      { title: 'Title 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
      { title: 'Title 2', url: 'https://example.com/2', snippet: 'Snippet 2' },
    ];
    const formatted = formatSearchResults(results);
    expect(formatted).toContain('1. Title 1');
    expect(formatted).toContain('   https://example.com/1');
    expect(formatted).toContain('   Snippet 1');
    expect(formatted).toContain('2. Title 2');
  });

  it('should return message for empty results', () => {
    expect(formatSearchResults([])).toBe('No results found.');
  });
});

// =============================================================================
// web_search Tool Tests
// =============================================================================

describe('web_search tool', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should return formatted results for a valid query', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_DDG_HTML,
    });

    const tool = getWebSearchTool();
    const result = await tool.execute({ query: 'test query' }, toolConfig);

    expect(result).toContain('1. Example Page One');
    expect(result).toContain('https://example.com/page1');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify the URL includes the encoded query
    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain('q=test%20query');
  });

  it('should URL-encode the query', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html></html>',
    });

    const tool = getWebSearchTool();
    await tool.execute({ query: 'hello world & more' }, toolConfig);

    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain('q=hello%20world%20%26%20more');
  });

  it('should handle empty results gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>No results found</body></html>',
    });

    const tool = getWebSearchTool();
    const result = await tool.execute({ query: 'xyznosuchquery' }, toolConfig);
    expect(result).toBe('No results found.');
  });

  it('should handle fetch error gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const tool = getWebSearchTool();
    const result = await tool.execute({ query: 'test' }, toolConfig);
    expect(result).toContain('Error: failed to search');
    expect(result).toContain('Network error');
  });

  it('should handle HTTP error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const tool = getWebSearchTool();
    const result = await tool.execute({ query: 'test' }, toolConfig);
    expect(result).toContain('Error: search request failed with status 503');
  });

  it('should return error for empty query', async () => {
    const tool = getWebSearchTool();
    const result = await tool.execute({ query: '' }, toolConfig);
    expect(result).toContain('Error: query is required');
  });
});

// =============================================================================
// fetch_page Tool Tests
// =============================================================================

describe('fetch_page tool', () => {
  const originalFetch = global.fetch;
  const hdr = { get: (n: string) => n === 'content-type' ? 'text/html; charset=utf-8' : null };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should return text content for a valid URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: hdr,
      text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://example.com' }, toolConfig);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('<p>');
  });

  it('should strip HTML tags', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: hdr,
      text: async () => '<div class="main"><a href="/link">Click <b>here</b></a></div>',
    });

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://example.com' }, toolConfig);
    expect(result).toBe('Click here');
  });

  it('should truncate long content to 10,000 characters', async () => {
    const longContent = '<html><body>' + 'a'.repeat(15_000) + '</body></html>';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: hdr,
      text: async () => longContent,
    });

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://example.com' }, toolConfig);
    expect(result).toContain('[Truncated');
    // 10,000 chars of content + truncation message
    expect(result.length).toBeLessThan(11_000);
  });

  it('should reject non-http(s) URLs', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'ftp://example.com/file' }, toolConfig);
    expect(result).toContain('Error');
    expect(result).toContain('http');
  });

  it('should block private IP 127.0.0.1', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'http://127.0.0.1/admin' }, toolConfig);
    expect(result).toContain('Error');
    expect(result).toContain('private/internal');
  });

  it('should block private IP 10.x', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'http://10.0.0.5:8080' }, toolConfig);
    expect(result).toContain('Error');
    expect(result).toContain('private/internal');
  });

  it('should block private IP 192.168.x', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'http://192.168.1.100' }, toolConfig);
    expect(result).toContain('Error');
    expect(result).toContain('private/internal');
  });

  it('should block localhost', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'http://localhost:3000' }, toolConfig);
    expect(result).toContain('Error');
    expect(result).toContain('private/internal');
  });

  it('should handle fetch timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://slow-site.example.com' }, toolConfig);
    expect(result).toContain('Error: failed to fetch page');
    expect(result).toContain('aborted');
  });

  it('should handle fetch error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://nonexistent.example.com' }, toolConfig);
    expect(result).toContain('Error: failed to fetch page');
    expect(result).toContain('DNS resolution failed');
  });

  it('should handle HTTP error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://example.com/missing' }, toolConfig);
    expect(result).toContain('Error: request failed with status 404');
  });

  it('should return (empty page) for blank content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: hdr,
      text: async () => '',
    });

    const tool = getFetchPageTool();
    const result = await tool.execute({ url: 'https://example.com' }, toolConfig);
    expect(result).toBe('(empty page)');
  });

  it('should return error for empty URL', async () => {
    const tool = getFetchPageTool();
    const result = await tool.execute({ url: '' }, toolConfig);
    expect(result).toContain('Error: url is required');
  });
});

// =============================================================================
// Plugin Structure Tests
// =============================================================================

describe('web-assistant plugin structure', () => {
  it('should have correct metadata', () => {
    expect(webAssistant.name).toBe('web_assistant');
    expect(webAssistant.version).toBe('1.0.0');
    expect(webAssistant.description).toBeDefined();
  });

  it('should have two tools', () => {
    const tools = webAssistant.tools;
    expect(tools).toHaveLength(2);
    expect(tools).toBeDefined();
    expect(tools?.[0].spec.name).toBe('web_search');
    expect(tools?.[1].spec.name).toBe('fetch_page');
  });

  it('should have help entries', () => {
    const entries = webAssistant.helpEntries;
    expect(entries).toHaveLength(2);
    expect(entries).toBeDefined();
    expect(entries?.[0].description).toContain('web_search');
    expect(entries?.[1].description).toContain('fetch_page');
  });

  it('should not have registerCommands (tools-only plugin)', () => {
    expect(webAssistant.registerCommands).toBeUndefined();
  });

  it('should not have init or destroy hooks', () => {
    expect(webAssistant.init).toBeUndefined();
    expect(webAssistant.destroy).toBeUndefined();
  });
});
