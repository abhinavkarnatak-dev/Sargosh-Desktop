import { accountDeleter } from './account';
import { SupabaseUsageStore } from './usage';
import { publicAuthConfig } from '../shared/auth';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { DEFAULT_CLEANUP_MODEL, isGeminiCleanupModel } from '../shared/cleanup';

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
  const openaiKey = environment.OPENAI_API_KEY?.trim();
  if (environment.CLEANUP_PROVIDER && !['openai', 'gemini'].includes(environment.CLEANUP_PROVIDER)) throw new Error('CLEANUP_PROVIDER must be openai or gemini.');
  const cleanupProvider = (environment.CLEANUP_PROVIDER ?? (openaiKey ? 'openai' : 'gemini')) as 'openai' | 'gemini';
  const hostedMode=environment.SARGOSH_API_MODE==='hosted';
  let allowedHosts:string[]|undefined;
  if(hostedMode){
    const endpoint=environment.SARGOSH_PUBLIC_API_URL??environment.RENDER_EXTERNAL_URL;
    let url:URL;try{url=new URL(endpoint??'');}catch{throw new Error('Hosted API requires a public HTTPS URL.');}
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Hosted API requires a public HTTPS origin.');
    if(!authConfig||!environment.SUPABASE_SERVER_KEY||!apiKey||!(cleanupProvider==='openai'?openaiKey:geminiKey))throw new Error('Hosted API requires Supabase authentication, a server key, and provider keys.');
    allowedHosts=[url.host];
  }
  const sttRateMicroPerMinute=Number(environment.SARGOSH_STT_RATE_MICRO_PER_MINUTE??5200);
  if(!Number.isSafeInteger(sttRateMicroPerMinute)||sttRateMicroPerMinute<1||sttRateMicroPerMinute>1000000)throw new Error('Invalid transcription accounting rate.');
  const streamRateMicroPerMinute=Number(environment.SARGOSH_STREAM_RATE_MICRO_PER_MINUTE??9200);
  if(!Number.isSafeInteger(streamRateMicroPerMinute)||streamRateMicroPerMinute<1||streamRateMicroPerMinute>1000000)throw new Error('Invalid live transcription accounting rate.');
  return {
    streamingEnabled:hostedMode?environment.SARGOSH_STREAMING_ENABLED==='1':environment.SARGOSH_STREAMING_ENABLED!=='0',streamRateMicroPerMinute,
    hostedMode,allowedHosts,sttRateMicroPerMinute,cleanupProvider,
    openaiApiKey: openaiKey && /^[\x21-\x7e]{16,512}$/.test(openaiKey) && !/your_|replace|paste/i.test(openaiKey) ? openaiKey : undefined,
    deleteAccount: hostedMode ? accountDeleter(authConfig!.url, environment.SUPABASE_SERVER_KEY!.trim()) : undefined,
    usageStore:hostedMode?new SupabaseUsageStore(authConfig!.url,environment.SUPABASE_SERVER_KEY!.trim()):undefined,
    ffmpegPath:environment.FFMPEG_PATH||'ffmpeg',
    authConfig,
    apiKey: apiKey && /^[\x21-\x7e]{16,512}$/.test(apiKey) && !/your_|replace|paste/i.test(apiKey) ? apiKey : undefined,
    geminiApiKey: geminiKey && /^[\x21-\x7e]{16,512}$/.test(geminiKey) && !/your_|replace|paste/i.test(geminiKey) ? geminiKey : undefined,
    geminiModel: isGeminiCleanupModel(environment.GEMINI_MODEL) ? environment.GEMINI_MODEL : DEFAULT_CLEANUP_MODEL,
    localMode: environment.SARGOSH_LOCAL_TRANSCRIPTION === '1' && environment.NODE_ENV !== 'production'
  };
}
