import { useEffect, useState } from 'react';
import { INITIAL_AUTH, type AuthState } from '../shared/auth';
export function useAuth() {
  const [state, setState] = useState<AuthState>({ ...INITIAL_AUTH, phase: window.sargosh?.authState ? 'loading' : 'signed-out' });
  useEffect(() => {
    if (!window.sargosh?.authState) return;
    let alive = true; let changed = false;
    const unsubscribe = window.sargosh.onAuthState(value => { changed = true; if (alive) setState(value); });
    void window.sargosh.authState().then(value => { if (alive && !changed) setState(value); }, () => { if (alive && !changed) setState({ ...INITIAL_AUTH, phase: 'signed-out', message: 'Restart the desktop app to connect sign-in.' }); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return state;
}
