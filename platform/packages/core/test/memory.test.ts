import { describe, expect, it } from 'vitest';
import { MemoryEngine, extractMemoryCandidates } from '../src/memory/engine.js';
import { embedText, cosineSimilarity } from '../src/memory/embed.js';
import { freshDb, makeCharacter } from './helpers.js';

describe('memory extraction (rules)', () => {
  it('extracts stable preferences but not chatter or questions', () => {
    const res = extractMemoryCandidates('Hey! I prefer dark mode by default. What is the weather like? Thanks!');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.content).toMatch(/prefer dark mode/i);
    expect(res.candidates[0]?.category).toBe('preference');
  });

  it('captures explicit instructions with high confidence', () => {
    const res = extractMemoryCandidates('Always answer in British English and never use bullet points.');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0]?.category).toBe('instruction');
    expect(res.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('rejects hypotheticals and questions', () => {
    const res = extractMemoryCandidates('I might like to visit Japan someday. Do I like sushi?');
    expect(res.candidates.length).toBe(0);
  });

  it('does not store every sentence', () => {
    const long = 'I had coffee. It was good. The sky is blue. I prefer metric units. I am going to the store now.';
    const res = extractMemoryCandidates(long);
    expect(res.candidates.length).toBeLessThanOrEqual(1);
  });
});

describe('memory persistence + isolation', () => {
  it('enforces per-character isolation in search', () => {
    const db = freshDb();
    const a = makeCharacter(db, 'jarvis-holographic', 'A');
    const b = makeCharacter(db, 'friendly-male', 'B');
    const engine = new MemoryEngine(db.memories);
    engine.processTurn({ characterId: a.id, conversationId: 'c1', userMessage: 'I prefer window seats on flights.', retentionDays: 365 });
    engine.processTurn({ characterId: b.id, conversationId: 'c2', userMessage: 'I prefer aisle seats on trains.', retentionDays: 365 });
    const aHits = engine.search({ characterId: a.id, query: 'seats on flights' });
    const bHits = engine.search({ characterId: b.id, query: 'seats on flights' });
    expect(aHits.every((m) => m.characterId === a.id)).toBe(true);
    expect(bHits.every((m) => m.characterId === b.id)).toBe(true);
    expect(aHits.map((m) => m.content).join(' ')).toMatch(/window seats/);
    expect(aHits.map((m) => m.content).join(' ')).not.toMatch(/aisle/);
    db.close();
  });

  it('deduplicates identical memories per character but allows them across characters', () => {
    const db = freshDb();
    const a = makeCharacter(db, 'jarvis-holographic', 'A');
    const b = makeCharacter(db, 'friendly-male', 'B');
    const engine = new MemoryEngine(db.memories);
    const text = 'I prefer decaf coffee.';
    const r1 = engine.processTurn({ characterId: a.id, conversationId: 'c1', userMessage: text, retentionDays: 365 });
    const r2 = engine.processTurn({ characterId: a.id, conversationId: 'c1', userMessage: text, retentionDays: 365 });
    const r3 = engine.processTurn({ characterId: b.id, conversationId: 'c2', userMessage: text, retentionDays: 365 });
    expect(r1.stored).toHaveLength(1);
    expect(r2.stored).toHaveLength(0);
    expect(r2.duplicates).toBe(1);
    expect(r3.stored).toHaveLength(1);
    db.close();
  });

  it('retrieves by meaning with hybrid search (FTS + embedding)', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const engine = new MemoryEngine(db.memories);
    db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'project', content: 'The Orion launch deadline is March 14.', importance: 0.8, embedding: embedText('The Orion launch deadline is March 14.') });
    db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'preference', content: 'User likes jasmine tea in the morning.', importance: 0.5, embedding: embedText('User likes jasmine tea in the morning.') });
    const hits = engine.search({ characterId: a.id, query: 'when is the Orion deadline?' });
    expect(hits[0]?.content).toMatch(/Orion/);
    db.close();
  });

  it('edits, deletes and expires memories', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const m = db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'fact', content: 'User lives in Dhaka.', embedding: null })!;
    const updated = db.memories.update(m.id, { content: 'User lives in Rangpur.', importance: 0.9 });
    expect(updated.content).toMatch(/Rangpur/);
    const hits = db.memories.searchFts(a.id, 'Rangpur');
    expect(hits.length).toBe(1);
    expect(db.memories.searchFts(a.id, 'Dhaka').length).toBe(0);
    db.memories.remove(m.id);
    expect(db.memories.count(a.id)).toBe(0);
    db.memories.insert({ characterId: a.id, layer: 'short_term', category: 'fact', content: 'Temporary note about a meeting.', expiresAt: '2000-01-01T00:00:00.000Z', embedding: null });
    expect(db.memories.pruneExpired()).toBe(1);
    db.close();
  });

  it('rejects exact duplicates at insert time (per character only)', () => {
    const db = freshDb();
    const a = makeCharacter(db, 'jarvis-holographic', 'A');
    const b = makeCharacter(db, 'friendly-male', 'B');
    const dup = 'User is allergic to peanuts.';
    expect(db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'fact', content: dup, embedding: embedText(dup) })).not.toBeNull();
    expect(db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'fact', content: 'user is ALLERGIC to peanuts!!', embedding: embedText(dup) })).toBeNull();
    expect(db.memories.insert({ characterId: b.id, layer: 'long_term', category: 'fact', content: dup, embedding: embedText(dup) })).not.toBeNull();
    expect(db.memories.count(a.id)).toBe(1);
    expect(db.memories.count(b.id)).toBe(1);
    db.close();
  });

  it('consolidates semantically near-duplicate memories within one character only', () => {
    const db = freshDb();
    const a = makeCharacter(db, 'jarvis-holographic', 'A');
    const b = makeCharacter(db, 'friendly-male', 'B');
    const engine = new MemoryEngine(db.memories);
    const dup = 'User is allergic to peanuts.';
    const variants = [
      dup,
      'User is allergic to peanuts and peanut oil.',
      'Allergic to peanuts — avoid peanut oil entirely.',
    ];
    for (const v of variants) db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'fact', content: v, embedding: embedText(v) });
    db.memories.insert({ characterId: b.id, layer: 'long_term', category: 'fact', content: dup, embedding: embedText(dup) });
    const res = engine.consolidate(a.id, 0.55);
    expect(res.merged).toBeGreaterThanOrEqual(1);
    expect(db.memories.count(a.id)).toBeLessThan(3);
    expect(db.memories.count(b.id)).toBe(1);
    db.close();
  });

  it('builds a budgeted context block', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const engine = new MemoryEngine(db.memories);
    for (let i = 0; i < 40; i++) {
      const content = `Fact number ${i}: the project codename is falcon-${i}.`;
      db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'project', content, importance: 0.6, embedding: embedText(content) });
    }
    const ctx = engine.buildContext({ characterId: a.id, query: 'falcon project', budgetChars: 600 });
    expect(ctx.block.length).toBeLessThanOrEqual(600);
    expect(ctx.used.length).toBeGreaterThan(0);
    db.close();
  });

  it('summarises conversations into episodic memory', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const engine = new MemoryEngine(db.memories);
    const row = engine.summarizeConversation({
      characterId: a.id,
      conversationId: 'c1',
      messages: [
        { role: 'user', content: 'I want to plan the migration of the database.' },
        { role: 'assistant', content: 'We can start with a schema audit.' },
        { role: 'user', content: 'The migration must finish before the database freeze.' },
      ],
      retentionDays: 365,
    });
    expect(row?.layer).toBe('episodic');
    expect(row?.content).toMatch(/migration/);
    db.close();
  });
});

describe('local embeddings', () => {
  it('are deterministic, normalised and semantically useful', () => {
    const a = embedText('I love green tea');
    const b = embedText('I love green tea');
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 4);
    const near = cosineSimilarity(embedText('green tea in the morning'), embedText('I drink green tea every day'));
    const far = cosineSimilarity(embedText('green tea in the morning'), embedText('diesel engine torque curves'));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.3);
  });
});
