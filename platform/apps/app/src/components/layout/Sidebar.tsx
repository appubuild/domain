import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  AudioLines,
  MessagesSquare,
  Users,
  Sparkles,
  Brain,
  Wrench,
  ListChecks,
  Plug,
  Cpu,
  CreditCard,
  Settings,
  OctagonAlert,
  ChevronLeft,
  CircleDot,
} from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '@/store/app';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { Button } from '@/components/ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/voice', label: 'Live Voice', icon: AudioLines },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/characters', label: 'My Characters', icon: Users },
  { to: '/studio', label: 'Character Studio', icon: Sparkles },
  { to: '/memory', label: 'Memory Center', icon: Brain },
  { to: '/skills', label: 'Skills & Tools', icon: Wrench },
  { to: '/tasks', label: 'Agent Tasks', icon: ListChecks },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/models', label: 'AI Models', icon: Cpu },
  { to: '/billing', label: 'Usage & Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem('aura.sidebar') === 'collapsed');
  const { connection, health, activeCharacterId, characters, emergencyStop, setEmergencyStop } = useApp();
  const active = characters.find((c) => c.id === activeCharacterId) ?? null;
  const location = useLocation();

  React.useEffect(() => {
    localStorage.setItem('aura.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  return (
    <aside className={cn('relative z-20 flex shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/80 backdrop-blur-xl transition-[width] duration-300', collapsed ? 'w-[76px]' : 'w-[248px]')}>
      <div className="flex h-16 items-center gap-2.5 px-4">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-holo-500/30 bg-holo-500/10 shadow-glow">
          <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-holo-400/20 to-transparent" />
          <LogoMark />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.18em] text-slate-100">AURA</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">Personal AI Agent</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 pt-1" aria-label="Main navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-all duration-200',
                  isActive
                    ? 'bg-holo-500/[0.12] text-holo-100 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.22)]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-[17px] w-[17px] shrink-0 transition-colors', isActive ? 'text-holo-300' : 'text-slate-500 group-hover:text-slate-300')} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && isActive && <ChevronLeft className="ml-auto h-3 w-3 rotate-180 text-holo-400/70" />}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className={cn('space-y-2 border-t border-white/[0.06] p-3', collapsed && 'items-center')}>
        {active && (
          <NavLink to="/characters" className={cn('flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-white/[0.04]', collapsed && 'justify-center')} title={`Active character: ${active.name}`}>
            <AvatarOrb state="IDLE" accent={active.avatarSpec.palette.accent} size={32} label={`${active.name} idle`} />
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">{active.name}</p>
                <p className="truncate text-[10px] text-slate-500">{active.config.visualStyle}</p>
              </div>
            )}
          </NavLink>
        )}
        <button
          onClick={() => void setEmergencyStop(!emergencyStop)}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] font-medium transition-colors',
            emergencyStop ? 'bg-rose-500/20 text-rose-200 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.4)]' : 'bg-white/[0.03] text-slate-400 hover:text-rose-300',
            collapsed && 'justify-center',
          )}
          title="Emergency stop blocks all agent actions"
          aria-pressed={emergencyStop}
        >
          <OctagonAlert className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && (emergencyStop ? 'STOP ENGAGED' : 'Emergency stop')}
        </button>
        <div className={cn('flex items-center justify-between', collapsed && 'justify-center')}>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500" title={health ? `schema v${health.schemaVersion} · up ${Math.round(health.uptimeSeconds / 60)}m` : 'Server unreachable'}>
            <CircleDot className={cn('h-3 w-3', connection === 'online' ? 'text-emerald-400' : connection === 'connecting' ? 'text-amber-400' : 'text-rose-400')} />
            {!collapsed && (connection === 'online' ? 'Local server' : connection === 'connecting' ? 'Connecting…' : 'Offline')}
          </span>
          <Button variant="subtle" size="sm" className="h-7 w-7 p-0" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>
      </div>
      <span className="sr-only">{location.pathname}</span>
    </aside>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="relative h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="6.4" fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.4" fill="#a5f3fc" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.6" fill="none" stroke="#38bdf8" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}
