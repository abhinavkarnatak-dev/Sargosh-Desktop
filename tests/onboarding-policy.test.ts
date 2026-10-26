import { expect, it } from 'vitest';
import { needsOnboarding, ONBOARDING_INTRODUCED_AT } from '../src/shared/auth';
it('shows onboarding only for new accounts that have not completed it', () => {
  expect(needsOnboarding('2026-10-25T00:00:00Z')).toBe(false);
  expect(needsOnboarding(undefined)).toBe(false);
  expect(needsOnboarding('bad date')).toBe(false);
  expect(needsOnboarding(ONBOARDING_INTRODUCED_AT)).toBe(true);
  expect(needsOnboarding(ONBOARDING_INTRODUCED_AT,{sargosh_onboarding_version:1})).toBe(false);
});
