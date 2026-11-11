import * as React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { useApp } from '@/store/app';
import { Button, ErrorState, ToastViewport } from '@/components/ui';
import { ServerOff, RefreshCw, OctagonAlert } from 'lucide-react';

export function AppShell() {
  const { ready, connection, toasts, dismissToast, emergencyStop, bootstrap } = useApp();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape' && emergencyStop === false) {
        // Escape is the default configured stop hotkey; it only closes overlays here.
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emergencyStop]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-aurora">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onPalette={() => setPaletteOpen(true)} />
        {emergencyStop ? (
          <div className="flex items-center justify-between gap-3 border-b border-rose-500/25 bg-rose-500/10 px-6 py-2">
            <p className="flex items-center gap-2 text-xs text-rose-200">
              <OctagonAlert className="h-3.5 w-3.5" /> Emergency stop is engaged — every agent action is blocked.
            </p>
            <Button size="sm" variant="ghost" onClick={() => void useApp.getState().setEmergencyStop(false)}>
              Release stop
            </Button>
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {connection === 'offline' ? (
            <div className="mx-auto max-w-2xl px-6 py-16">
              <ErrorState message="The local AURA server is not reachable. Start it with `npm run dev` (or the desktop app), then retry. Your data stays in the local database — nothing was lost." onRetry={() => void bootstrap()} />
              <div className="mt-4 flex justify-center">
                <Button variant="ghost" onClick={() => void bootstrap()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                </Button>
              </div>
              <div className="mt-8 grid place-items-center text-slate-700">
                <ServerOff className="h-16 w-16" />
              </div>
            </div>
          ) : !ready ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-holo-500/20 border-t-holo-400" />
                <p className="text-xs text-slate-500">Connecting to the local agent…</p>
              </div>
            </div>
          ) : (
            <Outlet context={{ openPalette: () => setPaletteOpen(true), navigate }} />
          )}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
