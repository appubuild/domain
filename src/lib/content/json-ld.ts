/**
 * JSON-LD serialisation.
 *
 * Structured data is injected into a `<script>` element, so any `<` inside the data (a post
 * title, an FAQ answer) could otherwise close the tag early. Escaping `<` as `\u003c` keeps
 * the JSON semantically identical while making that impossible.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}
