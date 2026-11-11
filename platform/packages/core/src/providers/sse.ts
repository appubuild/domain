/** Minimal, correct SSE parser for fetch streams. Handles multi-line data, comments, CRLF. */
export type SseEvent = { event: string; data: string; id?: string };

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let dataLines: string[] = [];
  let id: string | undefined;

  const flush = (): SseEvent | null => {
    if (dataLines.length === 0) {
      event = 'message';
      return null;
    }
    const evt = { event, data: dataLines.join('\n'), id };
    event = 'message';
    dataLines = [];
    id = undefined;
    return evt;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1));
        if (line === '') {
          const evt = flush();
          if (evt) yield evt;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const rawValue = colon === -1 ? '' : line.slice(colon + 1);
        const fieldValue = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
        if (field === 'event') event = fieldValue;
        else if (field === 'data') dataLines.push(fieldValue);
        else if (field === 'id') id = fieldValue;
      }
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** Reads an HTTP error body safely (truncated) for ProviderError messages. */
export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 600);
  } catch {
    return '';
  }
}
