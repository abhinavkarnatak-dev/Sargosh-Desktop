export interface WindowsState {
  revision: number;
  purpose?: 'input-test' | 'recording';
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
  revision: 0, purpose: 'input-test', enabled: false, shortcut: 'Control+Alt+Space', phase: 'idle',
  mode: null, sessionId: null, target: null, deliveryAttempted: false,
  message: 'Start the Windows input test to check shortcuts and destinations.'
};
