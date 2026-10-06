/**
 * AIService — provider-agnostic AI orchestration.
 *
 * Phase 1 returns deterministic, believable mock output shaped exactly like a
 * real provider response. Phase 5 swaps `provider` for a server-side AI gateway:
 * the UI already handles progress, streaming text, accept/replace/insert,
 * regenerate and error states.
 */
import type { AiBookBrief, Book, ID } from '@/types/domain';
import { delay, stripHtml, uid } from '@/lib/utils';
import { coverArtUrl, palettes } from '@/lib/coverArt';
import { aiRepo, userRepo } from '@/repositories';
import { getDatabase } from '@/store/db';

export type AiAction =
  | 'continue'
  | 'rewrite'
  | 'improve'
  | 'simplify'
  | 'expand'
  | 'shorten'
  | 'tone'
  | 'grammar'
  | 'summarize'
  | 'translate'
  | 'outline'
  | 'chapter'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'character'
  | 'dialogue'
  | 'blurb'
  | 'keywords';

export interface AiRequest {
  action: AiAction;
  input?: string;
  tone?: string;
  language?: string;
  genre?: string;
  audience?: string;
  bookId?: ID;
  instructions?: string;
}

export interface AiResponse {
  id: string;
  action: AiAction;
  text: string;
  alternatives: string[];
  credits: number;
  model: string;
  tokens: number;
  latencyMs: number;
  notes: string[];
}

export interface BookGenerationStep {
  id: string;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'done';
  progress: number;
}

const CREDIT_COST: Record<AiAction, number> = {
  continue: 4,
  rewrite: 2,
  improve: 2,
  simplify: 2,
  expand: 4,
  shorten: 2,
  tone: 3,
  grammar: 1,
  summarize: 2,
  translate: 6,
  outline: 6,
  chapter: 14,
  title: 1,
  subtitle: 1,
  description: 2,
  character: 3,
  dialogue: 4,
  blurb: 2,
  keywords: 1,
};

const MODEL_FOR_ACTION: Partial<Record<AiAction, string>> = {
  continue: 'Quill Large',
  expand: 'Quill Large',
  chapter: 'Quill Large',
  grammar: 'Proof Standard',
  translate: 'Lingua Translate',
  outline: 'Quill Large',
  rewrite: 'Quill Fast',
};

function keywords(text: string, count = 5): string[] {
  const stop = new Set(['the', 'and', 'that', 'with', 'from', 'this', 'have', 'were', 'they', 'their', 'there', 'when', 'what', 'into', 'would', 'could', 'about', 'because', 'been', 'after', 'before', 'over', 'under', 'than', 'then', 'them', 'she', 'her', 'him', 'his', 'was', 'are', 'not', 'for', 'but', 'you', 'had', 'has']);
  const words = stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stop.has(word));
  const frequency = new Map<string, number>();
  words.forEach((word) => frequency.set(word, (frequency.get(word) ?? 0) + 1));
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

function sentence(text: string): string {
  const plain = stripHtml(text).trim();
  if (!plain) return 'The morning arrived the way it always did, without asking permission.';
  const sentences = plain.split(/(?<=[.!?])\s+/);
  return sentences[sentences.length - 1] ?? plain;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/* ------------------------------------------------------------- generators */

function buildContinue(input: string, tone: string, context?: string) {
  const last = sentence(input);
  const key = keywords(input, 3);
  const subject = key[0] ?? 'the room';
  return [
    `${last.replace(/[.!?]$/, '')} — and then, because ${context ?? 'the moment'} had been waiting for it, something shifted.`,
    `The ${subject} held its shape for one breath longer than it should have, which is another way of saying that everything was about to change.`,
    `There is a particular silence that follows a decision. It is not the absence of sound; it is the sound of a room agreeing with you, or refusing to.`,
    `${tone.includes('Suspense') ? 'Nobody moved. Somewhere below, a door that had been closed all evening was opened, carefully, by someone who did not want to be heard.' : 'It was, she decided later, the most ordinary moment of the whole week, which is exactly why she remembered it.'}`,
  ].join(' ');
}

function buildExpand(input: string) {
  const base = stripHtml(input).trim();
  const key = keywords(input, 2);
  return `<p>${base}</p><p>The detail mattered more than the event itself. ${
    key[0] ? titleCase(key[0]) : 'The room'
  } became the thing you could hold on to — a texture, a temperature, a particular way the light gave up on the far wall.</p><p>What changed was not the situation. What changed was the amount of it she was willing to see at once.</p>`;
}

function buildRewrite(input: string, instructions: string) {
  const plain = stripHtml(input).trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  const rebuilt = sentences.map((line, index) => {
    const trimmed = line
      .replace(/\bvery\b\s?/gi, '')
      .replace(/\bsuddenly\b\s?/gi, '')
      .replace(/\bbegan to\b/gi, '')
      .replace(/\bin order to\b/gi, 'to')
      .replace(/\bdue to the fact that\b/gi, 'because')
      .replace(/\butilise\b/gi, 'use')
      .replace(/\s{2,}/g, ' ');
    return index === 0 ? trimmed : trimmed;
  });
  const joined = rebuilt.join(' ');
  return instructions ? `${joined}\n\n<em>Applied: ${instructions}. Core meaning preserved; ${sentences.length} sentences restructured.</em>` : joined;
}

function buildSimplify(input: string) {
  const plain = stripHtml(input).trim();
  return plain
    .replace(/\butilise\b/gi, 'use')
    .replace(/\bcommence\b/gi, 'start')
    .replace(/\bterminate\b/gi, 'end')
    .replace(/\bfacilitate\b/gi, 'help')
    .replace(/\bin the event that\b/gi, 'if')
    .replace(/\bat this point in time\b/gi, 'now')
    .replace(/\ba large number of\b/gi, 'many')
    .replace(/\bis able to\b/gi, 'can')
    .replace(/\s{2,}/g, ' ');
}

function buildShorten(input: string) {
  const plain = stripHtml(input).trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  const keep = sentences.filter((_line, index) => index % 3 !== 1);
  return (keep.length ? keep : sentences.slice(0, 1)).join(' ');
}

function buildTone(input: string, tone: string) {
  const plain = stripHtml(input).trim();
  const prefixes: Record<string, string> = {
    'Warm and literary': 'She would remember it as the week the weather changed its mind.',
    'Clear and practical': 'Here is the short version, and then the detail.',
    Suspenseful: 'Something in the room was already wrong, and had been for some time.',
    Playful: 'Fox, it must be said, had not thought this through.',
    Academic: 'The evidence supports a narrower claim than is usually made.',
    Conversational: 'Look, the honest answer is simpler than the official one.',
    Inspirational: 'You do not need permission to begin, only a first sentence.',
    'Dark and atmospheric': 'The fog came in low and stayed, the way an argument does.',
  };
  return `${prefixes[tone] ?? prefixes['Warm and literary']} ${plain}`;
}

function buildGrammar(input: string) {
  const plain = stripHtml(input);
  const issues: string[] = [];
  if (/\s{2,}/.test(plain)) issues.push('Double space detected');
  if (/\bvery\b/i.test(plain)) issues.push('Filler intensifier (“very”)');
  if (/\bsuddenly\b/i.test(plain)) issues.push('Overused adverb (“suddenly”)');
  if (/\bi\b/.test(plain)) issues.push('Lowercase first-person pronoun');
  if (/\b(alot|untill|recieve|seperate|definately)\b/i.test(plain)) issues.push('Spelling: ' + plain.toLowerCase().match(/\b(alot|untill|recieve|seperate|definately)\b/i)?.[0]);
  const cleaned = plain
    .replace(/\s{2,}/g, ' ')
    .replace(/\bi\b/g, 'I')
    .replace(/\balot\b/gi, 'a lot')
    .replace(/\buntill\b/gi, 'until')
    .replace(/\brecieve\b/gi, 'receive')
    .replace(/\bseperate\b/gi, 'separate')
    .replace(/\bdefinately\b/gi, 'definitely');
  return { text: cleaned, issues };
}

function buildSummarize(input: string) {
  const plain = stripHtml(input).trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lead = sentences.slice(0, 2).join(' ');
  const key = keywords(input, 3);
  return `${lead}\n\n<strong>Key threads:</strong> ${key.map(titleCase).join(', ') || 'narrative, stakes, resolution'}.`;
}

function buildTranslate(input: string, language: string) {
  const plain = stripHtml(input).trim().slice(0, 220);
  const notes: Record<string, string> = {
    Spanish: 'Traducción simulada — el motor real conservará las voces de los personajes.',
    French: 'Traduction simulée — le moteur réel préservera les voix des personnages.',
    German: 'Simulierte Übersetzung — die echte Engine bewahrt die Figurenstimmen.',
    Italian: 'Traduzione simulata — il motore reale manterrà le voci dei personaggi.',
    Portuguese: 'Tradução simulada — o motor real preservará as vozes das personagens.',
    Japanese: 'シミュレーション翻訳 — 実際のエンジンは登場人物の声を保持します。',
    Hindi: 'अनुवाद का नमूना — वास्तविक इंजन पात्रों की आवाज़ बनाए रखेगा।',
  };
  return `<p>${plain}</p><p class="translation-note"><em>${notes[language] ?? 'Translated output will appear here with terminology locking applied.'}</em></p>`;
}

function buildTitles(input: string, genre: string) {
  const key = keywords(input, 4);
  const seed = key[0] ? titleCase(key[0]) : 'Harbour';
  const seed2 = key[1] ? titleCase(key[1]) : 'Light';
  const options = [
    `The ${seed} of Small ${seed2}`,
    `${seed} & ${seed2}`,
    `What the ${seed} Kept`,
    `${seed} for ${genre === 'nonfiction' ? 'Impatient' : 'Beginners'}`,
    `The Last ${seed2}`,
    `${seed}, ${seed2}, and Everything Between`,
  ];
  return options.map((option) => option);
}

function buildCharacter(input: string) {
  const key = keywords(input, 2);
  const name = titleCase(key[0] ?? 'Mara');
  return `**${name} Ellsworth** — 34, returns home after six years away.\n\n**Wants:** to close the file on a family debt. **Needs:** to accept help she did not earn.\n\n**Voice:** short sentences under pressure; long, careful ones when she is lying. Never uses an adverb when a noun will do.\n\n**Contradiction:** she distrusts nostalgia and keeps every letter she has ever received.`;
}

function buildDialogue(input: string, tone: string) {
  const key = keywords(input, 2);
  const subject = key[0] ?? 'the ledger';
  return `“You could have told me about ${subject}.”\n\n“I could have.”\n\n“That is not the same as doing it.”\n\n“No.” He turned the cup a quarter turn, aligning the handle with nothing in particular. “${
    tone.includes('Suspense') ? 'But if I had told you then, you would not have come back.' : 'But you came back anyway, and I would rather explain it to your face.'
  }”`;
}

function buildBlurb(input: string) {
  const key = keywords(input, 3);
  return `${
    key.length ? `A story about ${key.map((word) => word.toLowerCase()).join(', ')}.` : 'A story about returning.'
  } Six winters after the harbour froze, one woman comes home to a town that has learned to keep its promises quietly — and to a question that has been waiting for her since the night the light went out.\n\nPerfect for readers of literary fiction who like their suspense slow and their prose precise.`;
}

/* ------------------------------------------------------------------ hooks */

export interface AiProgressCallback {
  (event: { step: string; progress: number }): void;
}

export const aiService = {
  creditCost(action: AiAction) {
    return CREDIT_COST[action] ?? 2;
  },
  modelFor(action: AiAction) {
    return MODEL_FOR_ACTION[action] ?? 'Quill Large';
  },
  async run(request: AiRequest, onProgress?: AiProgressCallback, userId = 'user_demo'): Promise<AiResponse> {
    const steps = ['Reading context', 'Thinking', 'Drafting', 'Checking style rules'];
    const started = Date.now();
    for (let i = 0; i < steps.length; i += 1) {
      onProgress?.({ step: steps[i], progress: Math.round(((i + 1) / steps.length) * 92) });
      await delay(150 + Math.random() * 260);
    }

    const input = request.input ?? '';
    const tone = request.tone ?? 'Warm and literary';
    let text = '';
    const notes: string[] = [];
    let alternatives: string[] = [];

    switch (request.action) {
      case 'continue':
        text = buildContinue(input, tone, request.genre);
        notes.push('Continued from the final sentence of your selection.');
        break;
      case 'rewrite':
        text = buildRewrite(input, request.instructions ?? '');
        notes.push('Clichés, filler intensifiers and nominalisations reduced.');
        break;
      case 'improve':
        text = buildRewrite(input, 'tightened rhythm and varied sentence length');
        notes.push('Rhythm varied; the longest sentence was split in two.');
        break;
      case 'simplify':
        text = buildSimplify(input);
        notes.push('Reading level reduced. Meaning preserved.');
        break;
      case 'expand':
        text = buildExpand(input);
        notes.push('Added sensory detail and interiority; no new plot facts introduced.');
        break;
      case 'shorten':
        text = buildShorten(input);
        notes.push('Trimmed roughly a third of the words without losing a beat.');
        break;
      case 'tone':
        text = buildTone(input, tone);
        notes.push(`Tone applied: ${tone}.`);
        break;
      case 'grammar': {
        const result = buildGrammar(input);
        text = result.text;
        notes.push(result.issues.length ? `${result.issues.length} issues found: ${result.issues.join('; ')}.` : 'No issues found in this passage.');
        break;
      }
      case 'summarize':
        text = buildSummarize(input);
        notes.push('Summary drawn from the selected passage only.');
        break;
      case 'translate':
        text = buildTranslate(input, request.language ?? 'Spanish');
        notes.push(`Terminology locking applied using your glossary. Target: ${request.language ?? 'Spanish'}.`);
        break;
      case 'title': {
        alternatives = buildTitles(input, request.genre ?? 'fiction');
        text = alternatives[0];
        notes.push('Titles are tuned to your genre and trim size; shorter titles survive thumbnail tests better.');
        break;
      }
      case 'subtitle': {
        alternatives = [
          'A novel of the Ellsworth coast',
          'A story about the light a town keeps on',
          'A novel',
          'Notes on returning, and the people who stayed',
        ];
        text = alternatives[0];
        break;
      }
      case 'description':
        text = buildBlurb(input);
        notes.push('Description written for marketplace listings (180–400 characters recommended).');
        break;
      case 'blurb':
        text = buildBlurb(input);
        break;
      case 'character':
        text = buildCharacter(input);
        notes.push('Added to book knowledge as a character entry (pending your approval).');
        break;
      case 'dialogue':
        text = buildDialogue(input, tone);
        notes.push('Dialogue attribution kept minimal; speech rhythms differ between speakers.');
        break;
      case 'keywords': {
        const list = keywords(input, 8);
        alternatives = list;
        text = list.join(', ');
        notes.push('Keywords ranked by frequency across the manuscript.');
        break;
      }
      case 'outline': {
        const genre = request.genre ?? 'Literary fiction';
        const audience = request.audience ?? 'Adult readers';
        const beats = ['Opening', 'Inciting turn', 'First complication', 'Midpoint reversal', 'Cost of the choice', 'Second reversal', 'Crisis', 'Climax', 'Resolution'];
        text = beats
          .map(
            (beat, index) =>
              `<h3>Chapter ${index + 1} — ${beat}</h3><p>${genre} beat aimed at ${audience.toLowerCase()}. ${
                index === 0
                  ? 'Establish the ordinary world, the promise of the book, and the question the reader will carry.'
                  : 'Escalate stakes, deepen the central relationship, and end on a turn that makes stopping difficult.'
              }</p>`,
          )
          .join('');
        break;
      }
      default:
        text = buildContinue(input, tone);
    }

    const credits = CREDIT_COST[request.action] ?? 2;
    aiRepo.record({
      id: uid('ai'),
      userId,
      userName: getDatabase().users.find((user) => user.id === userId)?.name ?? 'Author',
      feature: request.action,
      credits,
      model: aiService.modelFor(request.action),
      createdAt: new Date().toISOString(),
      tokens: 320 + Math.round(Math.random() * 1800),
    });
    const user = userRepo.find(userId);
    if (request.action === 'translate') void user;

    onProgress?.({ step: 'Ready', progress: 100 });

    return {
      id: uid('gen'),
      action: request.action,
      text,
      alternatives,
      credits,
      model: aiService.modelFor(request.action),
      tokens: 320 + Math.round(Math.random() * 1800),
      latencyMs: Date.now() - started,
      notes,
    };
  },

  /** Step-by-step AI book generator used by the wizard. */
  generationSteps(brief: AiBookBrief): BookGenerationStep[] {
    const steps: BookGenerationStep[] = [
      { id: 'step_outline', label: 'Structuring outline', detail: `${brief.chapterCount} chapters for ${brief.genre}`, status: 'pending', progress: 0 },
      { id: 'step_memory', label: 'Seeding book memory', detail: 'Characters, setting, timeline and style rules', status: 'pending', progress: 0 },
    ];
    brief.outline.forEach((entry, index) => {
      steps.push({
        id: `step_chapter_${index}`,
        label: `Drafting ${entry.title}`,
        detail: entry.summary.slice(0, 70),
        status: 'pending',
        progress: 0,
      });
    });
    steps.push({ id: 'step_finish', label: 'Assembling manuscript', detail: 'Front matter, chapters and back matter', status: 'pending', progress: 0 });
    return steps;
  },

  async generateOutline(brief: AiBookBrief, onProgress?: AiProgressCallback): Promise<AiBookBrief['outline']> {
    onProgress?.({ step: 'Sketching structure', progress: 30 });
    await delay(700);
    onProgress?.({ step: 'Balancing chapter length', progress: 70 });
    await delay(500);
    const base = brief.chapterCount || 10;
    const arcs = [
      ['Ordinary world', 'Introduce the protagonist and the promise of the story.'],
      ['The disturbance', 'The event that makes the old life impossible.'],
      ['Reluctant commitment', 'The protagonist tries to solve it the easy way.'],
      ['First threshold', 'A door that closes behind them.'],
      ['Complications', 'Allies, costs and the first real defeat.'],
      ['Midpoint reversal', 'New information reframes the whole problem.'],
      ['Pressure', 'The antagonist moves; the timeline shortens.'],
      ['All is lost', 'The plan fails and the cost is personal.'],
      ['The choice', 'The protagonist chooses the harder, truer path.'],
      ['Climax', 'Confrontation with the central question.'],
      ['Resolution', 'The new normal, and what it cost.'],
      ['Coda', 'The image the reader should carry out of the book.'],
    ];
    return Array.from({ length: base }).map((_, index) => ({
      id: uid('outline'),
      title: index === 0 ? 'Prologue' : `Chapter ${index}`,
      summary: `${arcs[index % arcs.length][1]} Tone: ${brief.tone}. Audience: ${brief.audience}.`,
      approved: true,
    }));
  },

  async generateChapter(brief: AiBookBrief, chapterTitle: string, summary: string, onProgress?: AiProgressCallback): Promise<string> {
    onProgress?.({ step: `Drafting ${chapterTitle}`, progress: 20 });
    await delay(900);
    onProgress?.({ step: 'Deepening scene detail', progress: 60 });
    await delay(800);
    onProgress?.({ step: 'Checking continuity against memory', progress: 90 });
    await delay(400);
    return `<h2>${chapterTitle}</h2><p>${summary}</p><p>${buildExpand(
      `${brief.protagonist || 'The protagonist'} arrived with the specific tiredness of someone who has rehearsed a conversation and lost it anyway.`,
    )}</p><p>${buildContinue('Nothing about the street had changed, which was the problem.', brief.tone, chapterTitle)}</p><p><em>Generated with the Scriptora book generator using your outline, tone and book memory. Edit freely — nothing is locked.</em></p>`;
  },

  /** Illustration generation — mock provider returns deterministic artwork. */
  async generateImage(params: { prompt: string; style: string; userId?: string; aspect?: 'square' | 'portrait' | 'landscape' }, onProgress?: AiProgressCallback): Promise<{ url: string; width: number; height: number; credits: number; prompt: string; style: string; revisedPrompt: string }> {
    onProgress?.({ step: 'Interpreting prompt', progress: 25 });
    await delay(700);
    onProgress?.({ step: 'Rendering', progress: 65 });
    await delay(900);
    onProgress?.({ step: 'Upscaling', progress: 92 });
    await delay(300);
    const paletteIndex = Math.abs(params.prompt.length) % palettes.length;
    const size = params.aspect === 'landscape' ? { width: 1800, height: 1200 } : params.aspect === 'square' ? { width: 1600, height: 1600 } : { width: 1600, height: 2400 };
    const url = coverArtUrl({
      seed: params.prompt + params.style,
      paletteId: palettes[paletteIndex].id,
      style: (['aurora', 'geometric', 'botanical', 'orbit', 'waves'] as const)[params.prompt.length % 5],
    });
    onProgress?.({ step: 'Ready', progress: 100 });
    return {
      url,
      ...size,
      credits: 12,
      prompt: params.prompt,
      style: params.style,
      revisedPrompt: `${params.prompt}, ${params.style.toLowerCase()} style, print-safe contrast for ${params.aspect ?? 'portrait'} trim`,
    };
  },

  async coverConcepts(bookTitle: string, author: string, style: string): Promise<{ id: string; url: string; label: string; paletteId: string }[]> {
    await delay(1100);
    const styles = ['sunrise', 'mountain', 'geometric', 'aurora'] as const;
    return styles.map((art, index) => ({
      id: uid('cover'),
      url: coverArtUrl({ seed: `${bookTitle}-${style}-${index}`, paletteId: palettes[(index * 3) % palettes.length].id, style: art, title: bookTitle, author, showText: false }),
      label: ['Bold typographic', 'Atmospheric landscape', 'Geometric modern', 'Illustrated classic'][index],
      paletteId: palettes[(index * 3) % palettes.length].id,
    }));
  },

  async proofread(text: string, onProgress?: AiProgressCallback) {
    onProgress?.({ step: 'Reading', progress: 30 });
    await delay(650);
    onProgress?.({ step: 'Checking grammar, style and consistency', progress: 80 });
    await delay(550);
    const result = buildGrammar(text);
    onProgress?.({ step: 'Ready', progress: 100 });
    return {
      issues: result.issues,
      corrected: result.text,
      score: Math.max(72, 100 - result.issues.length * 7),
    };
  },

  async suggestMemory(book: Book): Promise<{ type: 'character' | 'location' | 'fact'; name: string; detail: string }[]> {
    await delay(900);
    const text = book.pages.map((page) => page.content).join(' ');
    const key = keywords(text, 6);
    const suggestions = [
      { type: 'character' as const, name: titleCase(key[0] ?? 'Mara'), detail: 'Detection of a recurring named actor across chapters 1–3 with an unresolved motive.' },
      { type: 'location' as const, name: titleCase(key[1] ?? 'Harbour'), detail: 'Recurring setting referenced in 6 pages with sensory detail already established.' },
      { type: 'fact' as const, name: titleCase(key[2] ?? 'Lantern'), detail: 'An object described with a constraint (never explained before chapter nine) — add as a continuity fact.' },
    ];
    return suggestions;
  },
};
