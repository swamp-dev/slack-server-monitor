/**
 * Inline SVG icon system
 */

// ─── Icon System ───────────────────────────────────────────────────────

/**
 * SVG path data for inline icons. Each entry is an array of path `d` attributes
 * drawn inside a 0 0 20 20 viewBox with stroke="currentColor" fill="none".
 */
const ICON_PATHS: Record<string, string[]> = {
  home: ['M3 10.5L10 3.5L17 10.5', 'M5 9.5V16.5C5 17.05 5.45 17.5 6 17.5H8V12.5H12V17.5H14C14.55 17.5 15 17.05 15 16.5V9.5'],
  'arrow-left': ['M15 10H5', 'M10 15L5 10L10 5'],
  search: ['M8.5 14.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M13 13L17 17'],
  star: ['M10 2L12.39 7.26L18 7.97L14 11.82L14.94 17.5L10 14.77L5.06 17.5L6 11.82L2 7.97L7.61 7.26L10 2Z'],
  'star-filled': ['M10 2L12.39 7.26L18 7.97L14 11.82L14.94 17.5L10 14.77L5.06 17.5L6 11.82L2 7.97L7.61 7.26L10 2Z'],
  tag: ['M2.5 2.5H8.5L17.5 11.5L11.5 17.5L2.5 8.5V2.5Z', 'M6 6H6.01'],
  archive: ['M3 5H17', 'M4 5V16C4 16.55 4.45 17 5 17H15C15.55 17 16 16.55 16 16V5', 'M8 9H12'],
  copy: ['M13 3H7C5.9 3 5 3.9 5 5V13', 'M9 7H15C16.1 7 17 7.9 17 9V15C17 16.1 16.1 17 15 17H9C7.9 17 7 16.1 7 15V9C7 7.9 7.9 7 9 7Z'],
  download: ['M10 3V13', 'M6 9L10 13L14 9', 'M3 17H17'],
  send: ['M17 3L10 10', 'M17 3L12 17L10 10L3 8L17 3Z'],
  plus: ['M10 4V16', 'M4 10H16'],
  clock: ['M10 10L10 6', 'M10 10L13.5 13.5', 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  'message-circle': ['M10 18C14.42 18 18 14.42 18 10C18 5.58 14.42 2 10 2C5.58 2 2 5.58 2 10C2 11.73 2.54 13.34 3.46 14.66L2 18L5.34 16.54C6.66 17.46 8.27 18 10 18Z'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0-1.4L13.1 3.2a1 1 0 0 0-1.4 0l-1.3 1.3 2.8 2.8 1.5-1Z', 'M3 17l8.3-8.3 2.8 2.8L5.8 19.8a1 1 0 0 1-1.4 0L3 18.4a1 1 0 0 1 0-1.4Z'],
  'chevron-down': ['M5 7L10 12L15 7'],
  check: ['M4 10L8 14L16 6'],
  x: ['M5 5L15 15', 'M15 5L5 15'],
  eye: ['M2 10C2 10 5.5 4 10 4C14.5 4 18 10 18 10C18 10 14.5 16 10 16C5.5 16 2 10 2 10Z', 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  'eye-off': ['M2 2L18 18', 'M6.7 6.7C4.6 8 3 10 3 10C3 10 6 16 10 16C11.4 16 12.7 15.5 13.8 14.8', 'M10 4C14 4 17 10 17 10C17 10 16.3 11.4 15 12.5', 'M10 7.5a2.5 2.5 0 0 1 2.5 2.5'],
  robot: ['M10 6C6.69 6 4 8.69 4 12V14C4 15.1 4.9 16 6 16H14C15.1 16 16 15.1 16 14V12C16 8.69 13.31 6 10 6Z', 'M7.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z', 'M12.5 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z', 'M10 3V6', 'M6 3.5L8 6', 'M14 3.5L12 6'],
  logout: ['M9 17H5C4.45 17 4 16.55 4 16V4C4 3.45 4.45 3 5 3H9', 'M13 15L17 10L13 5', 'M17 10H7'],
  sun: ['M10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M10 1V3', 'M10 17V19', 'M3.22 3.22L4.64 4.64', 'M15.36 15.36L16.78 16.78', 'M1 10H3', 'M17 10H19', 'M3.22 16.78L4.64 15.36', 'M15.36 4.64L16.78 3.22'],
  moon: ['M17 10.5C17 14.09 14.09 17 10.5 17C6.91 17 4 14.09 4 10.5C4 6.91 6.91 4 10.5 4C10.5 4 9 7 10.5 9.5C12 12 15.5 10.5 15.5 10.5C16.5 10.5 17 10.5 17 10.5Z'],
  bell: ['M10 2C10.55 2 11 2.45 11 3V3.28C13.89 3.86 16 6.42 16 9.5V13L18 15H2L4 13V9.5C4 6.42 6.11 3.86 9 3.28V3C9 2.45 9.45 2 10 2Z', 'M8 15C8 16.1 8.9 17 10 17C11.1 17 12 16.1 12 15'],
  grid: ['M3 3H9V9H3V3Z', 'M11 3H17V9H11V3Z', 'M3 11H9V17H3V11Z', 'M11 11H17V17H11V11Z'],
};

/**
 * Return an inline SVG for the given icon name.
 * Returns empty string for unknown icons.
 */
export function icon(name: string, size = 20): string {
  const paths = ICON_PATHS[name];
  if (!paths) return '';

  const fill = name === 'star-filled' ? 'currentColor' : 'none';
  const pathsStr = paths.map((d) => `<path d="${d}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 20 20" fill="${fill}" stroke="currentColor" stroke-width="1.5">${pathsStr}</svg>`;
}
