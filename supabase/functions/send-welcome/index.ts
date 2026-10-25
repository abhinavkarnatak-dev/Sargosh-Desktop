import { createWelcomeHandler } from './worker.ts';
Deno.serve(createWelcomeHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  jobToken: Deno.env.get('WELCOME_JOB_TOKEN') ?? '',
  resendKey: Deno.env.get('RESEND_API_KEY') ?? '',
  from: Deno.env.get('WELCOME_FROM_EMAIL') ?? ''
}));
