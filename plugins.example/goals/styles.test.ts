import { describe, it, expect } from 'vitest';
import { pluginStyles } from '../../src/web/plugin-helpers.js';
import { GOALS_CSS } from './styles.js';

/** Top-level selectors, i.e. those not nested inside an at-rule block. */
function topLevelSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];

    if (ch === '{') {
      const selector = buffer.trim();
      buffer = '';
      if (depth === 0 && selector !== '' && !selector.startsWith('@')) selectors.push(selector);
      depth++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      buffer = '';
      continue;
    }
    buffer += ch;
  }

  return selectors;
}

describe('goals styles', () => {
  it('leaves scoping to pluginStyles rather than hand-prefixing', () => {
    // A hand-written prefix would double up into ".plugin-goals .plugin-goals".
    expect(GOALS_CSS).not.toContain('.plugin-goals');
  });

  it('scopes every selector once pluginStyles has run', () => {
    const scoped = pluginStyles('goals', GOALS_CSS);

    const unscoped = topLevelSelectors(scoped)
      .flatMap((selector) => selector.split(','))
      .map((s) => s.trim())
      .filter((s) => s !== '' && !s.startsWith('.plugin-goals'));

    expect(unscoped).toEqual([]);
  });

  it('does not double-scope any selector', () => {
    expect(pluginStyles('goals', GOALS_CSS)).not.toContain('.plugin-goals .plugin-goals');
  });

  it('uses media queries and keyframes', () => {
    expect(GOALS_CSS).toContain('@media');
    expect(GOALS_CSS).toContain('@keyframes');
    expect(GOALS_CSS).toContain('prefers-reduced-motion');
  });

  it('keeps at-rule preludes intact through scoping', () => {
    const scoped = pluginStyles('goals', GOALS_CSS);

    expect(scoped).not.toContain('@.plugin-goals');
    expect(scoped).toContain('@media (max-width: 900px)');
    expect(scoped).toContain('@keyframes goals-breathe');
    expect(scoped).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('scopes the selectors nested inside a media query', () => {
    const scoped = pluginStyles('goals', GOALS_CSS);
    const block = scoped.slice(scoped.indexOf('@media (max-width: 640px)'));

    expect(block).toContain('.plugin-goals .goals-head');
  });

  it('does not scope keyframe stops', () => {
    const scoped = pluginStyles('goals', GOALS_CSS);

    expect(scoped).not.toContain('.plugin-goals 0%');
    expect(scoped).not.toContain('.plugin-goals 50%');
    expect(scoped).not.toContain('.plugin-goals 100%');
  });

  it('declares its custom properties on the runtime wrapper', () => {
    // The drag ghost and move menu are appended to .goals-root, so it has to
    // carry the variables they depend on.
    expect(GOALS_CSS).toContain('.goals-root {');
    expect(GOALS_CSS).toContain('--goals-column-width');
  });

  it('cannot break out of its style element', () => {
    expect(GOALS_CSS).not.toContain('</style');
  });

  it('respects reduced motion for the drag affordances', () => {
    const reduced = GOALS_CSS.slice(GOALS_CSS.indexOf('prefers-reduced-motion'));

    expect(reduced).toContain('.goals-ghost');
    expect(reduced).toContain('.goals-placeholder');
  });
});
