import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { CmsFns, AdminFns, BookFns, MarketFns, OpsFns, TemplateFns } from './queryFns';

export const keys = {
  books: (filters?: unknown) => ['books', filters ?? {}] as const,
  book: (id?: string) => ['book', id ?? ''] as const,
  bookCounts: (userId?: string) => ['book-counts', userId ?? ''] as const,
  templates: (filters?: unknown) => ['templates', filters ?? {}] as const,
  template: (id?: string) => ['template', id ?? ''] as const,
  templateCategories: ['template-categories'] as const,
  marketplace: (filters?: unknown) => ['marketplace', filters ?? {}] as const,
  marketplaceSections: ['marketplace-sections'] as const,
  reviews: (bookId?: string) => ['reviews', bookId ?? ''] as const,
  reviewSummary: (bookId?: string) => ['review-summary', bookId ?? ''] as const,
  wishlist: (userId?: string) => ['wishlist', userId ?? ''] as const,
  library: (userId?: string) => ['library', userId ?? ''] as const,
  orders: (userId?: string) => ['orders', userId ?? ''] as const,
  authorOrders: (userId?: string) => ['author-orders', userId ?? ''] as const,
  revenueSummary: (userId?: string, period?: string) => ['revenue-summary', userId ?? '', period ?? ''] as const,
  revenueSeries: (userId?: string, period?: string, metric?: string) => ['revenue-series', userId ?? '', period ?? '', metric ?? ''] as const,
  revenueByBook: (userId?: string, period?: string) => ['revenue-books', userId ?? '', period ?? ''] as const,
  analytics: (userId?: string, period?: string) => ['analytics', userId ?? '', period ?? ''] as const,
  notifications: (userId?: string) => ['notifications', userId ?? ''] as const,
  activity: (userId?: string) => ['activity', userId ?? ''] as const,
  assets: (userId?: string) => ['assets', userId ?? ''] as const,
  exports: (userId?: string, bookId?: string) => ['exports', userId ?? '', bookId ?? ''] as const,
  submissions: (userId?: string) => ['submissions', userId ?? ''] as const,
  submission: (bookId?: string) => ['submission', bookId ?? ''] as const,
  comments: (bookId?: string) => ['comments', bookId ?? ''] as const,
  collaborators: (bookId?: string) => ['collaborators', bookId ?? ''] as const,
  notes: (bookId?: string) => ['notes', bookId ?? ''] as const,
  memory: (bookId?: string) => ['memory', bookId ?? ''] as const,
  versions: (bookId?: string) => ['versions', bookId ?? ''] as const,
  plans: ['plans'] as const,
  subscription: (userId?: string) => ['subscription', userId ?? ''] as const,
  invoices: (userId?: string) => ['invoices', userId ?? ''] as const,
  homepage: ['homepage'] as const,
  cmsSection: (key: string) => ['cms-section', key] as const,
  cmsPages: ['cms-pages'] as const,
  cmsPage: (slug?: string) => ['cms-page', slug ?? ''] as const,
  blogPosts: (drafts?: boolean) => ['blog-posts', drafts ?? false] as const,
  blogPost: (slug?: string) => ['blog-post', slug ?? ''] as const,
  promos: (activeOnly?: boolean) => ['promos', activeOnly ?? false] as const,
  faqs: ['faqs'] as const,
  nav: (location?: string) => ['nav', location ?? ''] as const,
  footer: ['footer'] as const,
  theme: ['site-theme'] as const,
  authors: ['authors'] as const,
  author: (id?: string) => ['author', id ?? ''] as const,
  categories: (kind?: string) => ['categories', kind ?? ''] as const,
  search: (query: string) => ['search', query] as const,
  adminOverview: ['admin-overview'] as const,
  adminGrowth: (period?: string) => ['admin-growth', period ?? ''] as const,
  adminUsers: (filters?: unknown) => ['admin-users', filters ?? {}] as const,
  adminUser: (id?: string) => ['admin-user', id ?? ''] as const,
  adminBooks: (filters?: unknown) => ['admin-books', filters ?? {}] as const,
  moderation: ['moderation'] as const,
  reports: ['reports'] as const,
  auditLogs: (filters?: unknown) => ['audit-logs', filters ?? {}] as const,
  flags: ['flags'] as const,
  aiModels: ['ai-models'] as const,
  storage: ['admin-storage'] as const,
  adminSettings: ['admin-settings'] as const,
  emails: ['emails'] as const,
  platformAnalytics: (period?: string) => ['platform-analytics', period ?? ''] as const,
  preflight: (bookId?: string, profileId?: string) => ['preflight', bookId ?? '', profileId ?? ''] as const,
  aiUsage: (userId?: string) => ['ai-usage', userId ?? ''] as const,
  publishingChecklist: (bookId?: string) => ['publishing-checklist', bookId ?? ''] as const,
};

type Options<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

export const useBooks = (filters: Parameters<typeof BookFns.list>[0], options?: Options<ReturnType<typeof BookFns.list>>) =>
  useQuery({ queryKey: keys.books(filters), queryFn: () => BookFns.list(filters), ...options });

export const useBook = (id?: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => BookFns.get(id), enabled: Boolean(id) });

export const useBookCounts = (userId?: string) =>
  useQuery({ queryKey: keys.bookCounts(userId), queryFn: () => BookFns.counts(userId as string), enabled: Boolean(userId) });

export const useTemplates = (filters: Parameters<typeof TemplateFns.list>[0]) =>
  useQuery({ queryKey: keys.templates(filters), queryFn: () => TemplateFns.list(filters) });

export const useTemplate = (id?: string) =>
  useQuery({ queryKey: keys.template(id), queryFn: () => TemplateFns.get(id), enabled: Boolean(id) });

export const useTemplateCategories = () =>
  useQuery({ queryKey: keys.templateCategories, queryFn: () => TemplateFns.categoryCounts() });

export const useMarketplace = (filters: Parameters<typeof MarketFns.browse>[0]) =>
  useQuery({ queryKey: keys.marketplace(filters), queryFn: () => MarketFns.browse(filters) });

export const useMarketplaceSections = () =>
  useQuery({ queryKey: keys.marketplaceSections, queryFn: () => MarketFns.sections() });

export const useReviews = (bookId?: string) =>
  useQuery({ queryKey: keys.reviews(bookId), queryFn: () => MarketFns.reviews(bookId as string), enabled: Boolean(bookId) });

export const useReviewSummary = (bookId?: string) =>
  useQuery({ queryKey: keys.reviewSummary(bookId), queryFn: () => MarketFns.reviewSummary(bookId as string), enabled: Boolean(bookId) });

export const useWishlist = (userId?: string) =>
  useQuery({ queryKey: keys.wishlist(userId), queryFn: () => MarketFns.wishlist(userId as string), enabled: Boolean(userId) });

export const useLibrary = (userId?: string) =>
  useQuery({ queryKey: keys.library(userId), queryFn: () => MarketFns.library(userId as string), enabled: Boolean(userId) });

export const useOrders = (userId?: string) =>
  useQuery({ queryKey: keys.orders(userId), queryFn: () => MarketFns.orders(userId), enabled: Boolean(userId) });

export const useRevenueSummary = (userId?: string, period: Parameters<typeof MarketFns.revenueSummary>[1] = '30d') =>
  useQuery({ queryKey: keys.revenueSummary(userId, period), queryFn: () => MarketFns.revenueSummary(userId as string, period), enabled: Boolean(userId) });

export const useRevenueSeries = (userId?: string, period: Parameters<typeof MarketFns.revenueSeries>[1] = '30d', metric: 'revenue' | 'sales' | 'views' = 'revenue') =>
  useQuery({ queryKey: keys.revenueSeries(userId, period, metric), queryFn: () => MarketFns.revenueSeries(userId as string, period, metric), enabled: Boolean(userId) });

export const useRevenueByBook = (userId?: string, period: Parameters<typeof MarketFns.revenueByBook>[1] = '30d') =>
  useQuery({ queryKey: keys.revenueByBook(userId, period), queryFn: () => MarketFns.revenueByBook(userId as string, period), enabled: Boolean(userId) });

export const useAnalytics = (userId?: string, period: Parameters<typeof MarketFns.analytics>[1] = '30d') =>
  useQuery({ queryKey: keys.analytics(userId, period), queryFn: () => MarketFns.analytics(userId as string, period), enabled: Boolean(userId) });

export const useNotifications = (userId?: string) =>
  useQuery({ queryKey: keys.notifications(userId), queryFn: () => OpsFns.notifications(userId as string), enabled: Boolean(userId) });

export const useActivity = (userId?: string) =>
  useQuery({ queryKey: keys.activity(userId), queryFn: () => OpsFns.activity(userId as string), enabled: Boolean(userId) });

export const useAssets = (userId?: string) =>
  useQuery({ queryKey: keys.assets(userId), queryFn: () => OpsFns.assets(userId as string), enabled: Boolean(userId) });

export const useExports = (userId?: string, bookId?: string) =>
  useQuery({ queryKey: keys.exports(userId, bookId), queryFn: () => OpsFns.exports(userId, bookId) });

export const useExportJob = (id?: string) =>
  useQuery({ queryKey: ['export-job', id ?? ''], queryFn: () => OpsFns.exportJob(id as string), enabled: Boolean(id) });

export const useSubmissions = (authorId?: string) =>
  useQuery({ queryKey: keys.submissions(authorId), queryFn: () => OpsFns.submissions(authorId), enabled: Boolean(authorId) });

export const useSubmission = (bookId?: string) =>
  useQuery({ queryKey: keys.submission(bookId), queryFn: () => OpsFns.submission(bookId as string), enabled: Boolean(bookId) });

export const useComments = (bookId?: string) =>
  useQuery({ queryKey: keys.comments(bookId), queryFn: () => BookFns.comments(bookId as string), enabled: Boolean(bookId) });

export const useCollaborators = (bookId?: string) =>
  useQuery({ queryKey: keys.collaborators(bookId), queryFn: () => BookFns.collaborators(bookId as string), enabled: Boolean(bookId) });

export const useNotes = (bookId?: string) =>
  useQuery({ queryKey: keys.notes(bookId), queryFn: () => BookFns.notes(bookId as string), enabled: Boolean(bookId) });

export const useMemory = (bookId?: string) =>
  useQuery({ queryKey: keys.memory(bookId), queryFn: () => BookFns.memory(bookId as string), enabled: Boolean(bookId) });

export const useVersions = (bookId?: string) =>
  useQuery({ queryKey: keys.versions(bookId), queryFn: () => BookFns.versions(bookId as string), enabled: Boolean(bookId) });

export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: () => OpsFns.plans() });

export const useSubscription = (userId?: string) =>
  useQuery({ queryKey: keys.subscription(userId), queryFn: () => OpsFns.subscription(userId as string), enabled: Boolean(userId) });

export const useInvoices = (userId?: string) =>
  useQuery({ queryKey: keys.invoices(userId), queryFn: () => OpsFns.invoices(userId as string), enabled: Boolean(userId) });

export const useHomepage = () => useQuery({ queryKey: keys.homepage, queryFn: () => CmsFns.homepage() });

export const useCmsSection = (key: string) =>
  useQuery({ queryKey: keys.cmsSection(key), queryFn: () => CmsFns.section(key) });

export const useCmsPages = () => useQuery({ queryKey: keys.cmsPages, queryFn: () => CmsFns.pages() });

export const useCmsPage = (slug?: string) =>
  useQuery({ queryKey: keys.cmsPage(slug), queryFn: () => CmsFns.page(slug), enabled: Boolean(slug) });

export const useBlogPosts = (drafts = false) =>
  useQuery({ queryKey: keys.blogPosts(drafts), queryFn: () => CmsFns.posts(drafts) });

export const useBlogPost = (slug?: string) =>
  useQuery({ queryKey: keys.blogPost(slug), queryFn: () => CmsFns.post(slug), enabled: Boolean(slug) });

export const usePromos = (activeOnly = false) =>
  useQuery({ queryKey: keys.promos(activeOnly), queryFn: () => CmsFns.promos(activeOnly) });

export const useFaqs = () => useQuery({ queryKey: keys.faqs, queryFn: () => CmsFns.faqs() });

export const useNav = (location: Parameters<typeof CmsFns.nav>[0]) =>
  useQuery({ queryKey: keys.nav(location), queryFn: () => CmsFns.nav(location) });

export const useFooter = () => useQuery({ queryKey: keys.footer, queryFn: () => CmsFns.footer() });

export const useAuthors = () => useQuery({ queryKey: keys.authors, queryFn: () => OpsFns.authors() });

export const useAuthor = (id?: string) =>
  useQuery({ queryKey: keys.author(id), queryFn: () => OpsFns.author(id), enabled: Boolean(id) });

export const useCategories = (kind?: string) =>
  useQuery({ queryKey: keys.categories(kind), queryFn: () => OpsFns.categories(kind) });

export const useSearch = (query: string) =>
  useQuery({ queryKey: keys.search(query), queryFn: () => OpsFns.search(query), enabled: query.trim().length > 1 });

export const useAdminOverview = () => useQuery({ queryKey: keys.adminOverview, queryFn: () => AdminFns.overview() });

export const useAdminGrowth = (period?: string) =>
  useQuery({ queryKey: keys.adminGrowth(period), queryFn: () => AdminFns.growth(period) });

export const useAdminUsers = (filters: Parameters<typeof AdminFns.users>[0]) =>
  useQuery({ queryKey: keys.adminUsers(filters), queryFn: () => AdminFns.users(filters) });

export const useAdminUser = (id?: string) =>
  useQuery({ queryKey: keys.adminUser(id), queryFn: () => AdminFns.user(id), enabled: Boolean(id) });

export const useAdminBooks = (filters: Parameters<typeof AdminFns.books>[0]) =>
  useQuery({ queryKey: keys.adminBooks(filters), queryFn: () => AdminFns.books(filters) });

export const useModerationQueue = () => useQuery({ queryKey: keys.moderation, queryFn: () => AdminFns.moderation() });

export const useReports = () => useQuery({ queryKey: keys.reports, queryFn: () => AdminFns.reports() });

export const useAuditLogs = (filters: Parameters<typeof AdminFns.auditLogs>[0]) =>
  useQuery({ queryKey: keys.auditLogs(filters), queryFn: () => AdminFns.auditLogs(filters) });

export const useFlags = () => useQuery({ queryKey: keys.flags, queryFn: () => AdminFns.flags() });

export const useAiModels = () => useQuery({ queryKey: keys.aiModels, queryFn: () => AdminFns.aiModels() });

export const useAdminStorage = () => useQuery({ queryKey: keys.storage, queryFn: () => AdminFns.storage() });

export const useAdminSettings = () => useQuery({ queryKey: keys.adminSettings, queryFn: () => AdminFns.settings() });

export const useEmails = () => useQuery({ queryKey: keys.emails, queryFn: () => OpsFns.emails() });

export const usePlatformAnalytics = (period?: string) =>
  useQuery({ queryKey: keys.platformAnalytics(period), queryFn: () => AdminFns.platformAnalytics(period) });

export const usePreflight = (bookId?: string, profileId?: string, enabled = true) =>
  useQuery({
    queryKey: keys.preflight(bookId, profileId),
    queryFn: () => OpsFns.preflight(bookId as string, profileId as Parameters<typeof OpsFns.preflight>[1]),
    enabled: Boolean(bookId) && enabled,
  });

export const useAiUsage = (userId?: string) =>
  useQuery({ queryKey: keys.aiUsage(userId), queryFn: () => OpsFns.aiUsage(userId) });

export const usePublishingChecklist = (bookId?: string) =>
  useQuery({ queryKey: keys.publishingChecklist(bookId), queryFn: () => OpsFns.publishingChecklist(bookId as string), enabled: Boolean(bookId) });

export const useAllSubmissions = () => useQuery({ queryKey: ['all-submissions'], queryFn: () => OpsFns.allSubmissions() });
