/** Thin read-only wrappers so hooks stay declarative and services stay the only business layer. */
import {
  adminService,
  analyticsService,
  bookService,
  cmsService,
  exportService,
  marketplaceService,
  preflightService,
  publishingService,
  searchService,
  subscriptionService,
  templateService,
  emailService,
  notificationService,
  storageService,
  aiService,
  revenueService,
} from '@/services';
import { activityRepo, aiRepo, assetRepo } from '@/repositories';
import type { MarketplaceFilters, PublishingProfileId } from '@/types/domain';
import type { BookListFilters } from '@/repositories';
import type { PeriodKey } from '@/services/revenueService';

export const BookFns = {
  list: (filters: BookListFilters) => bookService.list(filters),
  get: (id?: string) => bookService.get(id),
  counts: (userId: string) => bookService.counts(userId),
  comments: (bookId: string) => bookService.comments(bookId),
  collaborators: (bookId: string) => bookService.collaborators(bookId),
  notes: (bookId: string) => bookService.notes(bookId),
  memory: (bookId: string) => bookService.memory(bookId),
  versions: (bookId: string) => bookService.versions(bookId),
};

export const TemplateFns = {
  list: (filters: Parameters<typeof templateService.list>[0]) => templateService.list(filters),
  get: (id?: string) => templateService.get(id),
  categoryCounts: () => templateService.categoryCounts(),
};

export const MarketFns = {
  browse: (filters: MarketplaceFilters) => marketplaceService.browse(filters),
  sections: () => ({
    featured: marketplaceService.featured(),
    trending: marketplaceService.trending(),
    newReleases: marketplaceService.newReleases(),
    bestSellers: marketplaceService.bestSellers(),
    staffPicks: marketplaceService.staffPicks(),
    free: marketplaceService.free(),
    premium: marketplaceService.premium(),
  }),
  reviews: (bookId: string) => marketplaceService.reviews(bookId),
  reviewSummary: (bookId: string) => marketplaceService.reviewSummary(bookId),
  wishlist: (userId: string) => marketplaceService.wishlist(userId),
  library: (userId: string) => marketplaceService.library(userId),
  orders: (userId?: string) => marketplaceService.orders(userId),
  revenueSummary: (userId: string, period: PeriodKey) => analyticsService.authorSummary(userId, period),
  revenueSeries: (userId: string, period: PeriodKey, metric: 'revenue' | 'sales' | 'views') => revenueService.timeseries(userId, period, metric),
  revenueByBook: (userId: string, period: PeriodKey) => analyticsService.bookBreakdown(userId, period),
  analytics: (userId: string, period: PeriodKey) => ({
    summary: analyticsService.authorSummary(userId, period),
    books: analyticsService.bookBreakdown(userId, period),
    sources: analyticsService.trafficSources(userId),
  }),
};

export const OpsFns = {
  notifications: (userId: string) => notificationService.list(userId),
  activity: (userId: string) => activityRepo.forUser(userId),
  assets: (userId: string) => assetRepo.forUser(userId),
  exports: (userId?: string, bookId?: string) => exportService.history(userId, bookId),
  exportJob: (id: string) => exportService.find(id),
  submissions: (authorId?: string) => (authorId ? publishingService.submissionsForAuthor(authorId) : publishingService.allSubmissions()),
  submission: (bookId: string) => publishingService.submissionFor(bookId),
  allSubmissions: () => publishingService.allSubmissions(),
  plans: () => subscriptionService.plans(),
  subscription: (userId: string) => subscriptionService.current(userId),
  invoices: (userId: string) => subscriptionService.invoices(userId),
  emails: () => emailService.list(),
  authors: () => searchService.authors(),
  author: (id?: string) => (id ? searchService.authorProfile(id) : undefined),
  categories: (kind?: string) => searchService.categories(),
  search: (query: string) => searchService.search(query),
  preflight: (bookId: string, profileId: PublishingProfileId) => preflightService.run(bookId, profileId),
  aiUsage: (userId?: string) => aiRepo.usage(userId),
  publishingChecklist: (bookId: string) => ({
    ...publishingService.completion(bookId),
    submission: publishingService.submissionFor(bookId),
  }),
  storageObjects: (userId?: string) => storageService.objects(userId),
  aiModels: () => aiService.creditCost('continue'),
};

export const CmsFns = {
  homepage: () => cmsService.homepage(),
  section: (key: string) => cmsService.section(key),
  pages: () => cmsService.pages(),
  page: (slug?: string) => (slug ? cmsService.page(slug) : undefined),
  posts: (drafts: boolean) => cmsService.postList(drafts),
  post: (slug?: string) => (slug ? cmsService.post(slug) : undefined),
  promos: (activeOnly: boolean) => cmsService.promos(activeOnly),
  faqs: () => cmsService.faqs(),
  nav: (location: 'header' | 'footer-product' | 'footer-resources' | 'footer-company' | 'footer-legal') => cmsService.nav(location),
  footer: () => cmsService.footer(),
  theme: () => cmsService.theme(),
};

export const AdminFns = {
  overview: () => adminService.overview(),
  growth: (period?: string) => adminService.growthSeries((period as PeriodKey) ?? '90d'),
  users: (filters: Parameters<typeof adminService.users>[0]) => adminService.users(filters),
  user: (id?: string) => (id ? adminService.userDetail(id) : undefined),
  books: (filters: Parameters<typeof adminService.books>[0]) => adminService.books(filters),
  moderation: () => adminService.moderationQueue(),
  reports: () => adminService.reports(),
  auditLogs: (filters: Parameters<typeof adminService.auditLogs>[0]) => adminService.auditLogs(filters),
  flags: () => adminService.flags(),
  aiModels: () => adminService.aiModels(),
  storage: () => adminService.storage(),
  settings: () => adminService.settings(),
  platformAnalytics: (period?: string) => analyticsService.platform((period as PeriodKey) ?? '30d'),
};
