/**
 * Core utility functions for HTML templates
 *
 * Security-focused text escaping and markdown rendering.
 */

import { marked, type Renderer, type Tokens } from 'marked';

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape markdown characters that could create links or structure injection
 */
export function escapeMarkdown(text: string): string {
  // eslint-disable-next-line no-useless-escape
  return text.replace(/([`\[\]()\\])/g, '\\$1');
}

/**
 * Custom marked renderer for security and styling
 */
const renderer: Partial<Renderer> = {
  // Restrict links to http/https only, add rel="noopener noreferrer", escape all values
  link({ href, text }: Tokens.Link) {
    if (!href.startsWith('http://') && !href.startsWith('https://')) {
      return escapeHtml(text);
    }
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  },
  // Block raw HTML to prevent XSS
  html({ text }: Tokens.HTML) {
    return escapeHtml(text);
  },
};

// Configure marked with security-focused defaults
marked.use({
  renderer,
  gfm: true, // GitHub Flavored Markdown (tables, strikethrough)
  breaks: true, // Convert \n to <br>
});

/**
 * Convert markdown to HTML using marked with security renderer
 */
export function formatMarkdown(text: string): string {
  return marked.parse(text) as string;
}

/**
 * Format a timestamp as a readable date/time string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
