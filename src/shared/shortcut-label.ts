const KEY_LABELS: Record<string, string> = {
  control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', menu: 'Alt', shift: 'Shift',
  windows: 'Win', win: 'Win', meta: 'Win', super: 'Win', function: 'Fn', fn: 'Fn', space: 'Space'
};
// Presentation only. Native shortcut parsing and saved values keep their original names.
export function shortcutLabel(shortcut: string) {
  return shortcut.split('+').map(key => KEY_LABELS[key.trim().toLowerCase()] ?? key.trim()).join(' + ');
}
