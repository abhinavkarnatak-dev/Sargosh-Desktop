import { describe, expect, it } from 'vitest';
import { serverSettings } from '../src/server/config';
describe('backend-only cloud configuration', () => {
  it('requires explicit local development mode and a real-looking key', () => {
    expect(serverSettings({}).apiKey).toBeUndefined();
    expect(serverSettings({ DEEPGRAM_API_KEY: 'your_actual_key_here' }).apiKey).toBeUndefined();
    expect(serverSettings({ DEEPGRAM_API_KEY: 'server-only-fixture-token', SARGOSH_LOCAL_TRANSCRIPTION: '1' })).toEqual({ apiKey: 'server-only-fixture-token', localMode: true });
    expect(serverSettings({ DEEPGRAM_API_KEY: 'server-only-fixture-token' }).localMode).toBe(false);
  });
  it('does not enable the unauthenticated development bridge in production', () => {
    expect(serverSettings({ NODE_ENV: 'production', SARGOSH_LOCAL_TRANSCRIPTION: '1', DEEPGRAM_API_KEY: 'server-only-fixture-token' }).localMode).toBe(false);
  });
  it('rejects key values containing internal control characters', () => {
    expect(serverSettings({ DEEPGRAM_API_KEY: 'first-part\nsecond-part' }).apiKey).toBeUndefined();
  });
});
