import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { getCloudClient } from '../../../../packages/cloud/src/client';
import '../../../../packages/localization/src';
import { CloudPanel } from './CloudPanel';

vi.mock('../../../../packages/cloud/src/client', () => ({ getCloudClient: vi.fn() }));

afterEach(cleanup);

describe('mobile cloud account creation boundary', () => {
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(getCloudClient).mockReturnValue({
      auth: { onAuthStateChange: (callback: (event: string, session: null) => void) => {
        callback('INITIAL_SESSION', null);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      } },
    } as unknown as SupabaseClient);
  });

  it('allows existing-account sign-in but disables Android sign-up without confirmation links', () => {
    render(<CloudPanel />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    expect(screen.getByText(/Android sign-up confirmation links are not configured yet/)).toBeInTheDocument();
  });
});
