import { expect, it } from 'vitest';
import { publicAuthConfig, validEmail } from '../src/shared/auth';
import { serverSettings } from '../src/server/config';
it('accepts only a public Supabase HTTPS project and publishable key', () => {
  const valid = { SUPABASE_URL: 'https://fixtureproject.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture-key-12345' };
  expect(publicAuthConfig(valid)).toEqual({ url: valid.SUPABASE_URL, key: valid.SUPABASE_PUBLISHABLE_KEY });
  for (const url of ['http://fixtureproject.supabase.co', 'https://user:password@fixtureproject.supabase.co', 'https://other.example', 'https://fixtureproject.supabase.co/path']) expect(publicAuthConfig({ ...valid, SUPABASE_URL: url })).toBeUndefined();
  expect(publicAuthConfig({ ...valid, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not-client-safe' })).toBeUndefined();
  expect(() => serverSettings({ SUPABASE_URL: valid.SUPABASE_URL })).toThrow('incomplete or invalid');
});
it('bounds email input and rejects whitespace or missing domains', () => {
  expect(validEmail('user@example.com')).toBe(true); for (const email of ['not-an-email', 'a@', 'a b@example.com', 'a'.repeat(255)+'@example.com']) expect(validEmail(email)).toBe(false);
});
