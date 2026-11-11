/**
 * AES-256-GCM secret vault using Web Crypto (available in Node 22 and browsers).
 * The master key lives in the OS credential store (Windows Credential Manager on the
 * desktop build, macOS Keychain, libsecret) or a 0600 key file in local dev mode.
 * Ciphertext format: `v1.<base64url iv>.<base64url ciphertext>`.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

export class SecretVault {
  private constructor(private readonly key: CryptoKey) {}

  static async fromKeyBytes(raw: Uint8Array): Promise<SecretVault> {
    if (raw.length !== 32) throw new Error('Vault key must be 32 bytes (AES-256)');
    const key = await crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return new SecretVault(key);
  }

  static generateKeyBytes(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, this.key, new TextEncoder().encode(plaintext));
    return `${VERSION}.${toB64Url(iv)}.${toB64Url(new Uint8Array(ct))}`;
  }

  async decrypt(payload: string): Promise<string> {
    const [version, ivB64, ctB64] = payload.split('.');
    if (version !== VERSION || !ivB64 || !ctB64) throw new Error('Unrecognised vault payload format');
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf(fromB64Url(ivB64)) },
        this.key,
        buf(fromB64Url(ctB64)),
      );
      return new TextDecoder().decode(pt);
    } catch {
      throw new Error('Decryption failed — the vault key does not match this data');
    }
  }
}

export function keyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

/** Rejects obviously malformed keys before they hit the network. */
export function validateKeyShape(provider: string, apiKey: string): { ok: boolean; message?: string } {
  const k = apiKey.trim();
  if (k.length < 16) return { ok: false, message: 'Key is too short to be valid.' };
  if (/\s/.test(k)) return { ok: false, message: 'Key contains whitespace — check for a copy/paste error.' };
  if (provider === 'openai' && !k.startsWith('sk-')) return { ok: false, message: 'OpenAI keys normally start with "sk-". Project keys may differ; verify in the OpenAI dashboard.' };
  if (provider === 'anthropic' && !k.startsWith('sk-ant-')) return { ok: false, message: 'Anthropic keys normally start with "sk-ant-".' };
  if (provider === 'google' && !k.startsWith('AIza')) return { ok: false, message: 'Google AI Studio keys normally start with "AIza".' };
  return { ok: true };
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
