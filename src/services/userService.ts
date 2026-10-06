import type { Asset, AuthorProfile, ID, PayoutMethod, StorageObject, User, UserSettings } from '@/types/domain';
import { delay, formatBytes, uid } from '@/lib/utils';
import { assetRepo, userRepo } from '@/repositories';
import { getDatabase, mutateDatabase, resetDatabase } from '@/store/db';
import { entitlementsFor } from './entitlements';
import { emailService } from './notificationService';

export class UserError extends Error {
  code: 'not-found' | 'invalid' | 'email-taken' | 'username-taken';
  constructor(code: UserError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'UserError';
  }
}

function requireUser(id: ID | undefined): User {
  if (!id) throw new UserError('not-found', 'Please sign in to continue.');
  const user = userRepo.find(id);
  if (!user) throw new UserError('not-found', 'That account could not be found.');
  return user;
}

export type ProfilePatch = Partial<
  Pick<User, 'name' | 'username' | 'tagline' | 'bio' | 'website' | 'country' | 'avatarUrl' | 'social' | 'onboarded' | 'isAuthor'>
>;

/**
 * Account, profile, settings and data-portability operations for the signed-in user.
 * UI → userService → repositories → mock database.
 */
export const userService = {
  get(id: ID | undefined) {
    return id ? userRepo.find(id) : undefined;
  },

  async updateProfile(id: ID, patch: ProfilePatch): Promise<User> {
    await delay(320);
    const user = requireUser(id);
    if (patch.username && patch.username !== user.username) {
      const taken = userRepo.findByUsername(patch.username);
      if (taken && taken.id !== id) throw new UserError('username-taken', 'That handle is already in use.');
    }
    if (patch.name !== undefined && patch.name.trim().length < 2) {
      throw new UserError('invalid', 'Your display name needs at least two characters.');
    }
    const updated = userRepo.update(id, patch);
    return updated ?? { ...user, ...patch };
  },

  async updateEmail(id: ID, email: string): Promise<User> {
    await delay(380);
    requireUser(id);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('invalid', 'Enter a valid email address.');
    const existing = userRepo.findByEmail(email);
    if (existing && existing.id !== id) throw new UserError('email-taken', 'That email address is already registered.');
    const updated = userRepo.update(id, { email, emailVerified: false });
    return updated ?? requireUser(id);
  },

  async updateSettings(id: ID, patch: Partial<UserSettings>): Promise<UserSettings> {
    const user = requireUser(id);
    const updated = userRepo.updateSettings(id, patch);
    return updated?.settings ?? { ...user.settings, ...patch };
  },

  /** Upserts the public author profile record that powers /authors and the profile page. */
  async updateAuthorProfile(id: ID, patch: Partial<AuthorProfile>): Promise<AuthorProfile> {
    await delay(280);
    const user = requireUser(id);
    const profile = mutateDatabase((db) => {
      const index = db.authorProfiles.findIndex((entry) => entry.userId === id);
      const base: AuthorProfile = index >= 0
        ? db.authorProfiles[index]
        : {
            userId: user.id,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            tagline: user.tagline,
            bio: user.bio,
            social: user.social,
            location: user.country,
            followers: user.followers,
            rating: 0,
            totalBooks: 0,
            totalSales: 0,
            joinedAt: user.createdAt,
            verified: false,
            featured: false,
            genres: [],
          };
      const next = { ...base, ...patch, userId: id };
      if (index >= 0) db.authorProfiles[index] = next;
      else db.authorProfiles = [next, ...db.authorProfiles];
      return next;
    });
    return profile;
  },

  authorProfile(id: ID): AuthorProfile | undefined {
    const db = getDatabase();
    return db.authorProfiles.find((entry) => entry.userId === id);
  },

  async updatePayoutMethod(id: ID, method: PayoutMethod): Promise<User> {
    await delay(300);
    requireUser(id);
    const updated = userRepo.update(id, { payoutMethod: method });
    return updated ?? requireUser(id);
  },

  async verifyEmail(id: ID): Promise<User> {
    await delay(400);
    requireUser(id);
    const updated = userRepo.update(id, { emailVerified: true });
    return updated ?? requireUser(id);
  },

  async resendVerification(id: ID): Promise<void> {
    const user = requireUser(id);
    await emailService.send({ to: user.email, toName: user.name, template: 'verify-email' });
  },

  async changePassword(id: ID, current: string, next: string): Promise<void> {
    await delay(420);
    const user = requireUser(id);
    if (user.password !== current) throw new UserError('invalid', 'Your current password is not correct.');
    if (next.length < 8) throw new UserError('invalid', 'New passwords must be at least 8 characters.');
    userRepo.update(id, { password: next });
  },

  /** Entitlement snapshot for the signed-in user, used by settings and upgrade prompts. */
  entitlementSummary(id: ID) {
    requireUser(id);
    const entitlements = entitlementsFor(id);
    return {
      plan: entitlements.plan,
      books: entitlements.usage.books,
      storage: entitlements.usage.storage,
      aiCredits: entitlements.usage.aiCredits,
      seats: entitlements.usage.seats,
      entitlements,
    };
  },

  /** Every library asset the user owns, newest first. */
  files(id: ID): Asset[] {
    requireUser(id);
    return assetRepo.forUser(id);
  },

  /** Storage objects (uploaded book files, images, exports) tracked in the mock object store. */
  storageObjects(id: ID): StorageObject[] {
    return getDatabase()
      .storageObjects.filter((object) => object.ownerId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  storageSummary(id: ID) {
    const user = requireUser(id);
    const objects = userService.storageObjects(id);
    const assets = assetRepo.forUser(id);
    const used = Math.max(
      user.storageUsedBytes,
      [...objects, ...assets].reduce((total, entry) => total + entry.sizeBytes, 0),
    );
    const { usage } = entitlementsFor(id);
    return {
      used,
      limit: usage.storage.limitBytes,
      label: `${formatBytes(used, 1)} of ${formatBytes(usage.storage.limitBytes, 0)}`,
      objects,
      assets,
      byKind: objects.reduce<Record<string, number>>((acc, object) => {
        acc[object.kind] = (acc[object.kind] ?? 0) + object.sizeBytes;
        return acc;
      }, {}),
    };
  },

  /** Records a deliberately requested data export so history stays auditable. */
  trackExport(id: ID, label: string, sizeBytes: number): StorageObject {
    const object: StorageObject = {
      id: uid('obj'),
      key: `users/${id}/exports/${uid('exp')}.json`,
      bucket: 'scriptora-user-data',
      ownerId: id,
      kind: 'export',
      sizeBytes,
      mimeType: 'application/json',
      createdAt: new Date().toISOString(),
      url: '',
      label,
    };
    return mutateDatabase((db) => {
      db.storageObjects = [object, ...db.storageObjects];
      return object;
    });
  },

  /** Full JSON export of everything the current user owns — portability, not analytics. */
  exportWorkspace(id: ID): { fileName: string; json: string; sizeBytes: number; summary: Record<string, number> } {
    const db = getDatabase();
    const user = requireUser(id);
    const books = db.books.filter((book) => book.ownerId === id);
    const bookIds = new Set(books.map((book) => book.id));
    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: db.version,
      user: { ...user, password: undefined },
      books,
      exports: db.exports.filter((job) => job.userId === id),
      orders: db.orders.filter((order) => order.buyerId === id || order.authorId === id),
      reviews: db.reviews.filter((review) => review.userId === id || bookIds.has(review.bookId)),
      assets: assetRepo.forUser(id),
      activity: db.activity.filter((item) => item.userId === id),
    };
    const json = JSON.stringify(payload, null, 2);
    return {
      fileName: `scriptora-export-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      sizeBytes: json.length,
      summary: {
        books: books.length,
        exports: payload.exports.length,
        orders: payload.orders.length,
        assets: payload.assets.length,
      },
    };
  },

  /** Restores the seeded demo database. Destructive — callers must confirm first. */
  resetDemoData(): void {
    resetDatabase();
  },

  async deleteAccount(id: ID): Promise<void> {
    await delay(500);
    requireUser(id);
    mutateDatabase((db) => {
      db.books = db.books.filter((book) => book.ownerId !== id);
      db.library = db.library.filter((item) => item.userId !== id);
      db.wishlist = db.wishlist.filter((item) => item.userId !== id);
      db.assets = db.assets.filter((asset) => asset.ownerId !== id);
      db.storageObjects = db.storageObjects.filter((object) => object.ownerId !== id);
      db.notifications = db.notifications.filter((notification) => notification.userId !== id);
      db.comments = db.comments.filter((comment) => comment.userId !== id);
      db.collaborators = db.collaborators.filter((collaborator) => collaborator.id !== id);
      db.users = db.users.filter((user) => user.id !== id);
    });
  },
};
