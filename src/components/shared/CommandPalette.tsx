import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { bookRepo } from '@/repositories';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/primitives';

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenShortcuts?: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commands = React.useMemo<Command[]>(() => {
    const books = user ? bookRepo.list({ ownerId: user.id, status: 'all' }).slice(0, 6) : [];
    const base: Command[] = [
      { id: 'new-book', label: 'New book', group: 'Create', hint: 'Start a blank, template, AI or imported project', action: () => navigate('/dashboard/books/new') },
      { id: 'dashboard', label: 'Go to dashboard', group: 'Navigate', action: () => navigate('/dashboard') },
      { id: 'my-books', label: 'My books', group: 'Navigate', action: () => navigate('/dashboard/books') },
      { id: 'templates', label: 'Templates', group: 'Navigate', action: () => navigate('/dashboard/templates') },
      { id: 'assets', label: 'Assets', group: 'Navigate', action: () => navigate('/dashboard/assets') },
      { id: 'ai-studio', label: 'AI Studio', group: 'Navigate', action: () => navigate('/dashboard/ai') },
      { id: 'publishing', label: 'Publishing centre', group: 'Navigate', action: () => navigate('/dashboard/publishing') },
      { id: 'exports', label: 'Export centre', group: 'Navigate', action: () => navigate('/dashboard/exports') },
      { id: 'earnings', label: 'Earnings', group: 'Navigate', action: () => navigate('/dashboard/earnings') },
      { id: 'analytics', label: 'Analytics', group: 'Navigate', action: () => navigate('/dashboard/analytics') },
      { id: 'library', label: 'My library', group: 'Navigate', action: () => navigate('/dashboard/library') },
      { id: 'wishlist', label: 'Wishlist', group: 'Navigate', action: () => navigate('/dashboard/wishlist') },
      { id: 'subscription', label: 'Subscription & billing', group: 'Account', action: () => navigate('/dashboard/subscription') },
      { id: 'profile', label: 'Public author profile', group: 'Account', action: () => navigate('/dashboard/profile') },
      { id: 'settings', label: 'Settings', group: 'Account', action: () => navigate('/dashboard/settings') },
      { id: 'marketplace', label: 'Open marketplace', group: 'Explore', action: () => navigate('/marketplace') },
      { id: 'help', label: 'Keyboard shortcuts', group: 'Help', shortcut: '?', action: () => onOpenShortcuts?.() },
    ];
    if (user?.role === 'admin' || user?.role === 'moderator') {
      base.unshift(
        { id: 'admin', label: 'Admin dashboard', group: 'Admin', action: () => navigate('/admin') },
        { id: 'admin-users', label: 'Admin · Users', group: 'Admin', action: () => navigate('/admin/users') },
        { id: 'admin-cms', label: 'Admin · CMS', group: 'Admin', action: () => navigate('/admin/cms') },
      );
    }
    books.forEach((book) => {
      base.push({
        id: `book-${book.id}`,
        label: book.title,
        group: 'Open book',
        hint: `${book.wordCount.toLocaleString()} words`,
        action: () => navigate(`/dashboard/books/${book.id}/editor`),
      });
    });
    return base;
  }, [user, navigate, onOpenShortcuts]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter((command) => command.label.toLowerCase().includes(lower) || command.group.toLowerCase().includes(lower));
  }, [commands, query]);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = filtered[activeIndex];
        if (command) {
          onOpenChange(false);
          command.action();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIndex, onOpenChange]);

  if (!open) return null;

  const groups = filtered.reduce<Record<string, Command[]>>((acc, command) => {
    acc[command.group] = acc[command.group] ? [...acc[command.group], command] : [command];
    return acc;
  }, {});

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-xl border border-border bg-popover shadow-lift">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-muted-foreground">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search commands, books and pages…"
            aria-label="Search commands"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2 scrollbar-thin">
          {!filtered.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No commands match “{query}”.</p>}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
              {items.map((command) => {
                flatIndex += 1;
                const isActive = flatIndex === activeIndex;
                return (
                  <button
                    key={command.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => {
                      onOpenChange(false);
                      command.action();
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      isActive ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="truncate">{command.label}</span>
                    <span className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
                      {command.hint && <span className="hidden truncate sm:inline">{command.hint}</span>}
                      {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const groups = [
    { title: 'Global', items: [['Command palette', '⌘ / Ctrl + K'], ['Search', '⌘ / Ctrl + P'], ['Shortcuts', '?'], ['Close dialogs', 'Esc']] },
    { title: 'Editor', items: [['Save now', '⌘ / Ctrl + S'], ['Undo', '⌘ / Ctrl + Z'], ['Redo', '⌘ / Ctrl + Shift + Z'], ['Find & replace', '⌘ / Ctrl + F'], ['Bold / Italic / Underline', '⌘ + B / I / U'], ['Toggle writing & design mode', '⌘ / Ctrl + Shift + M'], ['Toggle preview', '⌘ / Ctrl + Shift + P']] },
    { title: 'Book lists', items: [['New book', 'N'], ['Open selected', 'Enter'], ['Delete selected', 'Delete']] },
  ];
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="relative w-full max-w-lg animate-scale-in rounded-xl border border-border bg-popover p-5 shadow-lift">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Keyboard shortcuts</h2>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            ×
          </button>
        </div>
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
              <dl className="space-y-1.5">
                {group.items.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="flex gap-1">
                      {keys.split(' / ').map((combo) => (
                        <span key={combo} className="flex gap-1">
                          {combo.split(' + ').map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
