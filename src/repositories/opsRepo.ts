import type {
  ActivityItem,
  AiUsageRecord,
  AppNotification,
  Asset,
  EmailEvent,
  ExportJob,
  ID,
  PublishingSubmission,
} from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export const notificationRepo = {
  forUser(userId: ID): AppNotification[] {
    return getDatabase()
      .notifications.filter((notification) => notification.userId === userId || notification.userId === 'user_demo')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  add(notification: AppNotification): AppNotification {
    return mutateDatabase((db) => {
      db.notifications = [notification, ...db.notifications];
      return notification;
    });
  },
  markRead(id: ID, read = true) {
    return mutateDatabase((db) => {
      const index = db.notifications.findIndex((notification) => notification.id === id);
      if (index >= 0) db.notifications[index] = { ...db.notifications[index], read };
    });
  },
  markAllRead(userId: ID) {
    return mutateDatabase((db) => {
      db.notifications = db.notifications.map((notification) =>
        notification.userId === userId ? { ...notification, read: true } : notification,
      );
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      db.notifications = db.notifications.filter((notification) => notification.id !== id);
    });
  },
  clearAll(userId: ID) {
    return mutateDatabase((db) => {
      db.notifications = db.notifications.filter((notification) => notification.userId !== userId);
    });
  },
};

export const emailRepo = {
  all(): EmailEvent[] {
    return getDatabase()
      .emailEvents.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  queue(event: EmailEvent): EmailEvent {
    return mutateDatabase((db) => {
      db.emailEvents = [event, ...db.emailEvents];
      return event;
    });
  },
  update(id: ID, patch: Partial<EmailEvent>) {
    return mutateDatabase((db) => {
      const index = db.emailEvents.findIndex((event) => event.id === id);
      if (index >= 0) db.emailEvents[index] = { ...db.emailEvents[index], ...patch };
      return db.emailEvents[index];
    });
  },
};

export const exportRepo = {
  all(userId?: ID, bookId?: ID): ExportJob[] {
    let jobs = getDatabase().exports.slice();
    if (userId) jobs = jobs.filter((job) => job.userId === userId);
    if (bookId) jobs = jobs.filter((job) => job.bookId === bookId);
    return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  find(id: ID): ExportJob | undefined {
    return getDatabase().exports.find((job) => job.id === id);
  },
  create(job: ExportJob): ExportJob {
    return mutateDatabase((db) => {
      db.exports = [job, ...db.exports];
      return job;
    });
  },
  update(id: ID, patch: Partial<ExportJob>): ExportJob | undefined {
    return mutateDatabase((db) => {
      const index = db.exports.findIndex((job) => job.id === id);
      if (index === -1) return undefined;
      db.exports[index] = { ...db.exports[index], ...patch };
      return db.exports[index];
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      db.exports = db.exports.filter((job) => job.id !== id);
    });
  },
};

export const submissionRepo = {
  all(): PublishingSubmission[] {
    return getDatabase()
      .submissions.slice()
      .sort((a, b) => ((b.submittedAt ?? '') < (a.submittedAt ?? '') ? 1 : -1));
  },
  byAuthor(authorId: ID): PublishingSubmission[] {
    return submissionRepo.all().filter((submission) => submission.authorId === authorId);
  },
  forBook(bookId: ID): PublishingSubmission | undefined {
    return getDatabase().submissions.find((submission) => submission.bookId === bookId);
  },
  upsert(submission: PublishingSubmission): PublishingSubmission {
    return mutateDatabase((db) => {
      const index = db.submissions.findIndex((entry) => entry.bookId === submission.bookId);
      if (index === -1) db.submissions = [submission, ...db.submissions];
      else db.submissions[index] = submission;
      return submission;
    });
  },
  update(id: ID, patch: Partial<PublishingSubmission>): PublishingSubmission | undefined {
    return mutateDatabase((db) => {
      const index = db.submissions.findIndex((submission) => submission.id === id);
      if (index === -1) return undefined;
      db.submissions[index] = { ...db.submissions[index], ...patch };
      return db.submissions[index];
    });
  },
};

export const assetRepo = {
  forUser(userId: ID): Asset[] {
    return getDatabase()
      .assets.filter((asset) => asset.ownerId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  all(): Asset[] {
    return getDatabase().assets;
  },
  find(id: ID): Asset | undefined {
    return getDatabase().assets.find((asset) => asset.id === id);
  },
  create(asset: Asset): Asset {
    return mutateDatabase((db) => {
      db.assets = [asset, ...db.assets];
      const user = db.users.find((entry) => entry.id === asset.ownerId);
      if (user) user.storageUsedBytes += asset.sizeBytes;
      return asset;
    });
  },
  update(id: ID, patch: Partial<Asset>): Asset | undefined {
    return mutateDatabase((db) => {
      const index = db.assets.findIndex((asset) => asset.id === id);
      if (index === -1) return undefined;
      db.assets[index] = { ...db.assets[index], ...patch };
      return db.assets[index];
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      const asset = db.assets.find((entry) => entry.id === id);
      db.assets = db.assets.filter((entry) => entry.id !== id);
      if (asset) {
        const user = db.users.find((entry) => entry.id === asset.ownerId);
        if (user) user.storageUsedBytes = Math.max(0, user.storageUsedBytes - asset.sizeBytes);
      }
    });
  },
  folders(userId: ID): string[] {
    const folders = new Set(assetRepo.forUser(userId).map((asset) => asset.folder));
    return ['All', ...Array.from(folders).sort()];
  },
};

export const aiRepo = {
  usage(userId?: ID): AiUsageRecord[] {
    const usage = getDatabase().aiUsage;
    return (userId ? usage.filter((record) => record.userId === userId) : usage).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  record(entry: AiUsageRecord) {
    return mutateDatabase((db) => {
      db.aiUsage = [entry, ...db.aiUsage].slice(0, 500);
      const user = db.users.find((person) => person.id === entry.userId);
      if (user) user.aiCreditsUsed += entry.credits;
      return entry;
    });
  },
};

export const activityRepo = {
  forUser(userId: ID): ActivityItem[] {
    return getDatabase()
      .activity.filter((item) => item.userId === userId || item.userId === 'user_demo')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  add(item: ActivityItem): ActivityItem {
    return mutateDatabase((db) => {
      db.activity = [item, ...db.activity].slice(0, 200);
      return item;
    });
  },
};
