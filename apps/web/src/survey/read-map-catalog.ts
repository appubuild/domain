import { parseMapCatalog, type MapCatalogConfig } from '../../../../packages/map-catalog/src';

/** Read deployment-owned public configuration without downloading an unbounded response. */
export async function loadMapCatalog(baseUrl: string, signal: AbortSignal): Promise<MapCatalogConfig> {
  // Same-origin credentials are needed for protected Vercel previews; they are never sent to tile providers.
  const response = await fetch(`${baseUrl}map-catalog.json`, { signal, credentials: 'same-origin', cache: 'no-cache' });
  return readMapCatalog(response);
}

export async function readMapCatalog(response: Response): Promise<MapCatalogConfig> {
  const limit = 32 * 1024;
  if (!response.ok || Number(response.headers.get('content-length') || 0) > limit || !response.body) throw new Error('Catalog unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Catalog too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseMapCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
