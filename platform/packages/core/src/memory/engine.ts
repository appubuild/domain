import type { MemoryCategory, MemoryLayer, MemoryRow, MemoryRepo } from '../db/memoryRepo.js';
import { bm25ToScore } from '../db/memoryRepo.js';
import { cosineSimilarity, embedText } from './embed.js';
import { normalizeForHash, truncate } from '../util/text.js';
import { daysFromNow } from '../util/time.js';

/** Candidate memory produced by extraction, before persistence. */
export type MemoryCandidate = {
  content: string;
  category: MemoryCategory;
  layer: MemoryLayer;
  importance: number;
  confidence: number;
  tags: string[];
};

/**
 * Deterministic extraction (no model required, runs fully offline).
 *
 * Rules deliberately conservative: only first-person statements of stable preference,
 * explicit instructions ("always/never/remember"), and durable facts ("my name is").
 * Conversational filler, one-off questions and hypotheticals are rejected. A model-based
 * extractor can be layered on top (see `LlmExtractor`); this rule engine is the floor so
 * memory still works with zero API keys.
 */
const PREFERENCE_PATTERNS: Array<{ re: RegExp; category: MemoryCategory; importance: number }> = [
  { re: /\b(?:i|we)\s+(?:really\s+)?(?:prefer|like|love|enjoy|hate|dislike|avoid)\b/i, category: 'preference', importance: 0.55 },
  { re: /\b(?:i|we)\s+(?:am|'m|was)\s+(?:allergic|vegan|vegetarian|left-handed)\b/i, category: 'fact', importance: 0.7 },
  { re: /\bmy\s+(?:name|nickname)\s+is\b/i, category: 'fact', importance: 0.9 },
  { re: /\b(?:i|we)\s+(?:work|live|study|am based)\b/i, category: 'fact', importance: 0.65 },
  { re: /\b(?:always|never|from now on|remember (?:that|to)|please don'?t|do not|don'?t (?:ever )?)\b/i, category: 'instruction', importance: 0.8 },
  { re: /\b(?:my|our)\s+(?:project|company|team|birthday|deadline|goal|plan)\b/i, category: 'project', importance: 0.7 },
  { re: /\b(?:i|we)\s+(?:decided|chose|agreed|committed)\b/i, category: 'event', importance: 0.65 },
];

const REJECT_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|cool|great|nice)\b/i,
  /\?\s*$/,
  /^(?:what|how|why|when|where|who)\b/i,
  /\b(?:maybe|perhaps|i think i might|if i were|hypothetically)\b/i,
];

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 400);
}

/** Importance combines rule weight, specificity and length — bounded, explainable. */
export function scoreImportance(candidate: MemoryCandidate, rawSentence: string): number {
  const wordCount = rawSentence.split(/\s+/).length;
  const specificity = Math.min(1, wordCount / 25);
  const hasNumbers = /\d/.test(rawSentence) ? 0.05 : 0;
  return Math.min(0.98, Math.max(0.05, candidate.importance * 0.8 + specificity * 0.15 + hasNumbers));
}

export type ExtractionResult = {
  candidates: MemoryCandidate[];
  rejected: number;
};

export function extractMemoryCandidates(userMessage: string, opts: { maxCandidates?: number } = {}): ExtractionResult {
  const sentences = splitSentences(userMessage);
  const candidates: MemoryCandidate[] = [];
  let rejected = 0;
  for (const sentence of sentences) {
    if (REJECT_PATTERNS.some((re) => re.test(sentence))) {
      rejected++;
      continue;
    }
    const rule = PREFERENCE_PATTERNS.find((p) => p.re.test(sentence));
    if (!rule) {
      rejected++;
      continue;
    }
    const candidate: MemoryCandidate = {
      content: normalizeSentence(sentence),
      category: rule.category,
      layer: rule.category === 'event' ? 'episodic' : 'long_term',
      importance: rule.importance,
      confidence: rule.category === 'instruction' ? 0.85 : 0.75,
      tags: extractTags(sentence),
    };
    candidate.importance = scoreImportance(candidate, sentence);
    candidates.push(candidate);
    if (candidates.length >= (opts.maxCandidates ?? 4)) break;
  }
  return { candidates, rejected };
}

function normalizeSentence(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function extractTags(s: string): string[] {
  const tags = new Set<string>();
  if (/\bprefer|like|love|hate|dislike\b/i.test(s)) tags.add('preference');
  if (/\bname\b/i.test(s)) tags.add('identity');
  if (/\bwork|job|company\b/i.test(s)) tags.add('work');
  if (/\bproject|deadline|goal\b/i.test(s)) tags.add('project');
  if (/\balways|never|remember\b/i.test(s)) tags.add('instruction');
  return [...tags].slice(0, 4);
}

export type PersistResult = {
  stored: MemoryRow[];
  duplicates: number;
  skippedLowConfidence: number;
};

/** Minimum bar before anything is written to long-term storage. */
const MIN_CONFIDENCE = 0.55;
const MIN_IMPORTANCE = 0.35;

export class MemoryEngine {
  constructor(private readonly repo: MemoryRepo) {}

  /** Embedding helper so HTTP handlers use exactly the same vector space. */
  embedFor(text: string): number[] {
    return embedText(text);
  }

  /** Full extraction pipeline for one user turn. Never writes below the confidence bar. */
  processTurn(input: {
    characterId: string;
    conversationId: string;
    userMessage: string;
    retentionDays: number;
  }): PersistResult {
    const { candidates } = extractMemoryCandidates(input.userMessage);
    const stored: MemoryRow[] = [];
    let duplicates = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (c.confidence < MIN_CONFIDENCE || c.importance < MIN_IMPORTANCE) {
        skipped++;
        continue;
      }
      const row = this.repo.insert({
        characterId: input.characterId,
        layer: c.layer,
        category: c.category,
        content: c.content,
        importance: c.importance,
        confidence: c.confidence,
        source: 'extraction',
        sourceConversationId: input.conversationId,
        tags: c.tags,
        embedding: embedText(c.content),
        expiresAt: input.retentionDays > 0 ? daysFromNow(input.retentionDays) : null,
      });
      if (row) stored.push(row);
      else duplicates++;
    }
    return { stored, duplicates, skippedLowConfidence: skipped };
  }

  /** Episodic summary of a finished conversation (or a long segment). */
  summarizeConversation(input: {
    characterId: string;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
    retentionDays: number;
  }): MemoryRow | null {
    const userTurns = input.messages.filter((m) => m.role === 'user');
    if (userTurns.length < 2) return null;
    const topics = new Map<string, number>();
    for (const m of input.messages) {
      for (const t of m.content.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []) topics.set(t, (topics.get(t) ?? 0) + 1);
    }
    const top = [...topics.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([w]) => w);
    const firstGoal = truncate(userTurns[0]?.content ?? '', 160);
    const lastGoal = truncate(userTurns[userTurns.length - 1]?.content ?? '', 160);
    const content =
      `Conversation on ${new Date().toISOString().slice(0, 10)}: ${userTurns.length} user turns. ` +
      `Started with "${firstGoal}". Ended discussing "${lastGoal}".` +
      (top.length ? ` Recurring topics: ${top.join(', ')}.` : '');
    return this.repo.insert({
      characterId: input.characterId,
      layer: 'episodic',
      category: 'summary',
      content,
      importance: Math.min(0.85, 0.45 + userTurns.length * 0.02),
      confidence: 0.9,
      source: 'summary',
      sourceConversationId: input.conversationId,
      tags: ['episodic', 'summary'],
      embedding: embedText(content),
      expiresAt: input.retentionDays > 0 ? daysFromNow(input.retentionDays * 2) : null,
    });
  }

  /**
   * Hybrid search: FTS5 (lexical) + embedding cosine (semantic) fused with reciprocal
   * rank fusion, then boosted by importance/recency/pin. Character scoped — a search can
   * never observe another character's memory.
   */
  search(params: { characterId: string; query: string; limit?: number; layers?: MemoryLayer[] }): MemoryRow[] {
    const limit = params.limit ?? 8;
    const query = params.query.trim();
    if (!query) return [];
    const lexical = this.repo.searchFts(params.characterId, query, limit * 3);
    const qVec = embedText(query);
    const pool = this.repo.list({ characterId: params.characterId, layers: params.layers, limit: 400 });
    const semantic = pool
      .map((m) => ({ m, score: cosineSimilarity(qVec, m.embedding ?? embedText(m.content)) }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 3);

    const fused = new Map<string, { row: MemoryRow; score: number }>();
    lexical.forEach((row, i) => {
      const s = (row.score > 0 ? row.score : bm25ToScore(0)) + 1 / (60 + i + 1);
      fused.set(row.id, { row, score: s });
    });
    semantic.forEach((x, i) => {
      const prev = fused.get(x.m.id);
      const s = x.score + 1 / (60 + i + 1);
      if (prev) prev.score += s;
      else fused.set(x.m.id, { row: x.m, score: s });
    });

    const now = Date.now();
    const ranked = [...fused.values()]
      .map(({ row, score }) => {
        const ageDays = Math.max(0, (now - new Date(row.updatedAt).getTime()) / 86_400_000);
        const recency = Math.exp(-ageDays / 120);
        const boost = 1 + row.importance * 0.8 + recency * 0.25 + (row.pinned ? 0.5 : 0);
        return { row, final: score * boost };
      })
      .sort((a, b) => b.final - a.final)
      .slice(0, limit)
      .map((x) => x.row);

    this.repo.recordAccess(ranked.map((r) => r.id));
    return ranked;
  }

  /** Merge near-duplicate memories inside one character. Never crosses characters. */
  consolidate(characterId: string, threshold = 0.92): { merged: number; kept: number } {
    const all = this.repo.list({ characterId, limit: 2000 });
    let merged = 0;
    const seen: Array<{ id: string; norm: string; vec: number[]; pinned: boolean }> = [];
    for (const m of all) {
      if (m.pinned) continue;
      const norm = normalizeForHash(m.content);
      const vec = m.embedding ?? embedText(m.content);
      const twin = seen.find((s) => s.norm === norm || cosineSimilarity(s.vec, vec) > threshold);
      if (twin) {
        this.repo.remove(m.id);
        merged++;
      } else {
        seen.push({ id: m.id, norm, vec, pinned: m.pinned });
      }
    }
    return { merged, kept: seen.length };
  }

  /** Retention sweep: expired rows are deleted. Pinned rows are exempt. */
  applyRetention(): number {
    return this.repo.pruneExpired();
  }

  /** Builds the memory block injected into a character's system prompt. */
  buildContext(params: { characterId: string; query: string; budgetChars?: number }): { block: string; used: MemoryRow[] } {
    const budget = params.budgetChars ?? 2400;
    const rows = this.search({ characterId: params.characterId, query: params.query, limit: 12 });
    if (rows.length === 0) return { block: '', used: [] };
    const header = `## Long-term memory about this user (character-private, retrieved for this turn)\n`;
    const footer = `\nUse this only when relevant. Never claim to remember something that is not listed here.`;
    const contentBudget = Math.max(0, budget - header.length - footer.length);
    const used: MemoryRow[] = [];
    const lines: string[] = [];
    let length = 0;
    for (const m of rows) {
      const line = `- [${m.layer}/${m.category}] ${m.content}`;
      if (length + line.length + 1 > contentBudget) break;
      used.push(m);
      lines.push(line);
      length += line.length + 1;
    }
    if (lines.length === 0) return { block: '', used: [] };
    return { block: header + lines.join('\n') + footer, used };
  }
}
