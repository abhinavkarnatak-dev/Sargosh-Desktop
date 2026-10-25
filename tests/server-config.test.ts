import { describe, expect, it } from 'vitest';
import { DEFAULT_CLEANUP_MODEL } from '../src/shared/cleanup';
import { serverSettings } from '../src/server/config';
describe('backend-only cloud configuration', () => {
  it('requires explicit local development mode and a real-looking key', () => {
    expect(serverSettings({}).apiKey).toBeUndefined();
    expect(serverSettings({ DEEPGRAM_API_KEY: 'your_actual_key_here' }).apiKey).toBeUndefined();
    expect(serverSettings({ DEEPGRAM_API_KEY: 'server-only-fixture-token', SARGOSH_LOCAL_TRANSCRIPTION: '1' })).toMatchObject({ apiKey: 'server-only-fixture-token', localMode: true });
    expect(serverSettings({ DEEPGRAM_API_KEY: 'server-only-fixture-token' }).localMode).toBe(false);
  });
  it('does not enable the unauthenticated development bridge in production', () => {
    expect(serverSettings({ NODE_ENV: 'production', SARGOSH_LOCAL_TRANSCRIPTION: '1', DEEPGRAM_API_KEY: 'server-only-fixture-token' }).localMode).toBe(false);
  });
  it('rejects key values containing internal control characters', () => {
    expect(serverSettings({ DEEPGRAM_API_KEY: 'first-part\nsecond-part' }).apiKey).toBeUndefined();
  });
  it('loads Gemini independently and restricts model selection to Flash-Lite', () => {
    expect(serverSettings({ GEMINI_API_KEY: 'server-only-gemini-fixture', GEMINI_MODEL: 'gemini-3.1-flash-lite' })).toMatchObject({ apiKey: undefined, geminiApiKey: 'server-only-gemini-fixture', geminiModel: 'gemini-3.1-flash-lite' });
    expect(serverSettings({ GEMINI_MODEL: 'arbitrary-expensive-model' }).geminiModel).toBe(DEFAULT_CLEANUP_MODEL);
  });
  it('does not accept placeholder Gemini credentials', () => {
    expect(serverSettings({ GEMINI_API_KEY: 'your_actual_key_here' }).geminiApiKey).toBeUndefined();
    expect(serverSettings({ GEMINI_API_KEY: 'first-part\nsecond-part' }).geminiApiKey).toBeUndefined();
  });

});
