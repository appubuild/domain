import type {
  AdminSettings,
  AiModelConfig,
  AuditLog,
  Book,
  FeatureFlag,
  ID,
  Plan,
  Report,
  Review,
  StorageUsage,
  User,
} from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { getDatabase } from '@/store/db';
import { activityRepo, adminRepo, bookRepo, marketplaceRepo, submissionRepo, userRepo, cmsRepo } from '@/repositories';
import { LIBRARY_ASSETS } from '@/data/libraryAssets';
import { assetService } from './storageService';
import { revenueService, type PeriodKey } from './revenueService';
import { subscriptionService } from './subscriptionService';

export interface AdminOverview {
  users: { total: number; active: number; new7d: number; suspended: number; growthPct: number };
  books: { total: number; published: number; drafts: number; trashed: number; created7d: number; published7d: number };
  commerce: { sales: number; revenue: number; platformFees: number; refunds: number; avgOrderValue: number; conversion: number };
  ai: { creditsUsed: number; imageCredits: number; requests: number; topFeature: string };
  storage: { usedBytes: number; quotaBytes: number; largestFile: string; largestFileBytes: number };
  subscriptions: ReturnType<typeof subscriptionService.adminStats>;
  pending: { submissions: number; reviews: number; reports: number };
}

export const adminService = {
  /* --------------------------------------------------- asset library admin */

  /**
   * Global asset library summary for the admin app: what ships, what was published,
   * what was retired. Phase 2 wires a screen to these numbers; the editor already
   * reads the same list through `assetService.library()`.
   */
  assetLibrary: () => {
    const db = getDatabase();
    const shipped = LIBRARY_ASSETS.length;
    const published = (db.libraryAssets ?? []).filter((asset) => !(db.libraryRetired ?? []).includes(asset.id)).length;
    const retired = (db.libraryRetired ?? []).length;
    const byFolder = assetService.library('all').reduce<Record<string, number>>((total, asset) => {
      total[asset.folder] = (total[asset.folder] ?? 0) + 1;
      return total;
    }, {});
    return { shipped, published, retired, total: assetService.library('all').length, byFolder };
  },

  publishAssetToLibrary: (assetId: ID) => assetService.publishToLibrary(assetId),

  retireAssetFromLibrary: (assetId: ID) => assetService.retireFromLibrary(assetId),


  overview(): AdminOverview {
    const db = getDatabase();
    const now = Date.now();
    const within = (iso: string, days: number) => now - new Date(iso).getTime() <= days * 86400000;

    const users = db.users;
    const newUsers = users.filter((user) => within(user.createdAt, 7)).length;
    const previousNewUsers = users.filter((user) => within(user.createdAt, 14) && !within(user.createdAt, 7)).length;

    const books = db.books.filter((book) => book.status !== 'trashed');
    const orders = db.orders;
    const completed = orders.filter((order) => order.status === 'completed');
    const revenue = completed.reduce((total, order) => total + order.amount, 0);
    const fees = completed.reduce((total, order) => total + order.platformFee, 0);
    const views = db.books.reduce((total, book) => total + book.marketplace.views, 0);

    const aiCredits = db.aiUsage.reduce((total, record) => total + record.credits, 0);
    const featureCounts = new Map<string, number>();
    db.aiUsage.forEach((record) => featureCounts.set(record.feature, (featureCounts.get(record.feature) ?? 0) + 1));
    const topFeature = Array.from(featureCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Continue writing';

    const storageObjects = db.storageObjects.slice().sort((a, b) => b.sizeBytes - a.sizeBytes);
    const usedBytes = db.users.reduce((total, user) => total + user.storageUsedBytes, 0);
    const quotaBytes = db.users.reduce((total, user) => {
      const plan = db.plans.find((entry) => entry.id === user.planId);
      return total + (plan ? plan.features.storageGb : 1) * 1024 * 1024 * 1024;
    }, 0);

    return {
      users: {
        total: users.length,
        active: users.filter((user) => within(user.lastActiveAt, 30)).length,
        new7d: newUsers,
        suspended: users.filter((user) => user.status === 'suspended').length,
        growthPct: previousNewUsers ? Number((((newUsers - previousNewUsers) / previousNewUsers) * 100).toFixed(1)) : newUsers ? 100 : 0,
      },
      books: {
        total: books.length,
        published: books.filter((book) => book.status === 'published').length,
        drafts: books.filter((book) => book.status === 'draft' || book.status === 'in_review').length,
        trashed: db.books.filter((book) => book.status === 'trashed').length,
        created7d: books.filter((book) => within(book.createdAt, 7)).length,
        published7d: books.filter((book) => book.publishedAt && within(book.publishedAt, 7)).length,
      },
      commerce: {
        sales: completed.length,
        revenue,
        platformFees: Number(fees.toFixed(2)),
        refunds: orders.filter((order) => order.status === 'refunded').length,
        avgOrderValue: completed.length ? Number((revenue / completed.length).toFixed(2)) : 0,
        conversion: views ? Number(((completed.length / views) * 100).toFixed(2)) : 0,
      },
      ai: {
        creditsUsed: aiCredits,
        imageCredits: db.users.reduce((total, user) => total + user.aiImageCreditsUsed, 0),
        requests: db.aiUsage.length * 137,
        topFeature,
      },
      storage: {
        usedBytes,
        quotaBytes,
        largestFile: storageObjects[0]?.label ?? '—',
        largestFileBytes: storageObjects[0]?.sizeBytes ?? 0,
      },
      subscriptions: subscriptionService.adminStats(),
      pending: {
        submissions: submissionRepo.all().filter((submission) => ['submitted', 'in_review'].includes(submission.status)).length,
        reviews: adminRepo.moderationQueue().length,
        reports: adminRepo.reports().filter((report) => report.status === 'open' || report.status === 'investigating').length,
      },
    };
  },
  growthSeries(period: PeriodKey = '90d') {
    const days = period === '30d' ? 30 : period === '7d' ? 7 : period === '1y' ? 365 : period === 'all' ? 720 : 90;
    const bucket = days <= 30 ? 1 : days <= 90 ? 3 : 30;
    const db = getDatabase();
    const points: { date: string; label: string; users: number; books: number; sales: number; revenue: number }[] = [];
    for (let index = Math.ceil(days / bucket) - 1; index >= 0; index -= 1) {
      const bucketEnd = index * bucket;
      const bucketStart = bucketEnd + bucket;
      const date = new Date(Date.now() - bucketEnd * 86400000);
      const inBucket = (iso: string) => {
        const age = (Date.now() - new Date(iso).getTime()) / 86400000;
        return age >= bucketEnd && age < bucketStart;
      };
      points.push({
        date: date.toISOString(),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        users: db.users.filter((user) => inBucket(user.createdAt)).length,
        books: db.books.filter((book) => inBucket(book.createdAt)).length,
        sales: db.orders.filter((order) => order.status === 'completed' && inBucket(order.createdAt)).length,
        revenue: Number(
          db.orders
            .filter((order) => order.status === 'completed' && inBucket(order.createdAt))
            .reduce((total, order) => total + order.amount, 0)
            .toFixed(2),
        ),
      });
    }
    return points;
  },
  // ------------------------------------------------------------------ users
  users(filters: { query?: string; role?: string; status?: string; planId?: ID | 'all'; sort?: 'recent' | 'name' | 'books' | 'revenue' } = {}): (User & { bookCount: number; revenue: number })[] {
    const db = getDatabase();
    let users = db.users.slice();
    if (filters.query) {
      const query = filters.query.toLowerCase();
      users = users.filter(
        (user) =>
          user.name.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query) ||
          user.username.toLowerCase().includes(query),
      );
    }
    if (filters.role && filters.role !== 'all') users = users.filter((user) => user.role === filters.role);
    if (filters.status && filters.status !== 'all') users = users.filter((user) => user.status === filters.status);
    if (filters.planId && filters.planId !== 'all') users = users.filter((user) => user.planId === filters.planId);

    const withStats = users.map((user) => ({
      ...user,
      bookCount: db.books.filter((book) => book.ownerId === user.id && book.status !== 'trashed').length,
      revenue: db.orders
        .filter((order) => order.authorId === user.id && order.status === 'completed')
        .reduce((total, order) => total + order.authorEarnings, 0),
    }));

    switch (filters.sort) {
      case 'name':
        withStats.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'books':
        withStats.sort((a, b) => b.bookCount - a.bookCount);
        break;
      case 'revenue':
        withStats.sort((a, b) => b.revenue - a.revenue);
        break;
      default:
        withStats.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
    }
    return withStats;
  },
  userDetail(userId: ID) {
    const db = getDatabase();
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) return undefined;
    return {
      user,
      plan: db.plans.find((plan) => plan.id === user.planId),
      subscription: db.subscriptions.find((sub) => sub.userId === userId),
      books: db.books.filter((book) => book.ownerId === userId),
      orders: db.orders.filter((order) => order.authorId === userId || order.buyerId === userId),
      assets: db.assets.filter((asset) => asset.ownerId === userId),
      activity: db.activity.filter((item) => item.userId === userId),
      aiUsage: db.aiUsage.filter((record) => record.userId === userId),
      storage: db.storageUsage.find((entry) => entry.userId === userId),
    };
  },
  async updateUser(userId: ID, patch: Partial<User>, actor: { id: ID; name: string }, note?: string) {
    await delay(380);
    const before = userRepo.find(userId);
    const updated = userRepo.update(userId, patch);
    if (before) {
      adminRepo.addAuditLog({
        id: uid('audit'),
        adminId: actor.id,
        adminName: actor.name,
        action: patch.status === 'suspended' ? 'user.suspended' : patch.planId ? 'user.plan_changed' : 'user.updated',
        target: before.name,
        targetType: 'user',
        before: `plan: ${before.planId}, status: ${before.status}`,
        after: `plan: ${updated?.planId}, status: ${updated?.status}${note ? ` — ${note}` : ''}`,
        ip: '10.0.0.1',
        createdAt: new Date().toISOString(),
      });
    }
    return updated;
  },
  async resetUsage(userId: ID, actor: { id: ID; name: string }) {
    await delay(320);
    const updated = userRepo.update(userId, {
      aiCreditsUsed: 0,
      aiImageCreditsUsed: 0,
      storageUsedBytes: 0,
      usagePeriodStart: new Date().toISOString(),
    });
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'user.usage_reset',
      target: userRepo.find(userId)?.name ?? userId,
      targetType: 'user',
      before: 'aiCreditsUsed: >0',
      after: 'aiCreditsUsed: 0',
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  // ------------------------------------------------------------------ books
  books(filters: { query?: string; status?: string; categoryId?: ID | 'all'; featured?: boolean | 'all'; sort?: 'recent' | 'sales' | 'views' | 'rating' } = {}): Book[] {
    let books = getDatabase().books.slice();
    if (filters.query) {
      const query = filters.query.toLowerCase();
      books = books.filter(
        (book) => book.title.toLowerCase().includes(query) || book.authorName.toLowerCase().includes(query) || book.tags.some((tag) => tag.includes(query)),
      );
    }
    if (filters.status && filters.status !== 'all') books = books.filter((book) => book.status === filters.status);
    if (filters.categoryId && filters.categoryId !== 'all') books = books.filter((book) => book.categoryIds.includes(filters.categoryId as string));
    if (filters.featured !== undefined && filters.featured !== 'all') books = books.filter((book) => book.marketplace.featured === filters.featured);

    switch (filters.sort) {
      case 'sales':
        books.sort((a, b) => b.marketplace.sales - a.marketplace.sales);
        break;
      case 'views':
        books.sort((a, b) => b.marketplace.views - a.marketplace.views);
        break;
      case 'rating':
        books.sort((a, b) => b.marketplace.rating - a.marketplace.rating);
        break;
      default:
        books.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    return books;
  },
  async moderateBook(bookId: ID, action: 'feature' | 'unfeature' | 'hide' | 'unpublish' | 'restore' | 'delete' | 'staff-pick' | 'trending', actor: { id: ID; name: string }) {
    await delay(360);
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('Book not found.');
    let patch: Partial<Book> = {};
    switch (action) {
      case 'feature':
        patch = { marketplace: { ...book.marketplace, featured: true } };
        break;
      case 'unfeature':
        patch = { marketplace: { ...book.marketplace, featured: false } };
        break;
      case 'staff-pick':
        patch = { marketplace: { ...book.marketplace, staffPick: !book.marketplace.staffPick } };
        break;
      case 'trending':
        patch = { marketplace: { ...book.marketplace, trending: !book.marketplace.trending } };
        break;
      case 'hide':
        patch = { visibility: 'unlisted', marketplace: { ...book.marketplace, listed: false } };
        break;
      case 'unpublish':
        patch = { status: 'ready', visibility: 'private', marketplace: { ...book.marketplace, listed: false } };
        break;
      case 'restore':
        patch = { status: 'draft', trashedAt: undefined };
        break;
      case 'delete':
        bookRepo.remove(bookId);
        adminRepo.addAuditLog({
          id: uid('audit'),
          adminId: actor.id,
          adminName: actor.name,
          action: 'book.deleted',
          target: book.title,
          targetType: 'book',
          before: `status: ${book.status}`,
          after: 'deleted',
          ip: '10.0.0.1',
          createdAt: new Date().toISOString(),
        });
        return undefined;
      default:
        break;
    }
    const updated = bookRepo.update(bookId, patch);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: `book.${action.replace('-', '_')}`,
      target: book.title,
      targetType: 'book',
      before: `featured: ${book.marketplace.featured}, status: ${book.status}`,
      after: `featured: ${updated?.marketplace.featured}, status: ${updated?.status}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  // ------------------------------------------------------------- moderation
  moderationQueue(): Review[] {
    return adminRepo.moderationQueue();
  },
  async moderateReview(reviewId: ID, action: 'approve' | 'hide' | 'delete' | 'flag' | 'restore', actor: { id: ID; name: string }, note?: string) {
    await delay(300);
    const review = marketplaceRepo.findReview(reviewId);
    if (!review) throw new Error('Review not found.');
    let patch: Partial<Review> = {};
    if (action === 'approve' || action === 'restore') patch = { status: 'published', flagged: false, adminNote: note };
    if (action === 'hide') patch = { status: 'hidden', adminNote: note ?? 'Hidden by moderator.' };
    if (action === 'flag') patch = { flagged: true, adminNote: note ?? 'Flagged for review.' };
    if (action === 'delete') {
      marketplaceRepo.removeReview(reviewId);
    } else {
      adminRepo.updateReview(reviewId, patch);
    }
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: `review.${action}`,
      target: `${review.userName} → ${bookRepo.find(review.bookId)?.title ?? 'book'}`,
      targetType: 'review',
      before: `status: ${review.status}`,
      after: `status: ${patch.status ?? 'deleted'}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
  },
  reports(): Report[] {
    return adminRepo.reports();
  },
  async resolveReport(id: ID, status: Report['status'], note: string, actor: { id: ID; name: string }) {
    await delay(320);
    const updated = adminRepo.updateReport(id, { status, adminNote: note, resolvedAt: status === 'open' ? undefined : new Date().toISOString() });
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: `report.${status}`,
      target: updated?.targetLabel ?? id,
      targetType: 'report',
      before: 'status: open',
      after: `status: ${status}${note ? ` — ${note}` : ''}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  // ------------------------------------------------------------------ plans
  plans(includeInactive = true): Plan[] {
    return userRepo.plans().filter((plan) => includeInactive || plan.active);
  },
  async updatePlan(plan: Plan, actor: { id: ID; name: string }) {
    await delay(340);
    const before = userRepo.plan(plan.id);
    const updated = userRepo.updatePlan(plan.id, plan);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'plan.updated',
      target: plan.name,
      targetType: 'plan',
      before: `priceMonthly: ${before?.priceMonthly}, maxBooks: ${before?.features.maxBooks}`,
      after: `priceMonthly: ${plan.priceMonthly}, maxBooks: ${plan.features.maxBooks}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  async createPlan(plan: Plan, actor: { id: ID; name: string }) {
    await delay(340);
    const created = userRepo.createPlan(plan);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'plan.created',
      target: plan.name,
      targetType: 'plan',
      before: '—',
      after: `priceMonthly: ${plan.priceMonthly}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return created;
  },
  // ------------------------------------------------------------------ flags
  flags(): FeatureFlag[] {
    return adminRepo.flags();
  },
  async toggleFlag(id: ID, enabled: boolean, actor: { id: ID; name: string }) {
    await delay(220);
    const flag = adminRepo.toggleFlag(id, enabled);
    if (flag) {
      adminRepo.addAuditLog({
        id: uid('audit'),
        adminId: actor.id,
        adminName: actor.name,
        action: 'flag.toggled',
        target: flag.name,
        targetType: 'feature_flag',
        before: `enabled: ${!enabled}`,
        after: `enabled: ${enabled}`,
        ip: '10.0.0.1',
        createdAt: new Date().toISOString(),
      });
    }
    return flag;
  },
  updateFlag(id: ID, patch: Partial<FeatureFlag>) {
    return adminRepo.updateFlag(id, patch);
  },
  createFlag(flag: FeatureFlag, actor: { id: ID; name: string }) {
    const created = adminRepo.createFlag(flag);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'flag.created',
      target: flag.name,
      targetType: 'feature_flag',
      before: '—',
      after: `key: ${flag.key}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return created;
  },
  removeFlag(id: ID) {
    adminRepo.removeFlag(id);
  },
  isFlagEnabled(key: string): boolean {
    const flag = adminRepo.findFlag(key);
    return flag ? flag.enabled : true;
  },
  // -------------------------------------------------------------- ai models
  aiModels(): AiModelConfig[] {
    return adminRepo.aiModels();
  },
  updateAiModel(id: ID, patch: Partial<AiModelConfig>) {
    return adminRepo.updateAiModel(id, patch);
  },
  createAiModel(model: AiModelConfig) {
    return adminRepo.createAiModel(model);
  },
  removeAiModel(id: ID) {
    adminRepo.removeAiModel(id);
  },
  // ---------------------------------------------------------------- storage
  storage(): { usage: StorageUsage[]; objects: ReturnType<typeof adminRepo.storageObjects>; totals: { used: number; quota: number; objects: number; largest: number } } {
    const usage = adminRepo.storageUsage();
    const objects = adminRepo.storageObjects();
    return {
      usage,
      objects,
      totals: {
        used: usage.reduce((total, entry) => total + entry.usedBytes, 0),
        quota: usage.reduce((total, entry) => total + entry.quotaBytes, 0),
        objects: objects.length,
        largest: objects[0]?.sizeBytes ?? 0,
      },
    };
  },
  /** Deletes an orphaned storage object and records the cleanup. */
  async removeStorageObject(objectId: ID, actor: { id: ID; name: string }) {
    await delay(320);
    const object = adminRepo.storageObjects().find((entry) => entry.id === objectId);
    adminRepo.removeStorageObject(objectId);
    if (object) {
      adminRepo.addAuditLog({
        id: uid('audit'),
        adminId: actor.id,
        adminName: actor.name,
        action: 'storage.object_deleted',
        target: object.key,
        targetType: object.kind,
        before: `${object.sizeBytes} bytes`,
        after: 'deleted',
        ip: '10.0.0.1',
        createdAt: new Date().toISOString(),
      });
    }
    return object;
  },
  /** Recomputes per-user storage from the object store — the cleanup routine. */
  async reconcileStorage(actor: { id: ID; name: string }) {
    await delay(700);
    const db = getDatabase();
    const rows = userRepo.all();
    rows.forEach((user) => {
      const used = db.storageObjects.filter((object) => object.ownerId === user.id).reduce((total, object) => total + object.sizeBytes, 0);
      userRepo.update(user.id, { storageUsedBytes: used });
    });
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'storage.reconciled',
      target: `${rows.length} accounts`,
      targetType: 'storage',
      before: 'drift detected',
      after: 'usage recomputed',
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return rows.length;
  },

  // --------------------------------------------------------------- settings
  settings(): AdminSettings {
    return adminRepo.settings();
  },
  async updateSettings<K extends keyof AdminSettings>(section: K, patch: Partial<AdminSettings[K]>, actor: { id: ID; name: string }) {
    await delay(360);
    const before = adminRepo.settings()[section];
    const updated = adminRepo.updateSettings(section, patch);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'settings.updated',
      target: section,
      targetType: 'settings',
      before: JSON.stringify(before).slice(0, 120),
      after: JSON.stringify(updated[section]).slice(0, 120),
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  async setMaintenance(enabled: boolean, message: string, actor: { id: ID; name: string }) {
    await delay(300);
    const updated = adminRepo.setMaintenanceMode(enabled, message);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: enabled ? 'platform.maintenance_on' : 'platform.maintenance_off',
      target: 'platform',
      targetType: 'settings',
      before: `maintenanceMode: ${!enabled}`,
      after: `maintenanceMode: ${enabled}`,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  // -------------------------------------------------------------- audit logs
  auditLogs(filters: { query?: string; action?: string; adminId?: ID | 'all' } = {}): AuditLog[] {
    let logs = adminRepo.auditLogs();
    if (filters.query) {
      const query = filters.query.toLowerCase();
      logs = logs.filter((log) => log.action.toLowerCase().includes(query) || log.target.toLowerCase().includes(query) || log.adminName.toLowerCase().includes(query));
    }
    if (filters.action && filters.action !== 'all') logs = logs.filter((log) => log.action.startsWith(filters.action as string));
    if (filters.adminId && filters.adminId !== 'all') logs = logs.filter((log) => log.adminId === filters.adminId);
    return logs;
  },
  clearAuditLogs(actor: { id: ID; name: string }) {
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'audit.cleared',
      target: 'audit log',
      targetType: 'system',
      before: 'entries: 68',
      after: 'entries: 0',
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    adminRepo.clearAuditLogs();
  },
  // ----------------------------------------------------------- cms shortcuts
  cms() {
    return {
      sections: cmsRepo.sections('home'),
      pages: cmsRepo.pages(),
      faqs: cmsRepo.faqs(false),
      testimonials: cmsRepo.testimonials(false),
      promos: cmsRepo.promos(false),
      posts: cmsRepo.posts(true),
      nav: cmsRepo.allNav(),
      footer: cmsRepo.footer(),
      theme: cmsRepo.theme(),
    };
  },
  revenueByPeriod(period: PeriodKey = '30d') {
    return revenueService.timeseries('user_demo', period, 'revenue');
  },

  // ---------------------------------------------------- orders & revenue
  /** Every order on the platform, joined with buyer, author and book. */
  orders(filters: { query?: string; status?: string; method?: string; sort?: 'recent' | 'amount' | 'fee' } = {}) {
    const db = getDatabase();
    let list = marketplaceRepo.orders().slice();
    if (filters.query) {
      const needle = filters.query.toLowerCase();
      list = list.filter((order) => `${order.number} ${order.bookTitle} ${order.buyerName} ${order.authorName}`.toLowerCase().includes(needle));
    }
    if (filters.status && filters.status !== 'all') list = list.filter((order) => order.status === filters.status);
    if (filters.method && filters.method !== 'all') list = list.filter((order) => order.method === filters.method);
    if (filters.sort === 'amount') list.sort((a, b) => b.amount - a.amount);
    else if (filters.sort === 'fee') list.sort((a, b) => b.platformFee - a.platformFee);
    else list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list.map((order) => ({
      ...order,
      buyerEmail: db.users.find((user) => user.id === order.buyerId)?.email ?? '',
    }));
  },
  /** Refunds an order, records the audit entry and notifies the buyer. */
  async refundOrder(orderId: ID, reason: string, actor: { id: ID; name: string }) {
    const before = marketplaceRepo.orders().find((order) => order.id === orderId);
    const updated = await revenueService.refundOrder(orderId, reason, actor.id);
    if (before) {
      adminRepo.addAuditLog({
        id: uid('audit'),
        adminId: actor.id,
        adminName: actor.name,
        action: 'order.refunded',
        target: before.number,
        targetType: 'order',
        before: `${before.status} · ${before.amount}`,
        after: `refunded — ${reason}`,
        ip: '10.0.0.1',
        createdAt: new Date().toISOString(),
      });
    }
    return updated;
  },
  /** Revenue totals per day for the admin charts. */
  revenueSeries(period: PeriodKey = '30d') {
    const days = revenueService.periods.find((entry) => entry.key === period)?.days ?? 30;
    const bucket = days <= 30 ? 1 : days <= 90 ? 3 : 30;
    const orders = marketplaceRepo.orders().filter((order) => Date.now() - new Date(order.createdAt).getTime() <= days * 86400000);
    const points: { date: string; label: string; revenue: number; fees: number; refunds: number; orders: number }[] = [];
    for (let index = Math.ceil(days / bucket) - 1; index >= 0; index -= 1) {
      const bucketEnd = index * bucket;
      const bucketStart = bucketEnd + bucket;
      const date = new Date(Date.now() - bucketEnd * 86400000);
      const belongs = (iso: string) => {
        const age = (Date.now() - new Date(iso).getTime()) / 86400000;
        return age >= bucketEnd && age < bucketStart;
      };
      const inBucket = orders.filter((order) => belongs(order.createdAt));
      points.push({
        date: date.toISOString(),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        revenue: Number(inBucket.filter((order) => order.status === 'completed').reduce((total, order) => total + order.amount, 0).toFixed(2)),
        fees: Number(inBucket.filter((order) => order.status === 'completed').reduce((total, order) => total + order.platformFee, 0).toFixed(2)),
        refunds: Number(inBucket.filter((order) => order.status === 'refunded').reduce((total, order) => total + order.amount, 0).toFixed(2)),
        orders: inBucket.length,
      });
    }
    return points;
  },
  /** Payout requests raised by authors, newest first. */
  payoutQueue() {
    const db = getDatabase();
    return activityRepo
      .all()
      .filter((item) => item.meta?.startsWith('payout:'))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => {
        const user = db.users.find((entry) => entry.id === item.userId);
        return {
          id: item.id,
          userId: item.userId,
          userName: user?.name ?? 'Unknown author',
          email: user?.email ?? '',
          amount: Number((item.meta ?? 'payout:0').split(':')[1] ?? 0),
          method: user?.payoutMethod?.label ?? 'Bank transfer',
          requestedAt: item.createdAt,
          status: item.message.toLowerCase().includes('paid') ? ('paid' as const) : ('pending' as const),
        };
      });
  },
  /** Marks a payout as paid. */
  markPayoutPaid(activityId: ID, actor: { id: ID; name: string }, action: 'approve' | 'reject' = 'approve') {
    const entry = activityRepo.all().find((item) => item.id === activityId);
    if (!entry) return undefined;
    const updated = activityRepo.update(activityId, {
      message: action === 'approve' ? `${entry.message} — paid by ${actor.name}` : `${entry.message} — rejected by ${actor.name}`,
    });
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: action === 'approve' ? 'payout.approved' : 'payout.rejected',
      target: entry.userId,
      targetType: 'payout',
      before: 'pending',
      after: action,
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return updated;
  },
  /** Platform-wide payout + commission summary. */
  revenueSummary(period: PeriodKey = '30d') {
    const days = revenueService.periods.find((entry) => entry.key === period)?.days ?? 30;
    const orders = marketplaceRepo.orders().filter((order) => Date.now() - new Date(order.createdAt).getTime() <= days * 86400000);
    const completed = orders.filter((order) => order.status === 'completed');
    const refunded = orders.filter((order) => order.status === 'refunded');
    const byMethod = ['card', 'paypal', 'apple-pay', 'credits'].map((method) => ({
      method,
      orders: orders.filter((order) => order.method === method).length,
      revenue: Number(orders.filter((order) => order.method === method && order.status === 'completed').reduce((total, order) => total + order.amount, 0).toFixed(2)),
    }));
    return {
      gross: Number(completed.reduce((total, order) => total + order.amount, 0).toFixed(2)),
      fees: Number(completed.reduce((total, order) => total + order.platformFee, 0).toFixed(2)),
      authorEarnings: Number(completed.reduce((total, order) => total + order.authorEarnings, 0).toFixed(2)),
      refunds: Number(refunded.reduce((total, order) => total + order.amount, 0).toFixed(2)),
      orders: orders.length,
      conversion: orders.length > 0 ? Number(((completed.length / orders.length) * 100).toFixed(1)) : 0,
      byMethod,
      topCountries: Object.entries(
        completed.reduce<Record<string, number>>((accumulator, order) => {
          accumulator[order.country] = (accumulator[order.country] ?? 0) + order.amount;
          return accumulator;
        }, {}),
      )
        .map(([country, revenue]) => ({ country, revenue: Number(revenue.toFixed(2)) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
    };
  },
  adminUsersList() {
    return getDatabase().users.filter((user) => user.role === 'admin' || user.role === 'moderator');
  },
};
