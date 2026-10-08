/**
 * FreeImageService — architecture for approved free-image sources.
 *
 * The provider registry below describes *what* each source supports; no
 * credentials, keys or client secrets live in the client. Phase 1 answers from a
 * deterministic mock catalogue shaped exactly like a provider response, so
 * "Add to Book" inserts a real image element today and swapping in a
 * server-side proxy later touches only `search()`.
 */
import type { ID } from '@/types/domain';
import { delay, uid } from '@/lib/utils';

export type FreeImageProviderId = 'unsplash' | 'pexels' | 'pixabay' | 'openverse';

export interface FreeImageProvider {
  id: FreeImageProviderId;
  label: string;
  licence: string;
  attributionRequired: boolean;
  /** Where the credential lives in production: never in the browser. */
  credential: 'server-proxy';
  enabled: boolean;
}

export interface FreeImageResult {
  id: string;
  provider: FreeImageProviderId;
  title: string;
  author: string;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
  licence: string;
  attribution: string;
  /** Search tags, kept so filters work offline. */
  tags: string[];
}

export interface FreeImageSearch {
  query: string;
  provider?: FreeImageProviderId | 'all';
  orientation?: 'any' | 'portrait' | 'landscape' | 'square';
  page?: number;
}

export const FREE_IMAGE_PROVIDERS: FreeImageProvider[] = [
  { id: 'unsplash', label: 'Unsplash', licence: 'Unsplash licence — free for commercial use', attributionRequired: false, credential: 'server-proxy', enabled: true },
  { id: 'pexels', label: 'Pexels', licence: 'Pexels licence — free for commercial use', attributionRequired: false, credential: 'server-proxy', enabled: true },
  { id: 'pixabay', label: 'Pixabay', licence: 'Pixabay content licence', attributionRequired: false, credential: 'server-proxy', enabled: true },
  { id: 'openverse', label: 'Openverse (CC)', licence: 'Creative Commons — check the individual licence', attributionRequired: true, credential: 'server-proxy', enabled: false },
];

/** Deterministic mock catalogue: same query, same results, no network. */
const SUBJECTS = [
  { title: 'Misty harbour at dawn', tags: ['harbour', 'sea', 'dawn', 'travel', 'boat'] },
  { title: 'Cartographer’s desk with brass tools', tags: ['map', 'desk', 'antique', 'tools', 'history'] },
  { title: 'Slow morning coffee and open notebook', tags: ['coffee', 'notebook', 'morning', 'writing', 'calm'] },
  { title: 'Lantern-lit doorway in old town', tags: ['lantern', 'door', 'town', 'night', 'warm'] },
  { title: 'Wildflower meadow in low sun', tags: ['flowers', 'meadow', 'summer', 'nature', 'golden'] },
  { title: 'Mountain ridge under heavy cloud', tags: ['mountain', 'cloud', 'landscape', 'hike', 'grey'] },
  { title: 'Rustic kitchen table with bread', tags: ['food', 'bread', 'kitchen', 'recipe', 'rustic'] },
  { title: 'Library shelves in warm light', tags: ['library', 'books', 'shelves', 'reading', 'warm'] },
  { title: 'Rain on a window at night', tags: ['rain', 'window', 'night', 'mood', 'city'] },
  { title: 'Paper texture with ink wash', tags: ['paper', 'texture', 'ink', 'background', 'craft'] },
  { title: 'Child reading under a blanket fort', tags: ['child', 'reading', 'cozy', 'family', 'story'] },
  { title: 'Desert dunes at golden hour', tags: ['desert', 'dunes', 'sun', 'travel', 'warm'] },
];

const PROVIDER_ORDER: FreeImageProviderId[] = ['unsplash', 'pexels', 'pixabay'];

function hash(value: string): number {
  let out = 0;
  for (let index = 0; index < value.length; index += 1) out = (out * 31 + value.charCodeAt(index)) % 100000;
  return out;
}

export const freeImageService = {
  providers(): FreeImageProvider[] {
    return FREE_IMAGE_PROVIDERS;
  },

  /** Mock search. Real implementation calls our server proxy, never a provider directly. */
  async search(request: FreeImageSearch): Promise<{ results: FreeImageResult[]; total: number; provider: string; notice: string }> {
    await delay(180);
    const query = request.query.trim().toLowerCase();
    const enabled = FREE_IMAGE_PROVIDERS.filter((provider) => provider.enabled);
    const pool = request.provider && request.provider !== 'all'
      ? enabled.filter((provider) => provider.id === request.provider)
      : enabled;
    const seed = hash(query || 'books');
    const matches = SUBJECTS.filter((subject) => !query || subject.tags.some((tag) => tag.includes(query)) || subject.title.toLowerCase().includes(query));
    const subjects = matches.length ? matches : SUBJECTS;

    const results: FreeImageResult[] = subjects.flatMap((subject, subjectIndex) =>
      (pool.length ? pool : enabled).map((provider, providerIndex) => {
        const index = seed + subjectIndex * 7 + providerIndex * 3;
        const orientation = index % 3 === 0 ? 'portrait' : index % 3 === 1 ? 'landscape' : 'square';
        const width = orientation === 'portrait' ? 1000 : orientation === 'landscape' ? 1600 : 1200;
        const height = orientation === 'portrait' ? 1500 : orientation === 'landscape' ? 1000 : 1200;
        return {
          id: `free_${provider.id}_${index}`,
          provider: provider.id,
          title: subject.title,
          author: ['A. Moreau', 'N. Okafor', 'L. Bergström', 'R. Haddad', 'J. Tanaka'][index % 5],
          width,
          height,
          url: `https://picsum.photos/seed/${provider.id}-${index}/${width}/${height}`,
          thumbnailUrl: `https://picsum.photos/seed/${provider.id}-${index}/320/240`,
          licence: provider.licence,
          attribution: `${subject.title} — ${['A. Moreau', 'N. Okafor', 'L. Bergström', 'R. Haddad', 'J. Tanaka'][index % 5]} / ${provider.label}`,
          tags: subject.tags,
        };
      }),
    );

    const orientation = request.orientation && request.orientation !== 'any' ? request.orientation : undefined;
    const filtered = orientation
      ? results.filter((result) => (orientation === 'portrait' ? result.height > result.width : orientation === 'landscape' ? result.width > result.height : Math.abs(result.width - result.height) < 120))
      : results;
    // De-duplicate by title+provider so the grid shows one card per source.
    const seen = new Set<string>();
    const unique = filtered.filter((result) => {
      const key = `${result.provider}:${result.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      results: unique,
      total: unique.length,
      provider: request.provider ?? 'all',
      notice: 'Mock results from the approved-source architecture. In production this call goes through the server proxy that holds the API keys.',
    };
  },

  /** Build the element payload the editor inserts, keeping the credit for later exports. */
  toImagePayload(result: FreeImageResult): { src: string; credit: string; assetId: ID } {
    return { src: result.url, credit: result.attribution, assetId: `asset_${uid('free')}` };
  },
};
