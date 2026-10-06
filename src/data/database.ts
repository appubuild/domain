import type {
  ActivityItem,
  AdminSettings,
  AiModelConfig,
  AiUsageRecord,
  AppNotification,
  Asset,
  AuditLog,
  AuthorProfile,
  BlogPost,
  Book,
  BookNote,
  BookViewEvent,
  Category,
  CmsPage,
  CmsSection,
  Collaborator,
  Comment,
  EmailEvent,
  ExportJob,
  FaqItem,
  FeatureFlag,
  FooterConfig,
  Invoice,
  LibraryItem,
  MemoryEntry,
  NavItem,
  Order,
  Plan,
  Promo,
  PublishingSubmission,
  Report,
  Review,
  SiteTheme,
  StorageObject,
  StorageUsage,
  Subscription,
  Tag,
  Template,
  Testimonial,
  User,
  VersionEntry,
  WishlistItem,
} from '@/types/domain';
import { recalculateBook } from './bookFactory';
import { seedPlans } from './seedPlans';
import { seedAdminSettings, seedAiModels, seedAuditLogs, seedCategories, seedFlags, seedReports, seedTags, seedTheme } from './seedCatalog';
import { defaultSettings, seedAuthorProfiles, seedUsers } from './seedPeople';
import { seedTemplates } from './seedTemplates';
import { buildDemoBooks, buildLibrary, buildOrders, buildReviews, buildWishlist, seedMarketBooks } from './seedBooks';
import { seedAssets } from './seedAssets';
import {
  buildViewEvents,
  seedActivity,
  seedAiUsage,
  seedBookNotes,
  seedCollaborators,
  seedComments,
  seedEmailEvents,
  seedExports,
  seedInvoices,
  seedMemory,
  seedNotifications,
  seedStorageObjects,
  seedStorageUsage,
  seedSubmissionOrder,
  seedSubmissions,
  seedSubscription,
} from './seedOps';
import { seedBlogPosts, seedCmsPages, seedFaqs, seedFooter, seedHomeSections, seedNavItems, seedPromos, seedTestimonials } from './seedCms';

export const SEED_VERSION = 7;

export interface Database {
  version: number;
  users: User[];
  plans: Plan[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  categories: Category[];
  tags: Tag[];
  templates: Template[];
  books: Book[];
  reviews: Review[];
  orders: Order[];
  wishlist: WishlistItem[];
  library: LibraryItem[];
  viewEvents: BookViewEvent[];
  notifications: AppNotification[];
  emailEvents: EmailEvent[];
  exports: ExportJob[];
  submissions: PublishingSubmission[];
  comments: Comment[];
  collaborators: Collaborator[];
  notes: BookNote[];
  memory: MemoryEntry[];
  versions: VersionEntry[];
  assets: Asset[];
  aiUsage: AiUsageRecord[];
  activity: ActivityItem[];
  auditLogs: AuditLog[];
  reports: Report[];
  flags: FeatureFlag[];
  aiModels: AiModelConfig[];
  storageUsage: StorageUsage[];
  storageObjects: StorageObject[];
  adminSettings: AdminSettings;
  theme: SiteTheme;
  cmsPages: CmsPage[];
  homeSections: CmsSection[];
  testimonials: Testimonial[];
  faqs: FaqItem[];
  promos: Promo[];
  blogPosts: BlogPost[];
  navItems: NavItem[];
  footer: FooterConfig;
  authorProfiles: AuthorProfile[];
}

function buildVersions(books: Book[], userId: string, userName: string): VersionEntry[] {
  const entries: VersionEntry[] = [];
  books.forEach((book, bookIndex) => {
    const labels: { label: string; detail: string; hours: number; kind: VersionEntry['kind'] }[] = [
      { label: 'Chapter content updated', detail: 'Chapter 3 — 412 words added, 38 removed', hours: 4, kind: 'autosave' },
      { label: 'Cover changed', detail: 'Cover background and title typography adjusted', hours: 26, kind: 'manual' },
      { label: 'Pages added', detail: '12 pages added to Back Matter', hours: 52, kind: 'manual' },
      { label: 'Chapter 4 updated', detail: 'Structural edit — scene order changed', hours: 96, kind: 'manual' },
      { label: 'Preflight run', detail: '0 errors, 2 warnings after margin corrections', hours: 120, kind: 'milestone' },
      { label: 'Version checkpoint', detail: 'Marked ready for editorial review', hours: 200, kind: 'milestone' },
      { label: 'Chapter 2 rewritten', detail: 'Narration changed from past to present tense in two scenes', hours: 320, kind: 'manual' },
      { label: 'Import', detail: 'Manuscript imported from DOCX — 214 pages', hours: 480, kind: 'milestone' },
    ];
    labels.forEach((entry, index) => {
      entries.push({
        id: `ver_${book.id}_${index}`,
        bookId: book.id,
        userId,
        userName,
        label: entry.label,
        detail: entry.detail,
        createdAt: new Date(Date.now() - (entry.hours + bookIndex * 3) * 3600 * 1000).toISOString(),
        kind: entry.kind,
        snapshot: {
          title: book.title,
          pageCount: Math.max(1, book.pageCount - index),
          wordCount: Math.max(200, book.wordCount - index * 137),
          sections: JSON.parse(JSON.stringify(book.sections)),
          pages: JSON.parse(JSON.stringify(book.pages)),
          cover: JSON.parse(JSON.stringify(book.cover)),
        },
      });
    });
  });
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function buildSeedDatabase(): Database {
  const marketBooks = seedMarketBooks;
  const demoBooks = buildDemoBooks();
  const books = [...marketBooks, ...demoBooks].map((book) => recalculateBook(book));

  const extraSubscriptions: Subscription[] = [
    { id: 'sub_harriet', userId: 'user_harriet', planId: 'plan_business', status: 'active', interval: 'yearly', startedAt: new Date(Date.now() - 140 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 225 * 86400000).toISOString(), seats: 3 },
    { id: 'sub_theo', userId: 'user_theo', planId: 'plan_pro', status: 'past_due', interval: 'monthly', startedAt: new Date(Date.now() - 96 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 24 * 86400000).toISOString(), seats: 1 },
    { id: 'sub_grace', userId: 'user_gracet', planId: 'plan_pro', status: 'active', interval: 'monthly', startedAt: new Date(Date.now() - 19 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 11 * 86400000).toISOString(), seats: 1 },
    { id: 'sub_elena', userId: 'user_elenav', planId: 'plan_pro', status: 'active', interval: 'yearly', startedAt: new Date(Date.now() - 300 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 65 * 86400000).toISOString(), seats: 1 },
    { id: 'sub_marcus', userId: 'user_marcus', planId: 'plan_business', status: 'active', interval: 'yearly', startedAt: new Date(Date.now() - 210 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 155 * 86400000).toISOString(), seats: 5 },
    { id: 'sub_clara', userId: 'user_clara', planId: 'plan_business', status: 'active', interval: 'monthly', startedAt: new Date(Date.now() - 90 * 86400000).toISOString(), renewsAt: new Date(Date.now() + 8 * 86400000).toISOString(), seats: 2 },
  ];

  return {
    version: SEED_VERSION,
    users: seedUsers,
    plans: seedPlans,
    subscriptions: [seedSubscription, ...extraSubscriptions],
    invoices: seedInvoices,
    categories: seedCategories,
    tags: seedTags,
    templates: seedTemplates,
    books,
    reviews: buildReviews(),
    orders: buildOrders(),
    wishlist: buildWishlist(),
    library: buildLibrary(),
    viewEvents: buildViewEvents(),
    notifications: seedNotifications,
    emailEvents: seedEmailEvents,
    exports: seedExports,
    submissions: [...seedSubmissions, seedSubmissionOrder],
    comments: seedComments,
    collaborators: seedCollaborators,
    notes: seedBookNotes,
    memory: seedMemory,
    versions: buildVersions(demoBooks, 'user_demo', 'Maya Chen'),
    assets: seedAssets,
    aiUsage: seedAiUsage,
    activity: seedActivity,
    auditLogs: seedAuditLogs,
    reports: seedReports,
    flags: seedFlags,
    aiModels: seedAiModels,
    storageUsage: seedStorageUsage,
    storageObjects: seedStorageObjects,
    adminSettings: seedAdminSettings,
    theme: seedTheme,
    cmsPages: seedCmsPages,
    homeSections: seedHomeSections,
    testimonials: seedTestimonials,
    faqs: seedFaqs,
    promos: seedPromos,
    blogPosts: seedBlogPosts,
    navItems: seedNavItems,
    footer: seedFooter,
    authorProfiles: seedAuthorProfiles,
  };
}

export { defaultSettings };
