import type {
  AdminSettings,
  AiModelConfig,
  AuditLog,
  BlogPost,
  CmsPage,
  CmsSection,
  FaqItem,
  FeatureFlag,
  ID,
  Plan,
  Promo,
  Report,
  Review,
  StorageObject,
  StorageUsage,
  Testimonial,
} from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export const adminRepo = {
  settings(): AdminSettings {
    return getDatabase().adminSettings;
  },
  updateSettings<K extends keyof AdminSettings>(section: K, patch: Partial<AdminSettings[K]>): AdminSettings {
    return mutateDatabase((db) => {
      db.adminSettings = {
        ...db.adminSettings,
        [section]: { ...db.adminSettings[section], ...patch },
      };
      return db.adminSettings;
    });
  },
  setMaintenanceMode(enabled: boolean, message?: string) {
    return mutateDatabase((db) => {
      db.adminSettings = {
        ...db.adminSettings,
        general: {
          ...db.adminSettings.general,
          maintenanceMode: enabled,
          maintenanceMessage: message ?? db.adminSettings.general.maintenanceMessage,
        },
      };
      return db.adminSettings;
    });
  },
  // ------------------------------------------------------------ audit logs
  auditLogs(): AuditLog[] {
    return getDatabase()
      .auditLogs.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  addAuditLog(log: Omit<AuditLog, 'id'> & { id?: ID }): AuditLog {
    return mutateDatabase((db) => {
      const entry: AuditLog = { ...log, id: log.id ?? `audit_${db.auditLogs.length + 1}` };
      db.auditLogs = [entry, ...db.auditLogs];
      return entry;
    });
  },
  clearAuditLogs() {
    return mutateDatabase((db) => {
      db.auditLogs = [];
    });
  },
  // --------------------------------------------------------------- reports
  reports(): Report[] {
    return getDatabase()
      .reports.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  createReport(report: Report): Report {
    return mutateDatabase((db) => {
      db.reports = [report, ...db.reports];
      return report;
    });
  },
  updateReport(id: ID, patch: Partial<Report>): Report | undefined {
    return mutateDatabase((db) => {
      const index = db.reports.findIndex((report) => report.id === id);
      if (index === -1) return undefined;
      db.reports[index] = { ...db.reports[index], ...patch };
      return db.reports[index];
    });
  },
  // ---------------------------------------------------------- feature flags
  flags(): FeatureFlag[] {
    return getDatabase()
      .flags.slice()
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
  findFlag(key: string): FeatureFlag | undefined {
    return getDatabase().flags.find((flag) => flag.key === key);
  },
  toggleFlag(id: ID, enabled: boolean): FeatureFlag | undefined {
    return mutateDatabase((db) => {
      const index = db.flags.findIndex((flag) => flag.id === id);
      if (index === -1) return undefined;
      db.flags[index] = { ...db.flags[index], enabled, updatedAt: new Date().toISOString() };
      return db.flags[index];
    });
  },
  updateFlag(id: ID, patch: Partial<FeatureFlag>): FeatureFlag | undefined {
    return mutateDatabase((db) => {
      const index = db.flags.findIndex((flag) => flag.id === id);
      if (index === -1) return undefined;
      db.flags[index] = { ...db.flags[index], ...patch, updatedAt: new Date().toISOString() };
      return db.flags[index];
    });
  },
  createFlag(flag: FeatureFlag): FeatureFlag {
    return mutateDatabase((db) => {
      db.flags = [...db.flags, flag];
      return flag;
    });
  },
  removeFlag(id: ID) {
    return mutateDatabase((db) => {
      db.flags = db.flags.filter((flag) => flag.id !== id);
    });
  },
  // -------------------------------------------------------------- ai models
  aiModels(): AiModelConfig[] {
    return getDatabase().aiModels;
  },
  updateAiModel(id: ID, patch: Partial<AiModelConfig>): AiModelConfig | undefined {
    return mutateDatabase((db) => {
      const index = db.aiModels.findIndex((model) => model.id === id);
      if (index === -1) return undefined;
      db.aiModels[index] = { ...db.aiModels[index], ...patch };
      return db.aiModels[index];
    });
  },
  createAiModel(model: AiModelConfig): AiModelConfig {
    return mutateDatabase((db) => {
      db.aiModels = [...db.aiModels, model];
      return model;
    });
  },
  removeAiModel(id: ID) {
    return mutateDatabase((db) => {
      db.aiModels = db.aiModels.filter((model) => model.id !== id);
    });
  },
  // ---------------------------------------------------------------- storage
  storageUsage(): StorageUsage[] {
    return getDatabase()
      .storageUsage.slice()
      .sort((a, b) => b.usedBytes - a.usedBytes);
  },
  storageObjects(): StorageObject[] {
    return getDatabase()
      .storageObjects.slice()
      .sort((a, b) => b.sizeBytes - a.sizeBytes);
  },
  removeStorageObject(id: ID) {
    return mutateDatabase((db) => {
      db.storageObjects = db.storageObjects.filter((object) => object.id !== id);
    });
  },
  // ------------------------------------------------------- moderation tools
  moderationQueue(): Review[] {
    return getDatabase()
      .reviews.filter((review) => review.status !== 'published' || review.flagged)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  updateReview(id: ID, patch: Partial<Review>) {
    return mutateDatabase((db) => {
      const index = db.reviews.findIndex((review) => review.id === id);
      if (index === -1) return undefined;
      db.reviews[index] = { ...db.reviews[index], ...patch };
      return db.reviews[index];
    });
  },
  removeReview(id: ID) {
    return mutateDatabase((db) => {
      db.reviews = db.reviews.filter((review) => review.id !== id);
    });
  },
  // ---------------------------------------------------------------- content
  updatePlanInline(plan: Plan): Plan {
    return mutateDatabase((db) => {
      const index = db.plans.findIndex((entry) => entry.id === plan.id);
      if (index >= 0) db.plans[index] = plan;
      return plan;
    });
  },
  updateCmsPage(id: ID, patch: Partial<CmsPage>) {
    return mutateDatabase((db) => {
      const index = db.cmsPages.findIndex((page) => page.id === id);
      if (index >= 0) db.cmsPages[index] = { ...db.cmsPages[index], ...patch, updatedAt: new Date().toISOString() };
      return db.cmsPages[index];
    });
  },
  updateCmsSection(id: ID, patch: Partial<CmsSection>) {
    return mutateDatabase((db) => {
      const index = db.homeSections.findIndex((section) => section.id === id);
      if (index >= 0) db.homeSections[index] = { ...db.homeSections[index], ...patch };
      return db.homeSections[index];
    });
  },
  updateTestimonial(id: ID, patch: Partial<Testimonial>) {
    return mutateDatabase((db) => {
      const index = db.testimonials.findIndex((item) => item.id === id);
      if (index >= 0) db.testimonials[index] = { ...db.testimonials[index], ...patch };
      return db.testimonials[index];
    });
  },
  updateFaq(id: ID, patch: Partial<FaqItem>) {
    return mutateDatabase((db) => {
      const index = db.faqs.findIndex((item) => item.id === id);
      if (index >= 0) db.faqs[index] = { ...db.faqs[index], ...patch };
      return db.faqs[index];
    });
  },
  updatePromo(id: ID, patch: Partial<Promo>) {
    return mutateDatabase((db) => {
      const index = db.promos.findIndex((item) => item.id === id);
      if (index >= 0) db.promos[index] = { ...db.promos[index], ...patch };
      return db.promos[index];
    });
  },
  updatePost(id: ID, patch: Partial<BlogPost>) {
    return mutateDatabase((db) => {
      const index = db.blogPosts.findIndex((item) => item.id === id);
      if (index >= 0) db.blogPosts[index] = { ...db.blogPosts[index], ...patch };
      return db.blogPosts[index];
    });
  },
};
