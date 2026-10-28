export const TITLE_BAR_HEIGHT = 48;
export function titleBarAppearance(theme: 'light' | 'dark') {
  return { height: TITLE_BAR_HEIGHT, color: theme === 'dark' ? '#111813' : '#eeeee6', symbolColor: theme === 'dark' ? '#edf0e8' : '#233327' };
}
