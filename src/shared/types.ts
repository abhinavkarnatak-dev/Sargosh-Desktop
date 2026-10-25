import type { TranscriptionRequest, Transcript, TranscriptionStatus } from './transcription';
import type { RecordingState } from './recording';
import type { WindowsState } from './windows';
export type Theme = 'system' | 'light' | 'dark';
export interface Preferences { theme: Theme; microphoneId: string; collapsed: boolean; shortcut: string }
export interface HistoryEntry { id: string; createdAt: string; text: string; words: number; durationMs: number; status: 'completed' | 'failed'; error?: string }
export interface DayActivity { date: string; words: number }
export interface Snapshot { preferences: Preferences; history: HistoryEntry[]; activity: DayActivity[]; totalWords: number; recordingCount: number; totalDurationMs: number }
export interface RuntimeStatus { desktop: boolean; helper: boolean; api: boolean; auth: boolean; stt: boolean; cleanup: boolean }
export interface DesktopBridge {
  transcribeAudio(request: TranscriptionRequest): Promise<{ ok: true; result: Transcript } | { ok: false; code: string; message: string }>;
  cancelTranscription(requestId: string): Promise<void>;
  reportTranscription(status: TranscriptionStatus): Promise<void>;
  transcriptionStatus(): Promise<TranscriptionStatus>;
  onTranscriptionState(listener: (status: TranscriptionStatus) => void): () => void;
  startWindowsRecording(shortcut: string): Promise<WindowsState>;
  reportRecording(state: RecordingState): Promise<void>;
  recordingStatus(): Promise<RecordingState>;
  recordingAction(action: 'cancel' | 'finish'): Promise<void>;
  onRecordingState(listener: (state: RecordingState) => void): () => void;
  onRecordingCommand(listener: (action: 'cancel' | 'finish') => void): () => void;
  windowsStatus(): Promise<WindowsState>;
  startWindowsTest(shortcut: string): Promise<WindowsState>;
  windowsAction(action: 'cancel' | 'finish' | 'start-hands-free' | 'disarm'): Promise<WindowsState>;
  insertWindowsTest(sessionId: string): Promise<WindowsState>;
  onWindowsState(listener: (state: WindowsState) => void): () => void;
  snapshot(): Promise<Snapshot>;
  preferences(update: Partial<Preferences>): Promise<Preferences>;
  status(): Promise<RuntimeStatus>;
  openMain(): Promise<void>;
  moveOverlay(dx: number, dy: number): Promise<void>;
  deleteEntry(id: string): Promise<void>;
}
export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', microphoneId: 'default', collapsed: false, shortcut: 'Control+Alt+Space' };
export const EMPTY_SNAPSHOT: Snapshot = { preferences: DEFAULT_PREFERENCES, history: [], activity: [], totalWords: 0, recordingCount: 0, totalDurationMs: 0 };
