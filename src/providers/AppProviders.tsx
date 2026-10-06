import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/overlays';
import { subscribeDatabase } from '@/store/db';

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

let invalidationTimer: ReturnType<typeof setTimeout> | undefined;

/** Any mock-database write invalidates cached queries so the UI stays truthful. */
function InvalidationBridge({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const unsubscribe = subscribeDatabase(() => {
      if (invalidationTimer) clearTimeout(invalidationTimer);
      invalidationTimer = setTimeout(() => {
        void appQueryClient.invalidateQueries();
      }, 60);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  return <>{children}</>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <InvalidationBridge>{children}</InvalidationBridge>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export const queryClient = appQueryClient;
