import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';

export function loadServerConfig() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try { loadEnvFile(envPath); } catch { throw new Error('Could not load the private backend environment file.'); }
  }
  return serverSettings(process.env);
}

export function serverSettings(environment: NodeJS.ProcessEnv) {
  const apiKey = environment.DEEPGRAM_API_KEY?.trim();
  return {
    apiKey: apiKey && /^[\x21-\x7e]{16,512}$/.test(apiKey) && !/your_|replace|paste/i.test(apiKey) ? apiKey : undefined,
    localMode: environment.SARGOSH_LOCAL_TRANSCRIPTION === '1' && environment.NODE_ENV !== 'production'
  };
}
