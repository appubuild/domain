import type {
  AdminSettings,
  AiModelConfig,
  AuditLog,
  Category,
  FeatureFlag,
  Report,
  SiteTheme,
  Tag,
} from '@/types/domain';

export const seedCategories: Category[] = [
  { id: 'cat_fiction', name: 'Fiction', slug: 'fiction', kind: 'book', description: 'Novels, novellas and short story collections.', color: '#7c3aed', featured: true, order: 0, active: true },
  { id: 'cat_romance', name: 'Romance', slug: 'romance', kind: 'book', description: 'Contemporary, historical and speculative romance.', color: '#e11d48', featured: true, order: 1, active: true },
  { id: 'cat_mystery', name: 'Mystery', slug: 'mystery', kind: 'book', description: 'Whodunits, cosy mysteries and detective series.', color: '#0f766e', featured: true, order: 2, active: true },
  { id: 'cat_thriller', name: 'Thriller', slug: 'thriller', kind: 'book', description: 'Psychological, legal and espionage thrillers.', color: '#b91c1c', featured: false, order: 3, active: true },
  { id: 'cat_fantasy', name: 'Fantasy', slug: 'fantasy', kind: 'book', description: 'Epic, urban and portal fantasy.', color: '#6d28d9', featured: true, order: 4, active: true },
  { id: 'cat_scifi', name: 'Science Fiction', slug: 'science-fiction', kind: 'book', description: 'Hard SF, space opera and near-future speculation.', color: '#0284c7', featured: true, order: 5, active: true },
  { id: 'cat_literary', name: 'Literary Fiction', slug: 'literary-fiction', kind: 'book', description: 'Character-driven, voice-forward literary work.', color: '#4338ca', featured: false, order: 6, active: true },
  { id: 'cat_business', name: 'Business', slug: 'business', kind: 'book', description: 'Strategy, leadership, startups and marketing.', color: '#0369a1', featured: true, order: 7, active: true },
  { id: 'cat_selfhelp', name: 'Self-help', slug: 'self-help', kind: 'book', description: 'Habits, mindset, health and personal growth.', color: '#c2410c', featured: true, order: 8, active: true },
  { id: 'cat_biography', name: 'Biography', slug: 'biography', kind: 'book', description: 'Memoir, biography and personal narrative.', color: '#7c2d12', featured: false, order: 9, active: true },
  { id: 'cat_education', name: 'Education', slug: 'education', kind: 'book', description: 'Teaching resources, study guides and textbooks.', color: '#15803d', featured: false, order: 10, active: true },
  { id: 'cat_cookbook', name: 'Cookbook', slug: 'cookbook', kind: 'book', description: 'Recipes, techniques and food writing.', color: '#b45309', featured: true, order: 11, active: true },
  { id: 'cat_children', name: "Children's Books", slug: 'childrens-books', kind: 'book', description: 'Picture books, early readers and middle grade.', color: '#f59e0b', featured: true, order: 12, active: true },
  { id: 'cat_picture', name: 'Picture Books', slug: 'picture-books', kind: 'book', description: 'Illustrated books for ages 2–8.', color: '#fb7185', featured: false, order: 13, active: true },
  { id: 'cat_workbook', name: 'Workbook', slug: 'workbook', kind: 'book', description: 'Exercises, worksheets and guided practice.', color: '#0891b2', featured: false, order: 14, active: true },
  { id: 'cat_activity', name: 'Activity Book', slug: 'activity-book', kind: 'book', description: 'Puzzles, games and creative activities.', color: '#65a30d', featured: false, order: 15, active: true },
  { id: 'cat_coloring', name: 'Coloring Book', slug: 'coloring-book', kind: 'book', description: 'Line-art collections for all ages.', color: '#db2777', featured: false, order: 16, active: true },
  { id: 'cat_journal', name: 'Journal', slug: 'journal', kind: 'book', description: 'Gratitude, reflection and guided journals.', color: '#a16207', featured: false, order: 17, active: true },
  { id: 'cat_planner', name: 'Planner', slug: 'planner', kind: 'book', description: 'Daily, weekly and yearly planning systems.', color: '#4f46e5', featured: false, order: 18, active: true },
  { id: 'cat_guide', name: 'Guide', slug: 'guide', kind: 'book', description: 'How-to guides and practical references.', color: '#0d9488', featured: false, order: 19, active: true },
  { id: 'cat_textbook', name: 'Textbook', slug: 'textbook', kind: 'book', description: 'Structured course material with exercises.', color: '#1d4ed8', featured: false, order: 20, active: true },
  { id: 'cat_studio', name: 'Studio & Craft', slug: 'studio-craft', kind: 'template', description: 'Design-forward layout systems for creative studios.', color: '#9333ea', featured: true, order: 21, active: true },
];

export const seedTags: Tag[] = [
  'slow-living', 'coastal', 'small-town', 'found-family', 'dual-timeline', 'literary', 'debut',
  'engineering', 'leadership', 'productivity', 'habits', 'mindfulness', 'money', 'career',
  'space-opera', 'first-contact', 'climate', 'time-travel', 'magic-school', 'heist',
  'cosy-mystery', 'detective', 'amateur-sleuth', 'locked-room', 'medical',
  'recipes', 'baking', 'fermentation', 'vegetarian', 'weeknight',
  'picture-book', 'rhyming', 'bedtime', 'animals', 'friendship',
  'bullet-journal', 'undated', 'gratitude', 'goal-setting', 'self-care',
  'study-guide', 'exam-prep', 'classroom', 'flashcards',
  'large-print', 'low-content', 'hardcover-ready', 'series-starter',
].map((name, index) => ({
  id: `tag_${name}`,
  name,
  slug: name,
  type: index % 7 === 0 ? 'template' : 'book',
  usageCount: 4 + ((index * 13) % 90),
}));

export const seedFlags: FeatureFlag[] = [
  { id: 'flag_ai_writing', key: 'ai_writing', name: 'AI writing assistant', description: 'Continue, rewrite, expand and tone tools inside the editor.', enabled: true, scope: 'global', rollout: 100, category: 'ai', updatedAt: new Date(Date.now() - 86400000 * 6).toISOString() },
  { id: 'flag_ai_images', key: 'ai_images', name: 'AI image generation', description: 'Illustration generation and cover concept generation.', enabled: true, scope: 'plan', rollout: 100, category: 'ai', updatedAt: new Date(Date.now() - 86400000 * 12).toISOString() },
  { id: 'flag_ai_memory', key: 'ai_book_memory', name: 'AI book memory', description: 'Characters, timeline and style knowledge panel.', enabled: true, scope: 'beta', rollout: 40, category: 'ai', updatedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: 'flag_marketplace', key: 'marketplace', name: 'Marketplace', description: 'Public book marketplace with checkout and reviews.', enabled: true, scope: 'global', rollout: 100, category: 'marketplace', updatedAt: new Date(Date.now() - 86400000 * 30).toISOString() },
  { id: 'flag_selling', key: 'marketplace_selling', name: 'Marketplace selling', description: 'Allow authors to list and price books for sale.', enabled: true, scope: 'plan', rollout: 100, category: 'marketplace', updatedAt: new Date(Date.now() - 86400000 * 20).toISOString() },
  { id: 'flag_reviews', key: 'reviews', name: 'Reviews and ratings', description: 'Reader reviews with moderation queue.', enabled: true, scope: 'global', rollout: 100, category: 'marketplace', updatedAt: new Date(Date.now() - 86400000 * 18).toISOString() },
  { id: 'flag_collab', key: 'collaboration', name: 'Collaboration', description: 'Invite editors and viewers, comments and mentions.', enabled: true, scope: 'plan', rollout: 100, category: 'collaboration', updatedAt: new Date(Date.now() - 86400000 * 9).toISOString() },
  { id: 'flag_epub', key: 'export_epub', name: 'EPUB export', description: 'Reflowable EPUB 2 and EPUB 3 generation.', enabled: true, scope: 'global', rollout: 100, category: 'export', updatedAt: new Date(Date.now() - 86400000 * 26).toISOString() },
  { id: 'flag_docx', key: 'export_docx', name: 'DOCX export', description: 'Word document export for editors.', enabled: true, scope: 'global', rollout: 100, category: 'export', updatedAt: new Date(Date.now() - 86400000 * 26).toISOString() },
  { id: 'flag_print', key: 'export_print', name: 'Print-ready export', description: 'Print interiors, crop marks, bleed and spine calculation.', enabled: true, scope: 'plan', rollout: 100, category: 'export', updatedAt: new Date(Date.now() - 86400000 * 14).toISOString() },
  { id: 'flag_advanced_editor', key: 'advanced_editor', name: 'Advanced editor', description: 'Design mode, layers, canvas elements and rulers.', enabled: true, scope: 'plan', rollout: 100, category: 'editor', updatedAt: new Date(Date.now() - 86400000 * 11).toISOString() },
  { id: 'flag_import', key: 'book_import', name: 'Book import', description: 'Import DOCX, HTML, EPUB and TXT manuscripts.', enabled: true, scope: 'global', rollout: 100, category: 'platform', updatedAt: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: 'flag_custom_domain', key: 'custom_domain', name: 'Custom author domain', description: 'Serve an author page on a custom domain.', enabled: false, scope: 'beta', rollout: 10, category: 'platform', updatedAt: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: 'flag_payouts', key: 'author_payouts', name: 'Author payouts', description: 'Withdraw available balance to a payout method.', enabled: false, scope: 'beta', rollout: 25, category: 'marketplace', updatedAt: new Date(Date.now() - 86400000 * 1).toISOString() },
];

export const seedAiModels: AiModelConfig[] = [
  { id: 'ai_1', provider: 'Scriptora', model: 'Quill Large', purpose: 'writing', enabled: true, creditsPerUse: 4, monthlyLimit: 200000, used: 128430, latencyMs: 900, quality: 94 },
  { id: 'ai_2', provider: 'Scriptora', model: 'Quill Fast', purpose: 'writing', enabled: true, creditsPerUse: 1, monthlyLimit: 400000, used: 291200, latencyMs: 380, quality: 82 },
  { id: 'ai_3', provider: 'Atelier', model: 'Atelier Vision 2', purpose: 'image', enabled: true, creditsPerUse: 12, monthlyLimit: 60000, used: 21450, latencyMs: 4200, quality: 91 },
  { id: 'ai_4', provider: 'Atelier', model: 'Atelier Linework', purpose: 'cover', enabled: true, creditsPerUse: 16, monthlyLimit: 30000, used: 6120, latencyMs: 5100, quality: 88 },
  { id: 'ai_5', provider: 'Proof', model: 'Proof Standard', purpose: 'proofreading', enabled: true, creditsPerUse: 2, monthlyLimit: 250000, used: 44100, latencyMs: 700, quality: 89 },
  { id: 'ai_6', provider: 'Lingua', model: 'Lingua Translate', purpose: 'translation', enabled: true, creditsPerUse: 6, monthlyLimit: 120000, used: 8890, latencyMs: 1400, quality: 86 },
  { id: 'ai_7', provider: 'Atelier', model: 'Atelier Vision 2 Turbo', purpose: 'image', enabled: false, creditsPerUse: 6, monthlyLimit: 40000, used: 0, latencyMs: 1800, quality: 76 },
];

export const seedAdminSettings: AdminSettings = {
  general: {
    platformName: 'Scriptora',
    supportEmail: 'support@scriptora.app',
    domain: 'scriptora.app',
    defaultLanguage: 'en',
    timezone: 'UTC',
    maintenanceMode: false,
    maintenanceMessage: 'We are performing scheduled maintenance and will be back shortly.',
    signupEnabled: true,
  },
  marketplace: {
    enabled: true,
    commissionRate: 0.15,
    minPrice: 0.99,
    maxPrice: 149,
    autoApprove: false,
    reviewsEnabled: true,
    allowFreeBooks: true,
    payoutThreshold: 50,
    payoutSchedule: 'monthly',
  },
  publishing: {
    defaultProfile: 'kdp-print',
    requirePreflight: true,
    allowPrintExports: true,
    kdpPresetsEnabled: true,
    maxTrimSize: '8.5x11',
    isbnRequired: false,
  },
  payments: {
    provider: 'MockPay (Stripe-ready)',
    currency: 'USD',
    taxInclusive: false,
    refundWindowDays: 14,
    payoutsEnabled: false,
  },
  email: {
    provider: 'MockPost (Resend-ready)',
    fromName: 'Scriptora',
    fromEmail: 'hello@scriptora.app',
    replyTo: 'support@scriptora.app',
    welcomeEnabled: true,
    salesEnabled: true,
    marketingEnabled: false,
  },
  security: {
    twoFactorRequired: false,
    sessionTimeoutMinutes: 720,
    passwordMinLength: 8,
    allowSocialLogin: true,
    allowedDomains: '',
    ipAllowlist: '',
  },
  ai: {
    enabled: true,
    defaultProvider: 'Scriptora',
    monthlyCreditsDefault: 60,
    imageGenerationDefault: true,
    moderationEnabled: true,
    sharedMemory: true,
  },
};

export const seedTheme: SiteTheme = {
  primary: '#7c3aed',
  secondary: '#0f172a',
  accent: '#f59e0b',
  radius: 0.65,
  defaultMode: 'system',
  logoText: 'Scriptora',
  logoMark: 'quill',
  favicon: '/favicon.svg',
  fontPairing: 'Inter + Source Serif 4',
  heroStyle: 'gradient',
  announcement: {
    enabled: true,
    text: 'Launch offer — Pro is 25% off for your first year. Use code WRITE25 at checkout.',
    href: '/pricing',
    version: 3,
  },
};

const adminNames = ['Ada Whitfield', 'Marcus Ola', 'Priya Raman', 'Jonas Ebert', 'Lena Moreau'];

export const seedAuditLogs: AuditLog[] = Array.from({ length: 68 }).map((_, index) => {
  const actions = [
    { action: 'user.plan_changed', targetType: 'user', before: 'Free', after: 'Pro' },
    { action: 'book.featured', targetType: 'book', before: 'featured: false', after: 'featured: true' },
    { action: 'review.hidden', targetType: 'review', before: 'status: published', after: 'status: hidden' },
    { action: 'plan.updated', targetType: 'plan', before: 'priceMonthly: 19', after: 'priceMonthly: 24' },
    { action: 'cms.page_published', targetType: 'cms_page', before: 'status: draft', after: 'status: published' },
    { action: 'user.suspended', targetType: 'user', before: 'status: active', after: 'status: suspended' },
    { action: 'flag.toggled', targetType: 'feature_flag', before: 'enabled: false', after: 'enabled: true' },
    { action: 'template.featured', targetType: 'template', before: 'featured: false', after: 'featured: true' },
    { action: 'settings.updated', targetType: 'settings', before: 'commissionRate: 0.2', after: 'commissionRate: 0.15' },
    { action: 'report.resolved', targetType: 'report', before: 'status: open', after: 'status: resolved' },
  ];
  const chosen = actions[index % actions.length];
  return {
    id: `audit_${index + 1}`,
    adminId: 'user_admin',
    adminName: adminNames[index % adminNames.length],
    action: chosen.action,
    target: `#${(1000 + index * 7).toString()}`,
    targetType: chosen.targetType,
    before: chosen.before,
    after: chosen.after,
    ip: `10.0.${(index % 20) + 1}.${(index * 3) % 250}`,
    createdAt: new Date(Date.now() - index * 5.4 * 3600 * 1000).toISOString(),
  };
});

export const seedReports: Report[] = [
  { id: 'report_1', reporterId: 'user_emma', reporterName: 'Emma Hartley', targetType: 'review', targetId: 'rev_3', targetLabel: 'Review on "The Quiet Code"', reason: 'spam', details: 'Review contains a promotional link to an unrelated site.', status: 'open', createdAt: new Date(Date.now() - 3600 * 5 * 1000).toISOString() },
  { id: 'report_2', reporterId: 'user_noah', reporterName: 'Noah Bergquist', targetType: 'book', targetId: 'mbook_5', targetLabel: 'Astronomy for Curious Nine-Year-Olds', reason: 'copyright', details: 'Suspect third-party illustrations without licence documentation.', status: 'investigating', createdAt: new Date(Date.now() - 3600 * 30 * 1000).toISOString() },
  { id: 'report_3', reporterId: 'user_priya', reporterName: 'Priya Raman', targetType: 'author', targetId: 'user_daniel', targetLabel: 'Daniel Osei', reason: 'misinformation', details: 'Health claims in the accompanying description are unverified.', status: 'open', createdAt: new Date(Date.now() - 3600 * 60 * 1000).toISOString() },
  { id: 'report_4', reporterId: 'user_liam', reporterName: 'Liam Novak', targetType: 'review', targetId: 'rev_9', targetLabel: 'Review on "Harbour of Small Lights"', reason: 'offensive', details: 'Language in the second paragraph breaches community guidelines.', status: 'resolved', createdAt: new Date(Date.now() - 3600 * 96 * 1000).toISOString(), resolvedAt: new Date(Date.now() - 3600 * 40 * 1000).toISOString(), adminNote: 'Review hidden, author notified, no further action.' },
  { id: 'report_5', reporterId: 'user_sara', reporterName: 'Sara Delgado', targetType: 'content', targetId: 'cms_page_blog', targetLabel: 'Blog post: Seven cover mistakes', reason: 'other', details: 'Requesting a correction to a quoted statistic.', status: 'dismissed', createdAt: new Date(Date.now() - 3600 * 140 * 1000).toISOString(), resolvedAt: new Date(Date.now() - 3600 * 100 * 1000).toISOString(), adminNote: 'Statistic verified against source. No change needed.' },
];
