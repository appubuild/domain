/**
 * Article body splitting — where the mid-content placement goes.
 *
 * The `blog-post` template has an ad placement at `mid-content`, and "mid-content" only means
 * something if it really is mid-way through the article. Splitting an HTML string is not
 * parsing it, so this stays deliberately conservative:
 *
 *   - it only cuts **between** top-level blocks (after a closing block tag), never inside one;
 *   - it refuses to cut at all when the body has fewer than four blocks, so a short article
 *     does not get an ad two lines in;
 *   - `lead + rest` is always exactly the input, so no content can be lost by a bad index.
 *
 * The caller sanitises first. This function only moves text around.
 */

const BLOCK_END = /<\/(?:p|h1|h2|h3|h4|ul|ol|blockquote|figure|pre|table)>/g;

export type SplitBody = {
  /** Content before the placement. */
  lead: string;
  /** Content after it. Empty when the body is too short to have a middle. */
  rest: string;
};

export const MIN_BLOCKS_FOR_SPLIT = 4;

export function splitArticleBody(html: string): SplitBody {
  const cuts: number[] = [];
  BLOCK_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_END.exec(html)) !== null) {
    cuts.push(match.index + match[0].length);
  }

  if (cuts.length < MIN_BLOCKS_FOR_SPLIT) return { lead: html, rest: "" };

  const middle = html.length / 2;
  let best = cuts[0] ?? 0;
  for (const cut of cuts) {
    if (Math.abs(cut - middle) < Math.abs(best - middle)) best = cut;
  }

  // A cut at either extreme would produce an empty half — not a middle.
  if (best <= 0 || best >= html.length) return { lead: html, rest: "" };

  const rest = html.slice(best);
  // Only whitespace after the cut is not content worth a placement of its own.
  if (rest.trim().length === 0) return { lead: html, rest: "" };

  return { lead: html.slice(0, best), rest };
}
