export const TITLE_BAR_HEIGHT = 48;
export function titleBarAppearance(theme: 'light' | 'dark') {
  return { height: TITLE_BAR_HEIGHT, color: theme === 'dark' ? '#20211f' : '#f4f3ef', symbolColor: theme === 'dark' ? '#eeeee8' : '#232622' };
}
