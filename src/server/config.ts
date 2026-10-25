import { publicAuthConfig } from '../shared/auth';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { DEFAULT_CLEANUP_MODEL, isCleanupModel } from '../shared/cleanup';

export function loadServerConfig() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try { loadEnvFile(envPath); } catch { throw new Error('Could not load the private backend environment file.'); }
  }
  return serverSettings(process.env);
}

export function serverSettings(environment: NodeJS.ProcessEnv) {
  const authConfig = publicAuthConfig(environment);
  if ((environment.SUPABASE_URL || environment.SUPABASE_PUBLISHABLE_KEY) && !authConfig) throw new Error('Supabase configuration is incomplete or invalid.');
  const apiKey = environment.DEEPGRAM_API_KEY?.trim();
  const geminiKey = environment.GEMINI_API_KEY?.trim();
  return {
    authConfig,
    apiKey: apiKey && /^[\x21-\x7e]{16,512}$/.test(apiKey) && !/your_|replace|paste/i.test(apiKey) ? apiKey : undefined,
    geminiApiKey: geminiKey && /^[\x21-\x7e]{16,512}$/.test(geminiKey) && !/your_|replace|paste/i.test(geminiKey) ? geminiKey : undefined,
    geminiModel: isCleanupModel(environment.GEMINI_MODEL) ? environment.GEMINI_MODEL : DEFAULT_CLEANUP_MODEL,
    localMode: environment.SARGOSH_LOCAL_TRANSCRIPTION === '1' && environment.NODE_ENV !== 'production'
  };
}
