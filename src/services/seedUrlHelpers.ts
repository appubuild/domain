import { coverArtUrl } from '@/lib/coverArt';

/** Generated imagery used for templates, demo galleries and page backgrounds. */
export const assets = Array.from({ length: 12 }).map((_, index) =>
  coverArtUrl({ seed: `gallery-${index}`, paletteId: ['ocean', 'ember', 'lavender', 'forest', 'rose', 'midnight'][index % 6] }),
);
