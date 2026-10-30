/** Decode transfer files without silently replacing malformed byte sequences. */
export async function readUtf8File(file: File, limit: number): Promise<string> {
  if (file.size > limit) throw new Error('File exceeds size limit');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('File could not be read'));
    reader.onabort = () => reject(new Error('File reading was aborted'));
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Unexpected file data'));
    reader.readAsArrayBuffer(file);
  });
  if (bytes.byteLength > limit) throw new Error('File exceeds size limit');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
