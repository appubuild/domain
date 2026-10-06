/**
 * StorageService — the single abstraction over file storage.
 *
 * Phase 1 uses a mock R2 provider: objects are described by key/bucket/size and
 * generated URLs are data URLs or blob URLs held in memory for the session.
 * Phase 3 swaps `provider` for a Cloudflare R2 implementation with signed
 * uploads; nothing in the UI changes because everything goes through here.
 */
import type { Asset, AssetKind, ID, StorageObject } from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';
import { uid } from '@/lib/utils';

export interface UploadResult {
  key: string;
  bucket: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  label: string;
}

const blobRegistry = new Map<string, string>();

export interface StorageProvider {
  readonly name: string;
  put(params: { key: string; bucket: string; blob?: Blob; sizeBytes: number; mimeType: string }): Promise<UploadResult>;
  url(key: string): string;
  remove(key: string): Promise<void>;
}

export class MockR2Provider implements StorageProvider {
  readonly name = 'Mock R2 (Cloudflare R2 ready)';

  async put({ key, bucket, blob, sizeBytes, mimeType }: { key: string; bucket: string; blob?: Blob; sizeBytes: number; mimeType: string }): Promise<UploadResult> {
    let url = '';
    if (blob) {
      url = URL.createObjectURL(blob);
      blobRegistry.set(key, url);
    }
    return { key, bucket, url, sizeBytes, mimeType, label: key.split('/').pop() ?? key };
  }

  url(key: string) {
    return blobRegistry.get(key) ?? '';
  }

  async remove(key: string) {
    const url = blobRegistry.get(key);
    if (url) URL.revokeObjectURL(url);
    blobRegistry.delete(key);
  }
}

let provider: StorageProvider = new MockR2Provider();

export const storageService = {
  /** Swap the provider (used by tests and by the future R2 implementation). */
  useProvider(next: StorageProvider) {
    provider = next;
  },
  get providerName() {
    return provider.name;
  },
  buckets: {
    assets: 'scriptora-assets',
    exports: 'scriptora-exports',
    books: 'scriptora-books',
    marketplace: 'scriptora-marketplace',
  },
  async uploadFile(userId: ID, file: File, folder: string, kind: AssetKind = 'upload'): Promise<Asset> {
    const key = `users/${userId}/assets/${folder.toLowerCase()}/${file.name}`;
    const result = await provider.put({
      key,
      bucket: storageService.buckets.assets,
      blob: file,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
    });
    const url = result.url || storageService.generatedPlaceholder(file.name);
    const asset: Asset = {
      id: uid('asset'),
      ownerId: userId,
      name: file.name.replace(/\.[^.]+$/, ''),
      kind,
      url,
      mimeType: file.type || 'image/png',
      sizeBytes: file.size,
      width: 1600,
      height: 2400,
      folder,
      tags: [],
      createdAt: new Date().toISOString(),
      favorite: false,
      storageKey: key,
    };
    return asset;
  },
  async putDataUrl(userId: ID, params: { dataUrl: string; name: string; folder: string; kind: AssetKind; width: number; height: number; sizeBytes: number }): Promise<Asset> {
    const key = `users/${userId}/assets/${params.folder.toLowerCase()}/${uid('obj')}-${params.name.replace(/\s+/g, '-').toLowerCase()}.png`;
    await provider.put({ key, bucket: storageService.buckets.assets, sizeBytes: params.sizeBytes, mimeType: 'image/png' });
    return {
      id: uid('asset'),
      ownerId: userId,
      name: params.name,
      kind: params.kind,
      url: params.dataUrl,
      mimeType: 'image/png',
      sizeBytes: params.sizeBytes,
      width: params.width,
      height: params.height,
      folder: params.folder,
      tags: params.kind === 'ai-image' ? ['ai'] : [],
      createdAt: new Date().toISOString(),
      favorite: false,
      storageKey: key,
    };
  },
  generatedPlaceholder(label: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#1f2937"/><text x="50%" y="50%" fill="#9ca3af" font-family="Inter, sans-serif" font-size="28" text-anchor="middle">${label.slice(0, 24)}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  },
  /** Describes an object without materialising it — used for new exports. */
  describeObject(params: { ownerId: ID; key: string; bucket: string; kind: StorageObject['kind']; sizeBytes: number; mimeType: string; label: string }): StorageObject {
    const object: StorageObject = {
      id: uid('obj'),
      key: params.key,
      bucket: params.bucket,
      ownerId: params.ownerId,
      kind: params.kind,
      sizeBytes: params.sizeBytes,
      mimeType: params.mimeType,
      createdAt: new Date().toISOString(),
      url: '',
      label: params.label,
    };
    return mutateDatabase((db) => {
      db.storageObjects = [object, ...db.storageObjects];
      return object;
    });
  },
  objects(userId?: ID): StorageObject[] {
    const objects = getDatabase().storageObjects;
    return (userId ? objects.filter((object) => object.ownerId === userId) : objects)
      .slice()
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  },
  totalBytes(userId?: ID) {
    return storageService.objects(userId).reduce((total, object) => total + object.sizeBytes, 0);
  },
  /** Downloads a generated blob through the provider layer (mock = direct save). */
  download(result: { blob: Blob; fileName: string }) {
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

export const assetService = {
  listForUser: (userId: ID) => getDatabase().assets.filter((asset) => asset.ownerId === userId),
  folders: (userId: ID) => {
    const folders = new Set(getDatabase().assets.filter((asset) => asset.ownerId === userId).map((asset) => asset.folder));
    return ['All', ...Array.from(folders).sort()];
  },
  create: (asset: Asset) =>
    mutateDatabase((db) => {
      db.assets = [asset, ...db.assets];
      const user = db.users.find((entry) => entry.id === asset.ownerId);
      if (user) user.storageUsedBytes += asset.sizeBytes;
      return asset;
    }),
  remove: (id: ID) =>
    mutateDatabase((db) => {
      const asset = db.assets.find((entry) => entry.id === id);
      db.assets = db.assets.filter((entry) => entry.id !== id);
      if (asset) {
        const user = db.users.find((entry) => entry.id === asset.ownerId);
        if (user) user.storageUsedBytes = Math.max(0, user.storageUsedBytes - asset.sizeBytes);
      }
    }),
  update: (id: ID, patch: Partial<Asset>) =>
    mutateDatabase((db) => {
      const index = db.assets.findIndex((asset) => asset.id === id);
      if (index >= 0) db.assets[index] = { ...db.assets[index], ...patch };
      return db.assets[index];
    }),
};
