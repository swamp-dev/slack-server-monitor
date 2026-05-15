/**
 * Tests for the lift calculator web UI tab logic and rendering polish (#268).
 */
import { describe, it, expect } from 'vitest';
import { resolveActiveTab, formatLoadableHint, type CalcParams } from './web.js';

describe('resolveActiveTab', () => {
  it('defaults to plates when no params are set', () => {
    expect(resolveActiveTab({})).toBe('plates');
  });

  it('returns the explicit tab param when set', () => {
    expect(resolveActiveTab({ tab: 'rm' })).toBe('rm');
    expect(resolveActiveTab({ tab: 'wilks' })).toBe('wilks');
    expect(resolveActiveTab({ tab: 'dots' })).toBe('dots');
    expect(resolveActiveTab({ tab: 'plates' })).toBe('plates');
  });

  it('falls back to calc param when tab is not set (legacy URLs)', () => {
    expect(resolveActiveTab({ calc: 'rm' })).toBe('rm');
    expect(resolveActiveTab({ calc: 'wilks' })).toBe('wilks');
  });

  it('rejects unknown tab values and falls back to plates', () => {
    expect(resolveActiveTab({ tab: 'evil' })).toBe('plates');
  });

  it('rejects unknown legacy calc values and falls back to plates', () => {
    expect(resolveActiveTab({ calc: 'mystery' })).toBe('plates');
  });

  it('prefers explicit tab over calc param', () => {
    expect(resolveActiveTab({ tab: 'rm', calc: 'wilks' } as CalcParams)).toBe('rm');
  });
});

describe('formatLoadableHint', () => {
  it('returns null when there is no rounding note', () => {
    expect(formatLoadableHint(225, undefined, 'lbs')).toBeNull();
  });

  it('returns null when the note does not match the expected format', () => {
    expect(formatLoadableHint(225, 'something else entirely', 'lbs')).toBeNull();
  });

  it('returns null when target equals loadable (no diff)', () => {
    expect(formatLoadableHint(225, 'Rounded to 225 lbs (closest loadable weight)', 'lbs')).toBeNull();
  });

  it('renders a negative delta when rounded down', () => {
    const html = formatLoadableHint(227, 'Rounded to 225 lbs (closest loadable weight)', 'lbs');
    expect(html).toContain('Closest loadable');
    expect(html).toContain('225 lbs');
    expect(html).toContain('(-2 lbs)');
  });

  it('renders a positive delta with explicit + sign when rounded up', () => {
    const html = formatLoadableHint(223, 'Rounded to 225 lbs (closest loadable weight)', 'lbs');
    expect(html).toContain('(+2 lbs)');
  });

  it('formats kg unit using the actual computeResult note shape', () => {
    const html = formatLoadableHint(102, 'Rounded to 100 kg (closest loadable weight)', 'kg');
    expect(html).toContain('100 kg');
    expect(html).toContain('(-2 kg)');
  });
});
