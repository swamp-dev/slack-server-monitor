/**
 * Web Assistant Plugin - Web Search & Page Fetching
 *
 * Tier 1 internet capabilities as a plugin (safe, read-only):
 * - web_search: Search the web via DuckDuckGo HTML-lite (no API key)
 * - fetch_page: Fetch a URL and return stripped text content
 *
 * Security:
 * - HTTPS/HTTP only (no file://, ftp://, etc.)
 * - Blocks private/internal IP addresses (127.x, 10.x, 172.16-31.x, 192.168.x, localhost)
 * - 10-second timeout on all fetches
 * - Response truncated to 10,000 characters
 * - No POST or write operations
 *
 * To use:
 *   mkdir plugins.local
 *   cp plugins.example/web-assistant.ts plugins.local/
 *   npm run dev
 */

import type { Plugin } from '../src/plugins/index.js';
import type { ToolDefinition } from '../src/services/tools/types.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_RESULTS = 5;
const MAX_PAGE_LENGTH = 10_000;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; SlackServerMonitor/1.0; +https://github.com)';

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Private/internal IP patterns to block in fetch_page.
 * Prevents SSRF attacks against internal services.
 */
const BLOCKED_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^\[::1\]$/,
  /^localhost$/i,
];

/**
 * Validate that a URL is safe to fetch (http/https, no private IPs).
 */
export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { safe: false, reason: 'URL must start with http:// or https://' };
  }

  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: `Blocked: private/internal address (${hostname})` };
    }
  }

  return { safe: true };
}

// =============================================================================
// HTML Parsing Helpers
// =============================================================================

/**
 * Strip HTML tags from a string.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Decode common HTML entities.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parse DuckDuckGo HTML search results.
 * Returns structured results with title, URL, and snippet.
 */
export function parseDdgResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match result links: <a rel="nofollow" class="result__a" href="URL">Title</a>
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  // Match snippets: <a class="result__snippet" ...>Snippet</a>
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: Array<{ url: string; title: string }> = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    links.push({
      url: decodeHtmlEntities(linkMatch[1]),
      title: decodeHtmlEntities(stripHtmlTags(linkMatch[2])),
    });
  }

  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(decodeHtmlEntities(stripHtmlTags(snippetMatch[1])));
  }

  for (let i = 0; i < Math.min(links.length, MAX_RESULTS); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

/**
 * Format search results for display.
 */
export function formatSearchResults(results: Array<{ title: string; url: string; snippet: string }>): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
}

// =============================================================================
// Tool Implementations
// =============================================================================

const webSearchTool: ToolDefinition = {
  spec: {
    name: 'web_search',
    description: 'Search the web for information. Returns top 5 results with titles, URLs, and snippets.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  execute: async (input) => {
    const query = String(input.query || '').trim();
    if (!query) {
      return 'Error: query is required';
    }

    try {
      const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return `Error: search request failed with status ${response.status}`;
      }

      const html = await response.text();
      const results = parseDdgResults(html);
      return formatSearchResults(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: failed to search — ${message}`;
    }
  },
};

const fetchPageTool: ToolDefinition = {
  spec: {
    name: 'fetch_page',
    description: 'Fetch a web page and return its text content (HTML stripped). Max 10,000 characters.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch (must be http or https)' },
      },
      required: ['url'],
    },
  },
  execute: async (input) => {
    const url = String(input.url || '').trim();
    if (!url) {
      return 'Error: url is required';
    }

    const validation = isUrlSafe(url);
    if (!validation.safe) {
      return `Error: ${validation.reason}`;
    }

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        return `Error: request failed with status ${response.status}`;
      }

      const html = await response.text();
      const text = decodeHtmlEntities(stripHtmlTags(html))
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > MAX_PAGE_LENGTH) {
        return text.slice(0, MAX_PAGE_LENGTH) + '\n\n[Truncated — content exceeded 10,000 characters]';
      }

      return text || '(empty page)';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: failed to fetch page — ${message}`;
    }
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

const webAssistant: Plugin = {
  name: 'web-assistant',
  version: '1.0.0',
  description: 'Web search and page fetching for general-purpose assistance',

  helpEntries: [
    { command: '(Claude tool)', description: 'web_search — Search the web for information' },
    { command: '(Claude tool)', description: 'fetch_page — Fetch and read a web page' },
  ],

  tools: [webSearchTool, fetchPageTool],
};

export default webAssistant;
