import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Mic, Search, ShieldCheck, ShieldAlert, Radio } from 'lucide-react';
import * as React from 'react';
import { useApp } from '@/store/app';
import { Badge, Button } from '@/components/ui';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { cn } from '@/lib/utils';

const TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Your agent at a glance' },
  '/voice': { title: 'Live Voice', subtitle: 'Real-time conversation with your character' },
  '/conversations': { title: 'Conversations', subtitle: 'Every chat is stored locally' },
  '/characters': { title: 'My Characters', subtitle: 'Create, switch and manage characters' },
  '/studio': { title: 'Character Studio', subtitle: 'Design identity, personality, voice and brain' },
  '/memory': { title: 'Memory Center', subtitle: 'Inspect and curate what each character remembers' },
  '/skills': { title: 'Skills & Tools', subtitle: 'Capabilities your agent can use' },
  '/tasks': { title: 'Agent Tasks', subtitle: 'Plan, run and verify multi-step work' },
  '/integrations': { title: 'Integrations', subtitle: 'Browsers, apps and MCP servers' },
  '/models': { title: 'AI Models', subtitle: 'Providers, keys and routing' },
  '/billing': { title: 'Usage & Billing', subtitle: 'License, subscription and API spend' },
  '/settings': { title: 'Settings', subtitle: 'Local storage, privacy and preferences' },
};

export function Topbar({ onPalette }: { onPalette: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { characters, activeCharacterId, setActiveCharacter, system, emergencyStop } = useApp();
  const meta = TITLES[location.pathname] ?? (location.pathname.startsWith('/studio') ? TITLES['/studio']! : { title: 'AURA', subtitle: '' });
  const active = characters.find((c) => c.id === activeCharacterId);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  return (
    <header className="z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-ink-950/60 px-6 backdrop-blur-xl">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-wide text-slate-100">{meta.title}</h1>
        {meta.subtitle ? <p className="truncate text-[11px] text-slate-500">{meta.subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onPalette}
          className="hidden items-center gap-2 rounded-xl border border-white/10 bg-ink-900/70 px-3 py-2 text-xs text-slate-500 transition-colors hover:border-white/20 hover:text-slate-300 md:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search or jump…</span>
          <kbd className="kbd ml-6">Ctrl K</kbd>
        </button>

        {emergencyStop ? (
          <Badge tone="bad">
            <Radio className="h-3 w-3" /> Stopped
          </Badge>
        ) : system?.capabilities.computerControl ? (
          <Badge tone="good">
            <ShieldCheck className="h-3 w-3" /> Desktop bridge
          </Badge>
        ) : (
          <span title="Computer control and browser automation run in the Windows desktop build">
            <Badge tone="warn">
              <ShieldAlert className="h-3 w-3" /> Server mode
            </Badge>
          </span>
        )}

        <div className="relative">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] py-1 pl-1 pr-2.5 transition-colors hover:border-holo-500/30"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            {active ? <AvatarOrb state="IDLE" accent={active.avatarSpec.palette.accent} size={26} /> : <span className="h-[26px] w-[26px] rounded-full bg-white/10" />}
            <span className="max-w-[120px] truncate text-xs text-slate-200">{active?.name ?? 'No character'}</span>
          </button>
          {pickerOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
              <div className="panel absolute right-0 z-40 mt-2 w-64 p-1.5" role="listbox">
                <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">Switch character</p>
                {characters.map((c) => (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={c.id === activeCharacterId}
                    onClick={() => {
                      setActiveCharacter(c.id);
                      setPickerOpen(false);
                    }}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5', c.id === activeCharacterId ? 'text-holo-200' : 'text-slate-300')}
                  >
                    <AvatarOrb state="IDLE" accent={c.avatarSpec.palette.accent} size={22} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.isDefault ? <span className="text-[9px] uppercase text-slate-500">default</span> : null}
                  </button>
                ))}
                {characters.length === 0 ? <p className="px-2 py-2 text-xs text-slate-500">No characters yet.</p> : null}
                <div className="my-1 h-px bg-white/5" />
                <button onClick={() => { setPickerOpen(false); navigate('/studio'); }} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-holo-300 hover:bg-white/5">
                  + Create character
                </button>
              </div>
            </>
          ) : null}
        </div>

        <Button variant="ghost" size="sm" onClick={() => navigate('/voice')} title="Open live voice">
          <Mic className="h-3.5 w-3.5" /> Voice
        </Button>
        <button className="relative rounded-xl border border-white/10 bg-white/[0.02] p-2 text-slate-400 hover:text-white" title="Notifications" aria-label="Notifications" onClick={() => navigate('/tasks')}>
          <Bell className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
