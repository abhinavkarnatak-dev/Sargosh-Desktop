export type Theme = 'system' | 'light' | 'dark';
export interface Preferences { theme: Theme; microphoneId: string; collapsed: boolean }
export interface HistoryEntry { id: string; createdAt: string; text: string; words: number; durationMs: number; status: 'completed' | 'failed'; error?: string }
export interface DayActivity { date: string; words: number }
export interface Snapshot { preferences: Preferences; history: HistoryEntry[]; activity: DayActivity[]; totalWords: number; recordingCount: number; totalDurationMs: number }
export interface RuntimeStatus { desktop: boolean; helper: boolean; api: boolean; auth: boolean; stt: boolean; cleanup: boolean }
export interface DesktopBridge {
  snapshot(): Promise<Snapshot>;
  preferences(update: Partial<Preferences>): Promise<Preferences>;
  status(): Promise<RuntimeStatus>;
  openMain(): Promise<void>;
  moveOverlay(dx: number, dy: number): Promise<void>;
  deleteEntry(id: string): Promise<void>;
}
export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', microphoneId: 'default', collapsed: false };
export const EMPTY_SNAPSHOT: Snapshot = { preferences: DEFAULT_PREFERENCES, history: [], activity: [], totalWords: 0, recordingCount: 0, totalDurationMs: 0 };
