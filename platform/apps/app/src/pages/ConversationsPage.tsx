import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Brain, Loader2, MessageSquarePlus, Search, Send, Sparkles, Trash2, X, User, Download } from 'lucide-react';
import { useActiveCharacter, useApp } from '@/store/app';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { Conversation, Message } from '@/lib/types';
import { AvatarOrb } from '@/components/avatar/AvatarOrb';
import { Badge, Button, EmptyState, ErrorState, Modal, Panel, Skeleton } from '@/components/ui';
import { cn, downloadJson, formatNumber, relativeTime } from '@/lib/utils';

export function ConversationsPage() {
  const character = useActiveCharacter();
  const { toast } = useApp();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const [query, setQuery] = React.useState('');
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [agentMode, setAgentMode] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<Conversation | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const list = useQuery({
    queryKey: ['conversations', character?.id, query],
    queryFn: async () => {
      if (query.trim()) {
        const res = await apiGet<{ conversations: Conversation[] }>(`/conversations/search?q=${encodeURIComponent(query)}${character ? `&characterId=${character.id}` : ''}`);
        return res.conversations;
      }
      const res = await apiGet<{ conversations: Conversation[] }>(`/conversations?characterId=${character?.id}`);
      return res.conversations;
    },
    enabled: Boolean(character),
  });

  const activeConv = list.data?.find((c) => c.id === conversationId) ?? null;

  const messages = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => apiGet<{ messages: Message[]; conversation: Conversation }>(`/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  });

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data?.messages.length, draft]);

  const openConv = (id: string) => {
    setParams({ c: id });
    setDraft('');
  };

  const newChat = async () => {
    if (!character) return;
    try {
      const res = await apiPost<{ conversation: Conversation }>('/conversations', { characterId: character.id, title: 'New conversation', mode: agentMode ? 'agent' : 'companion' });
      await qc.invalidateQueries({ queryKey: ['conversations'] });
      openConv(res.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create conversation');
    }
  };

  const send = async () => {
    if (!character || !input.trim() || streaming) return;
    let convId = conversationId;
    setError(null);
    const text = input.trim();
    setInput('');
    try {
      if (!convId) {
        const created = await apiPost<{ conversation: Conversation }>('/conversations', { characterId: character.id, title: text.slice(0, 60), mode: agentMode ? 'agent' : 'companion' });
        convId = created.conversation.id;
        setParams({ c: convId });
        await qc.invalidateQueries({ queryKey: ['conversations'] });
      }
      setStreaming(true);
      setDraft('');
      const abort = new AbortController();
      abortRef.current = abort;
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, conversationId: convId, message: text, mode: agentMode ? 'agent' : 'companion', voice: { enabled: false } }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => ({ error: `Chat failed (${res.status})` }))) as { error?: string };
        throw new Error(payload.error ?? `Chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let evt: { type?: string; delta?: string; message?: string; error?: string; meta?: Record<string, unknown> };
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === 'delta' && evt.delta) {
            acc += evt.delta;
            setDraft(acc);
          } else if (evt.type === 'error') {
            throw new Error(evt.message ?? evt.error ?? 'The model returned an error');
          } else if (evt.type === 'done') {
            acc = acc || String((evt as { text?: string }).text ?? '');
          }
        }
      }
      setDraft('');
      await qc.invalidateQueries({ queryKey: ['messages', convId] });
      await qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Message failed');
        setInput(text);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const remove = async (conv: Conversation) => {
    try {
      await apiDelete(`/conversations/${conv.id}`);
      await qc.invalidateQueries({ queryKey: ['conversations'] });
      if (conv.id === conversationId) setParams({});
      setConfirmDelete(null);
      toast({ title: 'Conversation deleted', tone: 'success' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  if (!character) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <EmptyState title="Pick a character first" description="Conversations belong to a character, so their memory and permissions stay scoped." />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      {/* list */}
      <div className="flex min-h-0 flex-col border-r border-white/[0.06]">
        <div className="space-y-2 p-4">
          <Button variant="primary" className="w-full" onClick={() => void newChat()}>
            <MessageSquarePlus className="h-4 w-4" /> New conversation
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all messages…" className="input pl-9 text-xs" aria-label="Search conversations" />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {list.isLoading ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : list.error ? (
            <div className="p-2">
              <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
            </div>
          ) : (list.data ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">{query ? 'No conversations match that search.' : 'No conversations yet.'}</p>
          ) : (
            (list.data ?? []).map((conv) => (
              <div key={conv.id} className={cn('group flex items-start gap-2 rounded-xl p-2.5 transition-colors', conv.id === conversationId ? 'bg-holo-500/[0.12]' : 'hover:bg-white/[0.04]')}>
                <button className="min-w-0 flex-1 text-left" onClick={() => openConv(conv.id)}>
                  <p className={cn('truncate text-xs font-medium', conv.id === conversationId ? 'text-holo-100' : 'text-slate-300')}>{conv.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span>{relativeTime(conv.updatedAt)}</span>
                    {conv.mode === 'agent' ? <Badge tone="accent" className="px-1 py-0 text-[8px]">agent</Badge> : null}
                    {conv.messageCount !== undefined ? <span>· {conv.messageCount} msg</span> : null}
                  </p>
                </button>
                <button onClick={() => setConfirmDelete(conv)} className="rounded p-1 text-slate-700 opacity-0 hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100" aria-label={`Delete ${conv.title}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* thread */}
      <div className="flex min-h-0 flex-col">
        {!conversationId ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <AvatarOrb state="IDLE" accent={character.avatarSpec.palette.accent} size={72} className="mx-auto" />
              <h2 className="mt-3 text-lg font-semibold text-slate-200">Talk to {character.name}</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Type below or pick a conversation. Replies stream from your configured model provider; memory and knowledge are injected per character.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {['What do you remember about me?', 'Summarise my open tasks', 'Explain how your memory works'].map((s) => (
                  <button key={s} onClick={() => setInput(s)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:border-holo-500/30 hover:text-holo-200">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <AvatarOrb state="IDLE" accent={character.avatarSpec.palette.accent} size={28} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-200">{activeConv?.title ?? messages.data?.conversation.title ?? 'Conversation'}</p>
                  <p className="text-[10px] text-slate-500">
                    {character.name} · {messages.data?.messages.length ?? 0} messages
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="subtle" onClick={() => downloadJson(`${(activeConv?.title ?? 'conversation').replace(/\W+/g, '-')}.json`, messages.data ?? {})} title="Export messages as JSON">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAgentMode((v) => !v)} className={agentMode ? 'border-holo-500/40 text-holo-200' : ''}>
                  <Sparkles className="h-3.5 w-3.5" /> {agentMode ? 'Agent mode on' : 'Agent mode'}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {messages.isLoading ? <Skeleton className="h-24" /> : null}
              {messages.error ? <ErrorState message={messages.error.message} onRetry={() => void messages.refetch()} /> : null}
              <div className="mx-auto max-w-3xl space-y-4">
                {(messages.data?.messages ?? []).map((m) => (
                  <MessageBubble key={m.id} message={m} characterName={character.name} accent={character.avatarSpec.palette.accent} />
                ))}
                {streaming ? (
                  <div className="flex gap-3">
                    <AvatarOrb state="THINKING" accent={character.avatarSpec.palette.accent} size={30} />
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-holo-500/15 bg-holo-500/[0.06] px-4 py-2.5">
                      {draft ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{draft}</p> : <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> {character.name} is thinking…</p>}
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="border-t border-white/[0.06] p-4">
              {error ? (
                <div className="mx-auto mb-2 max-w-3xl">
                  <ErrorState message={error} />
                </div>
              ) : null}
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder={`Message ${character.name}…  (Enter to send, Shift+Enter for newline)`}
                  className="input max-h-40 flex-1 resize-none"
                  aria-label="Message"
                />
                {streaming ? (
                  <Button variant="danger" onClick={() => abortRef.current?.abort()} title="Stop generating">
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => void send()} disabled={!input.trim()} aria-label="Send message">
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="mx-auto mt-2 max-w-3xl text-[10px] text-slate-600">
                Messages are stored in your local database. Provider keys stay in the encrypted vault — never in the browser.
              </p>
            </div>
          </>
        )}
      </div>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete conversation?"
        description="This permanently removes the transcript from your local database. Extracted memories stay in the Memory Center unless you remove them there too."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => confirmDelete && void remove(confirmDelete)}>Delete</Button>
          </>
        }
      />
    </div>
  );
}

function MessageBubble({ message, characterName, accent }: { message: Message; characterName: string; accent: string }) {
  const isUser = message.role === 'user';
  const meta = message.meta as { provider?: string; model?: string; error?: string; toolCalls?: unknown[]; memoryUsed?: number };
  if (message.role === 'system') {
    return <p className="mx-auto max-w-md rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center text-[10px] text-slate-500">{message.content}</p>;
  }
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {isUser ? (
        <div className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <User className="h-3.5 w-3.5 text-slate-400" />
        </div>
      ) : (
        <AvatarOrb state="IDLE" accent={accent} size={30} label={characterName} />
      )}
      <div className={cn('max-w-[80%] space-y-1', isUser && 'items-end text-right')}>
        <div className={cn('rounded-2xl px-4 py-2.5', isUser ? 'rounded-tr-sm bg-white/[0.06]' : 'rounded-tl-sm border border-holo-500/15 bg-holo-500/[0.06]')}>
          <p className="whitespace-pre-wrap text-left text-sm leading-relaxed text-slate-200">{message.content}</p>
        </div>
        <div className={cn('flex items-center gap-2 px-1 text-[10px] text-slate-600', isUser && 'justify-end')}>
          <span>{relativeTime(message.createdAt)}</span>
          {meta.model ? <span className="font-mono">{meta.provider}/{meta.model}</span> : null}
          {meta.memoryUsed ? (
            <span className="flex items-center gap-0.5">
              <Brain className="h-2.5 w-2.5" /> {formatNumber(meta.memoryUsed)}
            </span>
          ) : null}
          {meta.toolCalls?.length ? <span>{meta.toolCalls.length} tool calls</span> : null}
          {meta.error ? <span className="text-rose-400">{meta.error}</span> : null}
        </div>
      </div>
    </div>
  );
}
