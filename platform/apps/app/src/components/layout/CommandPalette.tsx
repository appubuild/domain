import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search, Sparkles, Users, MessagesSquare, Brain, ListChecks, Wrench, Mic } from 'lucide-react';
import { useApp } from '@/store/app';
import { apiGet } from '@/lib/api';
import type { Memory, Message } from '@/lib/types';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { cn } from '@/lib/utils';

type Item = { id: string; label: string; hint?: string; group: string; icon?: React.ReactNode; run: () => void };

/** Ctrl/Cmd-K palette: navigation + character switch + local memory/conversation search. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { characters, setActiveCharacter, activeCharacterId } = useApp();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<{ memories: Memory[]; messages: Message[] }>({ memories: [], messages: [] });
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setHits({ memories: [], messages: [] });
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || query.trim().length < 2 || !activeCharacterId) return;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const [mem, msg] = await Promise.all([
          apiGet<{ memories: Memory[] }>(`/memory?characterId=${activeCharacterId}&q=${encodeURIComponent(query)}&limit=5`),
          apiGet<{ messages: Message[] }>(`/conversations/search?q=${encodeURIComponent(query)}&characterId=${activeCharacterId}`),
        ]);
        if (!cancelled) setHits({ memories: mem.memories, messages: msg.messages.slice(0, 5) });
      } catch {
        if (!cancelled) setHits({ memories: [], messages: [] });
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, activeCharacterId]);

  const nav: Item[] = [
    { id: 'nav-dash', label: 'Dashboard', group: 'Go to', run: () => navigate('/') },
    { id: 'nav-voice', label: 'Live Voice', group: 'Go to', icon: <Mic className="h-3.5 w-3.5" />, run: () => navigate('/voice') },
    { id: 'nav-conv', label: 'Conversations', group: 'Go to', icon: <MessagesSquare className="h-3.5 w-3.5" />, run: () => navigate('/conversations') },
    { id: 'nav-chars', label: 'My Characters', group: 'Go to', icon: <Users className="h-3.5 w-3.5" />, run: () => navigate('/characters') },
    { id: 'nav-studio', label: 'Character Studio', group: 'Go to', icon: <Sparkles className="h-3.5 w-3.5" />, run: () => navigate('/studio') },
    { id: 'nav-memory', label: 'Memory Center', group: 'Go to', icon: <Brain className="h-3.5 w-3.5" />, run: () => navigate('/memory') },
    { id: 'nav-skills', label: 'Skills & Tools', group: 'Go to', icon: <Wrench className="h-3.5 w-3.5" />, run: () => navigate('/skills') },
    { id: 'nav-tasks', label: 'Agent Tasks', group: 'Go to', icon: <ListChecks className="h-3.5 w-3.5" />, run: () => navigate('/tasks') },
    { id: 'nav-models', label: 'AI Models', group: 'Go to', run: () => navigate('/models') },
    { id: 'nav-billing', label: 'Usage & Billing', group: 'Go to', run: () => navigate('/billing') },
    { id: 'nav-settings', label: 'Settings', group: 'Go to', run: () => navigate('/settings') },
  ];

  const items: Item[] = [
    ...nav.filter((n) => !query || n.label.toLowerCase().includes(query.toLowerCase())),
    ...characters
      .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
      .map((c) => ({
        id: `char-${c.id}`,
        label: `Use ${c.name}`,
        hint: c.config.visualStyle,
        group: 'Characters',
        icon: <AvatarOrb state="IDLE" accent={c.avatarSpec.palette.accent} size={16} />,
        run: () => setActiveCharacter(c.id),
      })),
    ...hits.memories.map((m) => ({
      id: `mem-${m.id}`,
      label: m.content,
      hint: `memory · ${m.layer}`,
      group: 'Memory',
      icon: <Brain className="h-3.5 w-3.5 text-violet-400" />,
      run: () => navigate(`/memory?focus=${m.id}`),
    })),
    ...hits.messages.map((m) => ({
      id: `msg-${m.id}`,
      label: m.content,
      hint: `conversation · ${m.role}`,
      group: 'Conversations',
      icon: <MessagesSquare className="h-3.5 w-3.5 text-holo-400" />,
      run: () => navigate(`/conversations?c=${m.conversationId}`),
    })),
  ];

  const groups = [...new Set(items.map((i) => i.group))];

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="panel relative w-full max-w-xl overflow-hidden border-holo-500/20">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && items[0]) {
                items[0].run();
                onClose();
              }
            }}
            placeholder="Jump to a page, switch character, search memory…"
            className="h-12 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
            aria-label="Command palette search"
          />
          {busy ? <span className="text-[10px] text-slate-500">searching…</span> : null}
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 ? <p className="px-3 py-6 text-center text-xs text-slate-500">No matches.</p> : null}
          {groups.map((g) => (
            <div key={g}>
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-600">{g}</p>
              {items
                .filter((i) => i.group === g)
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                    className={cn('group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-holo-500/10 hover:text-white')}
                  >
                    {item.icon ?? <ArrowRight className="h-3.5 w-3.5 text-slate-600" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="shrink-0 text-[10px] text-slate-600">{item.hint}</span> : null}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
