import type { HistoryCapture, HistoryCursor, HistoryPage, HistoryResult } from './history';
import type { DeliveryRequest, DeliveryResult } from './delivery';
import type { CleanupRequest, CleanupResult } from './cleanup';
import type { TranscriptionRequest, Transcript, TranscriptionStatus } from './transcription';
import type { RecordingState } from './recording';
import type { WindowsState } from './windows';
export type Theme = 'system' | 'light' | 'dark';
export interface Preferences { theme: Theme; microphoneId: string; collapsed: boolean; shortcut: string }
export interface HistoryEntry { id: string; createdAt: string; text: string; words: number; durationMs: number; status: 'pending' | 'completed' | 'failed'; error?: string; originalText?: string; language?: import('./transcription').SpeechLanguage; cleanupEnabled?: boolean; audioMimeType?: string; audioBytes?: number }
export interface DayActivity { date: string; words: number }
export interface Snapshot { preferences: Preferences; history: HistoryEntry[]; activity: DayActivity[]; totalWords: number; recordingCount: number; totalDurationMs: number }
export interface RuntimeStatus { desktop: boolean; helper: boolean; api: boolean; auth: boolean; stt: boolean; cleanup: boolean }
export interface DesktopBridge {
  authState(): Promise<import('./auth').AuthState>;
  onAuthState(listener: (state: import('./auth').AuthState) => void): () => void;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signInGoogle(): Promise<void>;
  cancelGoogleSignIn(): Promise<void>;
  signOut(): Promise<void>;
  updateProfile(firstName: string, lastName: string): Promise<void>;
  saveHistory(request: HistoryCapture): Promise<void>;
  updateHistory(request: HistoryResult): Promise<void>;
  listHistory(cursor?: HistoryCursor): Promise<HistoryPage>;
  historyAudio(id: string): Promise<{ audio: ArrayBuffer; mimeType: string }>;
  retryHistory(id: string): Promise<void>;
  extractHistoryAudio(id: string): Promise<boolean>;
  copyHistoryText(id: string): Promise<void>;
  onHistoryChanged(listener: () => void): () => void;
  setWindowTheme(theme: 'light' | 'dark'): Promise<void>;
  copyOverlayText(noticeId: string): Promise<void>;
  resizeOverlay(height: number): Promise<void>;
  openSettings(): Promise<void>;
  onOpenSettings(listener: () => void): () => void;
  deliverText(request: DeliveryRequest): Promise<DeliveryResult>;
  cancelDelivery(sessionId: string): Promise<void>;
  cleanupTranscript(request: CleanupRequest): Promise<{ ok: true; result: CleanupResult } | { ok: false; code: string; message: string }>;
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
  onRecordingCommand(listener: (action: 'cancel' | 'finish') => void | Promise<void>): () => void;
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
