import * as React from 'react';
import { BookOpen, FileText, Search, Trash2, Upload, AlertTriangle } from 'lucide-react';
import type { Character } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Panel, Skeleton } from '@/components/ui';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/store/app';
import { readFileAsBase64 } from '@/lib/utils';

type Doc = { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; characterId: string | null; status: string; chunkCount?: number; createdAt: string };
/** /api/documents/search returns chunks, not nested objects. */
type ChunkHit = { documentId: string; content: string; score: number };

export function CharacterStudioKnowledge({ draft }: { draft: Character }) {
  const { toast } = useApp();
  const [docs, setDocs] = React.useState<Doc[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<ChunkHit[] | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ documents: Doc[] }>(`/documents?characterId=${draft.id}`);
      setDocs(res.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    }
  }, [draft.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const base64 = await readFileAsBase64(file);
      // Contract: /api/documents accepts { fileName, contentBase64, mimeType, characterId }.
      await apiPost('/documents', { fileName: file.name, mimeType: file.type || 'text/plain', contentBase64: base64, characterId: draft.id });
      await load();
      toast({ title: `${file.name} indexed`, description: 'Chunked, embedded and searchable by this character only.', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (doc: Doc) => {
    try {
      await apiDelete(`/documents/${doc.id}`);
      await load();
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    try {
      const res = await apiGet<{ results: ChunkHit[] }>(`/documents/search?q=${encodeURIComponent(query)}&characterId=${draft.id}`);
      setHits(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><BookOpen className="h-4 w-4 text-holo-400" /> Private knowledge</h3>
            <p className="mt-1 text-[11px] text-slate-500">Documents are stored locally and retrieved only for this character.</p>
          </div>
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.json,.csv,.log,.html,text/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
          <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
            <Upload className="h-3.5 w-3.5" /> Add document
          </Button>
        </div>
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[10px] leading-relaxed text-amber-200/70">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Plain-text formats only in this build. PDF/DOCX extraction is not implemented yet — the server rejects unsupported types with a clear error rather than silently indexing nothing.
        </p>
        <div className="mt-3 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Ask your documents…" className="input flex-1 text-xs" aria-label="Search knowledge" />
          <Button variant="ghost" size="sm" onClick={() => void search()}><Search className="h-3.5 w-3.5" /> Search</Button>
        </div>
        {hits ? (
          <div className="mt-3 space-y-1.5">
            {hits.length === 0 ? <p className="text-[11px] text-slate-600">No matching passages.</p> : null}
            {hits.map((h, i) => (
              <div key={`${h.documentId}-${i}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                <div className="flex justify-between text-[9px] text-slate-600">
                  <span>{docs?.find((d) => d.id === h.documentId)?.fileName ?? 'Document'}</span>
                  <span>score {h.score.toFixed(2)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{h.content.slice(0, 400)}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel className="p-5">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Documents ({docs?.length ?? 0})</h4>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {docs === null ? <Skeleton className="h-20" /> : docs.length === 0 ? (
          <EmptyState title="No documents yet" description={`Add notes, specs or research files and ${draft.name} will ground answers in them.`} icon={<FileText className="h-5 w-5" />} />
        ) : (
          <div className="space-y-1">
            {docs.map((d) => (
              <div key={d.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{d.title}</span>
                <Badge tone={d.status === 'indexed' ? 'good' : d.status === 'failed' ? 'bad' : 'warn'} className="shrink-0 px-1.5 py-0 text-[8px]">{d.status}</Badge>
                <span className="shrink-0 text-[10px] text-slate-600">{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                <button onClick={() => void remove(d)} className="shrink-0 rounded p-1 text-slate-700 opacity-0 group-hover:opacity-100 hover:text-rose-400" aria-label={`Delete ${d.title}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
