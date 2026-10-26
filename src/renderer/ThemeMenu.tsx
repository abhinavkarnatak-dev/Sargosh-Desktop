import { Monitor, Moon, Sun } from 'lucide-react';
import type { Theme } from '../shared/types';
import { ThemedSelect } from './ThemedSelect';
const options = [
  { value: 'light', label: 'Light', icon: <Sun size={16} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Monitor size={16} aria-hidden="true" /> }
];
export function ThemeMenu({ theme, onChange }: { theme: Theme; onChange(theme: Theme): void }) {
  return <ThemedSelect tooltip="Theme" label={'Change theme, current theme: ' + theme} compact triggerIcon={options.find(option => option.value === theme)?.icon} value={theme} options={options} onChange={value => { if (value === 'light' || value === 'dark' || value === 'system') onChange(value); }} />;
}
