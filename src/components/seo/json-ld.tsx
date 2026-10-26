import { serializeJsonLd } from "@/lib/content/json-ld";

/**
 * Renders JSON-LD structured data. Serialisation (and the `</script>` escape) lives in
 * `serializeJsonLd` so it can be unit-tested without a DOM.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
