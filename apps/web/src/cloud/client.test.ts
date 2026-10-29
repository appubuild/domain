import { expect, it } from 'vitest';
import { isPublicConfiguration } from '../../../../packages/cloud/src/client';
const jwt = (role: string) => `a.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.c`;
it('accepts only HTTPS Supabase URLs and publishable or anon client keys', () => {
  expect(isPublicConfiguration('https://project.supabase.co', 'sb_publishable_public')).toBe(true);
  expect(isPublicConfiguration('https://project.supabase.co', jwt('anon'))).toBe(true);
  for (const [url, key] of [
    ['https://project.supabase.co', 'sb_secret_secret'], ['https://project.supabase.co', jwt('service_role')],
    ['https://evil.example', 'sb_publishable_public'], ['http://project.supabase.co', 'sb_publishable_public'],
    ['https://project.supabase.co/?secret=x', 'sb_publishable_public'],
  ]) expect(isPublicConfiguration(url, key)).toBe(false);
});
