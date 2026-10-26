// Ephemeral context: practice never becomes part of saved dictation history.
let session: string | null = null;
export const practiceSession = () => session;
export function setPracticeSession(value: string | null) { session = value; }
