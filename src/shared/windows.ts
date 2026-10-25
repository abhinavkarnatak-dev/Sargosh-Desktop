export interface WindowsState {
  revision: number;
  enabled: boolean;
  shortcut: string;
  phase: 'idle' | 'pending' | 'listening' | 'finished' | 'cancelled' | 'failed';
  mode: 'hold' | 'hands-free' | null;
  sessionId: string | null;
  target: { id: string; application: string } | null;
  deliveryAttempted: boolean;
  message: string;
}
export const INITIAL_WINDOWS_STATE: WindowsState = {
  revision: 0, enabled: false, shortcut: 'Control+Alt+Space', phase: 'idle',
  mode: null, sessionId: null, target: null, deliveryAttempted: false,
  message: 'Start the Windows input test to check shortcuts and destinations.'
};
