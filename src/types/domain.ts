/**
 * Scriptora domain model.
 *
 * These types describe the *Book Document Model* — an internal, export-agnostic
 * representation of a book. Nothing in the editor is coupled to PDF or EPUB:
 * exporters read this model and produce their own output.
 *
 * Phase 1: consumed by mock repositories.
 * Phase 2+: the same shapes are returned by the real API / PostgreSQL layer.
 */

export type ID = string;
export type ISODate = string;

/* ------------------------------------------------------------------ users */

export type UserRole = 'user' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'invited';

export interface SocialLinks {
  twitter?: string;
  instagram?: string;
  website?: string;
  goodreads?: string;
  linkedin?: string;
}

export interface NotificationPrefs {
  emailBookPublished: boolean;
  emailSales: boolean;
  emailExports: boolean;
  emailSubscription: boolean;
  emailRevenue: boolean;
  emailProduct: boolean;
  inAppSales: boolean;
  inAppComments: boolean;
  inAppReviews: boolean;
  inAppPublishing: boolean;
  inAppAi: boolean;
  digestWeekly: boolean;
}

export interface AiPrefs {
  defaultTone: string;
  defaultStyle: string;
  targetAudience: string;
  language: string;
  autoProofread: boolean;
  creativity: number; // 0-100
  allowTraining: boolean;
}

export interface PrivacyPrefs {
  profilePublic: boolean;
  showSales: boolean;
  allowFollow: boolean;
  allowMessages: boolean;
  showInMarketplace: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  accent: string;
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  notifications: NotificationPrefs;
  ai: AiPrefs;
  privacy: PrivacyPrefs;
  editorFontSize: number;
  autosave: boolean;
}

export interface User {
  id: ID;
  email: string;
  password: string; // mock only — never stored this way in a real backend
  name: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string;
  bio: string;
  tagline: string;
  website: string;
  social: SocialLinks;
  country: string;
  createdAt: ISODate;
  lastActiveAt: ISODate;
  planId: ID;
  onboarded: boolean;
  isAuthor: boolean;
  followers: number;
  following: number;
  storageUsedBytes: number;
  aiCreditsUsed: number;
  aiImageCreditsUsed: number;
  usagePeriodStart: ISODate;
  settings: UserSettings;
  emailVerified: boolean;
  payoutMethod?: PayoutMethod;
}

export interface PayoutMethod {
  type: 'bank' | 'paypal' | 'stripe';
  label: string;
  last4?: string;
  country: string;
  ready: boolean;
}

/* ----------------------------------------------------------------- plans */

export interface PlanFeatureSet {
  maxBooks: number; // -1 = unlimited
  storageGb: number;
  aiCredits: number;
  aiImageCredits: number;
  exportFormats: ExportFormat[];
  premiumTemplates: boolean;
  aiImageGeneration: boolean;
  coverGeneration: boolean;
  marketplaceSelling: boolean;
  collaboration: boolean;
  advancedEditor: boolean;
  printProfiles: boolean;
  customDomain: boolean;
  teamSeats: number;
  support: 'community' | 'email' | 'priority' | 'dedicated';
  watermarkFree: boolean;
}

export interface Plan {
  id: ID;
  name: string;
  slug: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  badge?: string;
  highlight: boolean;
  order: number;
  features: PlanFeatureSet;
  marketingFeatures: string[];
  active: boolean;
  purchasable: boolean;
  commissionRate: number; // marketplace commission for this plan (0-1)
}

export interface Subscription {
  id: ID;
  userId: ID;
  planId: ID;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  interval: 'monthly' | 'yearly';
  startedAt: ISODate;
  renewsAt: ISODate;
  canceledAt?: ISODate;
  seats: number;
}

export interface Invoice {
  id: ID;
  userId: ID;
  subscriptionId: ID;
  number: string;
  planName: string;
  amount: number;
  currency: string;
  status: 'paid' | 'open' | 'failed' | 'refunded';
  interval: 'monthly' | 'yearly';
  createdAt: ISODate;
  periodStart: ISODate;
  periodEnd: ISODate;
  method: string;
}

/* ----------------------------------------------------------------- books */

export type BookStatus = 'draft' | 'in_review' | 'ready' | 'published' | 'archived' | 'trashed';
export type BookVisibility = 'private' | 'public' | 'unlisted' | 'marketplace';
export type BookKind =
  | 'fiction'
  | 'nonfiction'
  | 'children'
  | 'workbook'
  | 'journal'
  | 'planner'
  | 'cookbook'
  | 'textbook'
  | 'biography'
  | 'poetry'
  | 'guide';

export type SectionKind =
  | 'cover'
  | 'front-matter'
  | 'part'
  | 'chapter'
  | 'section'
  | 'back-matter'
  | 'back-cover';

export interface TrimSize {
  id: string;
  label: string;
  widthIn: number;
  heightIn: number;
  custom?: boolean;
}

export interface BookMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  mirror: boolean;
}

export interface BookTheme {
  palette: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  headingScale: number;
  dropCaps: boolean;
  chapterStartsRecto: boolean;
  paragraphIndent: number;
  paragraphSpacing: number;
  lineHeight: number;
}

export interface BookFonts {
  heading: string;
  body: string;
  mono: string;
  baseSize: number;
}

export type NumberingStyle = 'arabic' | 'roman-lower' | 'roman-upper' | 'none';

export interface PageNumbering {
  style: NumberingStyle;
  startAt: number;
  hideOnFirstPage: boolean;
  sectionBased: boolean;
  position: 'bottom-center' | 'bottom-outer' | 'bottom-inner' | 'top-center' | 'top-outer' | 'none';
}

export interface HeaderFooter {
  headerEnabled: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerEnabled: boolean;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  differentFirstPage: boolean;
  firstPageFooter: string;
}

export interface TocSettings {
  enabled: boolean;
  title: string;
  depth: 1 | 2 | 3;
  dots: boolean;
  showPageNumbers: boolean;
  placement: 'front' | 'back';
}

export interface PageBackground {
  type: 'none' | 'color' | 'gradient' | 'image' | 'pattern';
  value: string;
  gradient?: string;
  imageUrl?: string;
  pattern?: string;
}

export type ElementType =
  | 'text'
  | 'image'
  | 'shape'
  | 'line'
  | 'divider'
  | 'icon'
  | 'table'
  | 'quote'
  | 'decoration'
  | 'barcode'
  | 'pageNumber';

export interface TextStyleProps {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  letterSpacing: number;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  opacity: number;
  shadow?: string;
  columns?: number;
}

export interface ImageProps {
  src: string;
  fit: 'cover' | 'contain' | 'fill';
  radius: number;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
  opacity: number;
  filters: {
    grayscale: number;
    sepia: number;
    blur: number;
    brightness: number;
    contrast: number;
  };
  crop?: { x: number; y: number; scale: number };
}

export interface ShapeProps {
  kind: 'rect' | 'ellipse' | 'triangle' | 'line' | 'star' | 'arrow';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface PageElement {
  id: ID;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  groupId?: ID;
  text?: string; // html for text-like elements
  style?: Partial<TextStyleProps>;
  image?: Partial<ImageProps>;
  shape?: Partial<ShapeProps>;
  icon?: string;
  divider?: { style: 'solid' | 'dashed' | 'dotted' | 'double' | 'ornament'; color: string; thickness: number };
  table?: { rows: number; cols: number; cells: string[][]; headerRow: boolean; borderColor: string };
  z?: number;
}

export type PageLayout = 'flow' | 'canvas' | 'title' | 'blank';

export interface BookPage {
  id: ID;
  sectionId: ID;
  title: string;
  layout: PageLayout;
  content: string; // rich text HTML for flow/title pages
  elements: PageElement[];
  background: PageBackground;
  numbering: NumberingStyle | 'inherit';
  locked: boolean;
  notes: string;
  wordCount: number;
  updatedAt: ISODate;
  /**
   * Pages that should always start a new printed page in exports.
   * Flow pages are split by the export engine; design pages are atomic.
   */
  atomic: boolean;
}

export interface BookSection {
  id: ID;
  bookId: ID;
  kind: SectionKind;
  title: string;
  subtitle?: string;
  order: number;
  pageIds: ID[];
  numberingStarts?: number | null;
  collapsed?: boolean;
  wordCount: number;
  summary?: string;
  status: 'empty' | 'drafting' | 'complete';
  aiGenerated?: boolean;
}

export interface BookMetadata {
  isbn: string;
  publisher: string;
  edition: string;
  publishDate: string;
  copyright: string;
  language: string;
  keywords: string[];
  bisac: string[];
  ageRange: string;
  series: string;
  seriesNumber: number | null;
  imprint: string;
  rights: string;
  aiDisclosure: boolean;
}

export interface CoverDesign {
  style: string;
  backgroundColor: string;
  gradient: string;
  imageUrl: string;
  titleFont: string;
  subtitleFont: string;
  authorFont: string;
  titleColor: string;
  subtitleColor: string;
  authorColor: string;
  titleSize: number;
  layout: 'classic' | 'bold-bottom' | 'centered' | 'image-top' | 'minimal' | 'illustrated';
  spineText: string;
  backText: string;
  showBarcode: boolean;
  barcodeIsbn: string;
  tagline: string;
  elements: PageElement[];
}

export interface MarketplaceMeta {
  listed: boolean;
  price: number;
  currency: string;
  discountPercent: number;
  featured: boolean;
  staffPick: boolean;
  trending: boolean;
  freePreviewPages: number;
  sales: number;
  views: number;
  downloads: number;
  favorites: number;
  rating: number;
  reviewCount: number;
  conversionRate: number;
  commissionRate: number;
  submittedAt?: ISODate;
  approvedAt?: ISODate;
  moderationNote?: string;
  categories: ID[];
  tags: string[];
  popularityScore: number;
  coverArtSeed: number;
}

export interface Book {
  id: ID;
  ownerId: ID;
  authorName: string;
  title: string;
  subtitle: string;
  description: string;
  shortDescription: string;
  kind: BookKind;
  categoryIds: ID[];
  tags: string[];
  language: string;
  status: BookStatus;
  visibility: BookVisibility;
  trimSize: TrimSize;
  orientation: 'portrait' | 'landscape';
  margins: BookMargins;
  gutter: number;
  bleed: number;
  safeArea: number;
  facingPages: boolean;
  theme: BookTheme;
  fonts: BookFonts;
  numbering: PageNumbering;
  headerFooter: HeaderFooter;
  toc: TocSettings;
  metadata: BookMetadata;
  cover: CoverDesign;
  sections: BookSection[];
  pages: BookPage[];
  marketplace: MarketplaceMeta;
  wordCount: number;
  pageCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  publishedAt?: ISODate;
  lastOpenedAt?: ISODate;
  templateId?: ID;
  archivedAt?: ISODate;
  trashedAt?: ISODate;
  paperStock: 'white' | 'cream' | 'color';
  starred: boolean;
}

/* -------------------------------------------------------------- editor ops */

export interface VersionEntry {
  id: ID;
  bookId: ID;
  userId: ID;
  userName: string;
  label: string;
  detail: string;
  createdAt: ISODate;
  snapshot: {
    title: string;
    pageCount: number;
    wordCount: number;
    sections: BookSection[];
    pages: BookPage[];
    cover: CoverDesign;
  };
  kind: 'autosave' | 'manual' | 'milestone' | 'restore';
}

export interface Comment {
  id: ID;
  bookId: ID;
  pageId?: ID;
  sectionId?: ID;
  userId: ID;
  userName: string;
  userAvatar: string;
  body: string;
  mentions: ID[];
  resolved: boolean;
  createdAt: ISODate;
  replies: { id: ID; userId: ID; userName: string; body: string; createdAt: ISODate }[];
}

export interface Collaborator {
  id: ID;
  bookId: ID;
  userId: ID;
  name: string;
  email: string;
  avatarUrl: string;
  role: 'owner' | 'editor' | 'viewer';
  invitedAt: ISODate;
  status: 'active' | 'pending';
}

export interface BookNote {
  id: ID;
  bookId: ID;
  sectionId?: ID;
  title: string;
  body: string;
  createdAt: ISODate;
  color: string;
}

/* ------------------------------------------------------------- book memory */

export interface MemoryEntry {
  id: ID;
  bookId: ID;
  type: 'character' | 'location' | 'timeline' | 'fact' | 'style' | 'glossary' | 'instruction';
  name: string;
  detail: string;
  tags: string[];
  updatedAt: ISODate;
}

/* ---------------------------------------------------------------- assets */

export type AssetKind = 'upload' | 'image' | 'ai-image' | 'cover' | 'illustration' | 'background' | 'logo' | 'icon';

export interface Asset {
  id: ID;
  ownerId: ID;
  name: string;
  kind: AssetKind;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  folder: string;
  tags: string[];
  createdAt: ISODate;
  bookId?: ID;
  favorite: boolean;
  storageKey: string;
}

/* ------------------------------------------------------------- templates */

export interface Template {
  id: ID;
  name: string;
  slug: string;
  description: string;
  categoryId: ID;
  style: string;
  kind: BookKind;
  trimSize: TrimSize;
  pageCount: number;
  language: string;
  premium: boolean;
  featured: boolean;
  published: boolean;
  uses: number;
  rating: number;
  coverArtSeed: number;
  palette: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  tags: string[];
  structure: { kind: SectionKind; title: string; pages: number }[];
  tagsLine: string;
  createdAt: ISODate;
}

export interface Category {
  id: ID;
  name: string;
  slug: string;
  kind: 'book' | 'template' | 'blog';
  description: string;
  color: string;
  parentId?: ID | null;
  featured: boolean;
  order: number;
  bookCount?: number;
  active: boolean;
}

export interface Tag {
  id: ID;
  name: string;
  slug: string;
  type: 'book' | 'template' | 'general';
  usageCount: number;
}

/* ----------------------------------------------------------- marketplace */

export interface Review {
  id: ID;
  bookId: ID;
  userId: ID;
  userName: string;
  userAvatar: string;
  rating: number;
  title: string;
  body: string;
  status: 'published' | 'pending' | 'hidden';
  helpful: number;
  flagged: boolean;
  createdAt: ISODate;
  updatedAt?: ISODate;
  verifiedPurchase: boolean;
  adminNote?: string;
}

export interface Order {
  id: ID;
  number: string;
  buyerId: ID;
  buyerName: string;
  bookId: ID;
  bookTitle: string;
  authorId: ID;
  authorName: string;
  amount: number;
  currency: string;
  platformFee: number;
  authorEarnings: number;
  status: 'completed' | 'pending' | 'refunded' | 'failed';
  method: 'card' | 'paypal' | 'apple-pay' | 'credits';
  createdAt: ISODate;
  country: string;
  refundReason?: string;
}

export interface WishlistItem {
  id: ID;
  userId: ID;
  bookId: ID;
  addedAt: ISODate;
}

export interface LibraryItem {
  id: ID;
  userId: ID;
  bookId: ID;
  orderId: ID;
  acquiredAt: ISODate;
  progress: number; // 0-100
  lastReadAt?: ISODate;
  bookmarkedPages: number[];
  downloaded: boolean;
  source: 'purchase' | 'free' | 'gift';
  readingMode: 'page' | 'scroll';
  fontSize: number;
  readerTheme: 'light' | 'dark' | 'sepia';
}

export interface BookViewEvent {
  id: ID;
  bookId: ID;
  userId?: ID;
  createdAt: ISODate;
  country: string;
  source: 'marketplace' | 'author-page' | 'search' | 'external' | 'internal';
}

/* -------------------------------------------------------- notifications */

export type NotificationType =
  | 'export'
  | 'ai'
  | 'sale'
  | 'review'
  | 'comment'
  | 'subscription'
  | 'storage'
  | 'publishing'
  | 'system'
  | 'collaboration';

export interface AppNotification {
  id: ID;
  userId: ID;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: ISODate;
  link?: string;
  priority: 'low' | 'normal' | 'high';
}

export interface EmailEvent {
  id: ID;
  to: string;
  toName: string;
  template:
    | 'welcome'
    | 'verify-email'
    | 'password-reset'
    | 'book-published'
    | 'book-sale'
    | 'export-completed'
    | 'subscription'
    | 'revenue'
    | 'comment'
    | 'contact-form'
    | 'system';
  subject: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  createdAt: ISODate;
  opened: boolean;
}

/* ------------------------------------------------------------- exports */

export type ExportFormat = 'pdf' | 'print-pdf' | 'epub' | 'epub3' | 'docx' | 'html' | 'txt';

export type PublishingProfileId =
  | 'digital-pdf'
  | 'epub-reflowable'
  | 'paperback'
  | 'hardcover'
  | 'kdp-ebook'
  | 'kdp-print'
  | 'press-ready';

export interface PublishingProfile {
  id: PublishingProfileId;
  name: string;
  family: 'digital' | 'print' | 'platform';
  description: string;
  formats: ExportFormat[];
  requirements: {
    bleedRequired: boolean;
    minPages: number;
    maxPages: number;
    minDpi: number;
    allowBleed: boolean;
    fontEmbedding: boolean;
    trimSizes?: string[];
  };
  platformNote: string;
}

export interface PreflightIssue {
  id: ID;
  severity: 'error' | 'warning' | 'info';
  category:
    | 'page-size'
    | 'margins'
    | 'bleed'
    | 'gutter'
    | 'images'
    | 'image-quality'
    | 'overflow'
    | 'empty-pages'
    | 'links'
    | 'fonts'
    | 'toc'
    | 'page-numbers'
    | 'metadata'
    | 'cover'
    | 'structure';
  title: string;
  detail: string;
  fixHint: string;
  pageId?: ID;
  sectionId?: ID;
  autoFixable: boolean;
  status: 'open' | 'ignored' | 'fixed';
}

export interface PreflightReport {
  bookId: ID;
  profileId: PublishingProfileId;
  ranAt: ISODate;
  passed: number;
  warnings: number;
  errors: number;
  issues: PreflightIssue[];
  readiness: number;
}

export interface ExportJob {
  id: ID;
  bookId: ID;
  bookTitle: string;
  userId: ID;
  format: ExportFormat;
  profileId: PublishingProfileId;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  fileName: string;
  fileSizeBytes: number;
  pages: number;
  createdAt: ISODate;
  completedAt?: ISODate;
  error?: string;
  storageKey: string;
  step: string;
  options: {
    includeToc: boolean;
    includeCover: boolean;
    highResImages: boolean;
    embedFonts: boolean;
    cropMarks: boolean;
  };
}

/* ----------------------------------------------------------- publishing */

export interface PublishingSubmission {
  id: ID;
  bookId: ID;
  bookTitle: string;
  authorId: ID;
  authorName: string;
  visibility: BookVisibility;
  status: 'draft' | 'preflight' | 'ready' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'returned' | 'published' | 'unpublished';
  price: number;
  currency: string;
  submittedAt?: ISODate;
  reviewedAt?: ISODate;
  publishedAt?: ISODate;
  reviewerNote?: string;
  checklist: { id: string; label: string; done: boolean }[];
  reviewerId?: ID;
}

/* ------------------------------------------------------------------ cms */

export interface CmsHero {
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  subheadline: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
  trustLine: string;
  stats: { label: string; value: string }[];
}

export interface CmsSection {
  id: ID;
  key: string;
  page: string;
  type: 'hero' | 'text' | 'image' | 'cta' | 'features' | 'testimonials' | 'faq' | 'pricing' | 'gallery' | 'custom' | 'stats' | 'logos';
  title: string;
  subtitle: string;
  body: string;
  visible: boolean;
  order: number;
  items: { id: ID; title: string; body: string; icon?: string; imageUrl?: string; meta?: string }[];
  ctaLabel?: string;
  ctaHref?: string;
  settings?: Record<string, string | number | boolean>;
}

export interface Testimonial {
  id: ID;
  name: string;
  role: string;
  avatarUrl: string;
  quote: string;
  rating: number;
  bookTitle: string;
  featured: boolean;
  published: boolean;
}

export interface FaqItem {
  id: ID;
  question: string;
  answer: string;
  category: string;
  order: number;
  published: boolean;
}

export interface CmsPage {
  id: ID;
  title: string;
  slug: string;
  status: 'published' | 'draft';
  sections: CmsSection[];
  seo: SeoMeta;
  updatedAt: ISODate;
  showInNav: boolean;
  navOrder: number;
}

export interface SeoMeta {
  title: string;
  description: string;
  ogImage: string;
  keywords: string[];
  canonical: string;
  noIndex: boolean;
}

export interface Promo {
  id: ID;
  name: string;
  type: 'banner' | 'coupon' | 'campaign' | 'announcement';
  message: string;
  placement: 'top-bar' | 'homepage-hero' | 'homepage-mid' | 'marketplace' | 'dashboard';
  ctaLabel: string;
  ctaHref: string;
  discountPercent: number;
  code: string;
  startsAt: ISODate;
  endsAt: ISODate;
  active: boolean;
  impressions: number;
  clicks: number;
}

export interface BlogPost {
  id: ID;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  author: string;
  authorAvatar: string;
  category: string;
  coverGradient: string;
  readMinutes: number;
  publishedAt: ISODate;
  status: 'published' | 'draft';
  featured: boolean;
  tags: string[];
}

export interface SiteTheme {
  primary: string;
  secondary: string;
  accent: string;
  radius: number;
  defaultMode: 'light' | 'dark' | 'system';
  logoText: string;
  logoMark: string;
  favicon: string;
  fontPairing: string;
  heroStyle: 'gradient' | 'minimal' | 'bold' | 'editorial';
  announcement: { enabled: boolean; text: string; href: string; version: number };
}

/* --------------------------------------------------------------- admin */

export interface AuditLog {
  id: ID;
  adminId: ID;
  adminName: string;
  action: string;
  target: string;
  targetType: string;
  before: string;
  after: string;
  ip: string;
  createdAt: ISODate;
}

export interface Report {
  id: ID;
  reporterId: ID;
  reporterName: string;
  targetType: 'book' | 'review' | 'author' | 'user' | 'content';
  targetId: ID;
  targetLabel: string;
  reason: 'spam' | 'copyright' | 'offensive' | 'misinformation' | 'plagiarism' | 'other';
  details: string;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  createdAt: ISODate;
  resolvedAt?: ISODate;
  adminNote?: string;
}

export interface FeatureFlag {
  id: ID;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: 'global' | 'plan' | 'beta';
  rollout: number;
  category: 'editor' | 'ai' | 'marketplace' | 'export' | 'platform' | 'collaboration';
  updatedAt: ISODate;
}

export interface AiModelConfig {
  id: ID;
  provider: string;
  model: string;
  purpose: 'writing' | 'image' | 'proofreading' | 'translation' | 'cover';
  enabled: boolean;
  creditsPerUse: number;
  monthlyLimit: number;
  used: number;
  latencyMs: number;
  quality: number;
}

export interface StorageUsage {
  userId: ID;
  userName: string;
  planName: string;
  usedBytes: number;
  quotaBytes: number;
  bookFiles: number;
  imageAssets: number;
  exportFiles: number;
}

export interface AdminSettings {
  general: {
    platformName: string;
    supportEmail: string;
    domain: string;
    defaultLanguage: string;
    timezone: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
    signupEnabled: boolean;
  };
  marketplace: {
    enabled: boolean;
    commissionRate: number;
    minPrice: number;
    maxPrice: number;
    autoApprove: boolean;
    reviewsEnabled: boolean;
    allowFreeBooks: boolean;
    payoutThreshold: number;
    payoutSchedule: 'weekly' | 'biweekly' | 'monthly';
  };
  publishing: {
    defaultProfile: PublishingProfileId;
    requirePreflight: boolean;
    allowPrintExports: boolean;
    kdpPresetsEnabled: boolean;
    maxTrimSize: string;
    isbnRequired: boolean;
  };
  payments: {
    provider: string;
    currency: string;
    taxInclusive: boolean;
    refundWindowDays: number;
    payoutsEnabled: boolean;
  };
  email: {
    provider: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    welcomeEnabled: boolean;
    salesEnabled: boolean;
    marketingEnabled: boolean;
  };
  security: {
    twoFactorRequired: boolean;
    sessionTimeoutMinutes: number;
    passwordMinLength: number;
    allowSocialLogin: boolean;
    allowedDomains: string;
    ipAllowlist: string;
  };
  ai: {
    enabled: boolean;
    defaultProvider: string;
    monthlyCreditsDefault: number;
    imageGenerationDefault: boolean;
    moderationEnabled: boolean;
    sharedMemory: boolean;
  };
}

/* ------------------------------------------------------------ analytics */

export interface TimeSeriesPoint {
  date: ISODate;
  value: number;
  label?: string;
  secondary?: number;
}

export interface AnalyticsSummary {
  totalRevenue: number;
  availableBalance: number;
  pendingBalance: number;
  lifetimeRevenue: number;
  totalSales: number;
  refunds: number;
  platformFees: number;
  netEarnings: number;
  views: number;
  conversionRate: number;
  downloads: number;
  favorites: number;
  reviews: number;
  avgRating: number;
  changePct: { revenue: number; sales: number; views: number; conversion: number };
}

export interface RevenueByBook {
  bookId: ID;
  title: string;
  cover: string;
  sales: number;
  revenue: number;
  rating: number;
  status: BookStatus;
}

export interface ActivityItem {
  id: ID;
  userId: ID;
  type: 'book' | 'export' | 'publish' | 'sale' | 'ai' | 'comment' | 'review' | 'auth' | 'admin';
  message: string;
  meta?: string;
  createdAt: ISODate;
  link?: string;
}

export interface AiUsageRecord {
  id: ID;
  userId: ID;
  userName: string;
  feature: string;
  credits: number;
  model: string;
  createdAt: ISODate;
  tokens: number;
}

/* ------------------------------------------------------------- drafts */

export interface CreateBookInput {
  title: string;
  author: string;
  subtitle?: string;
  description?: string;
  kind: BookKind;
  language: string;
  trimSizeId: string;
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  gutter: number;
  bleed: number;
  headingFont: string;
  bodyFont: string;
  palette: string;
  theme?: 'light' | 'dark' | 'warm' | 'classic';
  templateId?: string;
  source: 'blank' | 'template' | 'ai' | 'import';
  aiBrief?: AiBookBrief;
  importFileName?: string;
}

export interface AiBookBrief {
  idea: string;
  genre: string;
  audience: string;
  language: string;
  tone: string;
  length: 'short' | 'medium' | 'long';
  chapterCount: number;
  includeIllustrations: boolean;
  protagonist: string;
  setting: string;
  outline: { id: string; title: string; summary: string; approved: boolean }[];
}

export interface MarketplaceFilters {
  query: string;
  categoryIds: string[];
  priceFilter: 'all' | 'free' | 'paid' | 'under5' | 'under10';
  minRating: number;
  sort: 'featured' | 'trending' | 'newest' | 'bestselling' | 'price-asc' | 'price-desc' | 'rating';
  kind?: BookKind | 'all';
}

export interface AuthorProfile {
  userId: ID;
  name: string;
  username: string;
  avatarUrl: string;
  tagline: string;
  bio: string;
  social: SocialLinks;
  location: string;
  followers: number;
  rating: number;
  totalBooks: number;
  totalSales: number;
  joinedAt: ISODate;
  verified: boolean;
  featured: boolean;
  genres: string[];
}

/* ------------------------------------------------------------ navigation */

export interface NavItem {
  id: ID;
  label: string;
  href: string;
  order: number;
  location: 'header' | 'footer-product' | 'footer-resources' | 'footer-company' | 'footer-legal' | 'dashboard' | 'admin';
  visible: boolean;
  badge?: string;
  external?: boolean;
}

export interface FooterConfig {
  tagline: string;
  columns: { id: ID; title: string; order: number }[];
  social: { id: ID; label: string; href: string; icon: string }[];
  copyright: string;
  newsletterHeadline: string;
  newsletterBody: string;
}

export interface StorageObject {
  id: ID;
  key: string;
  bucket: string;
  ownerId: ID;
  kind: 'book-file' | 'image' | 'export' | 'cover' | 'ai-asset' | 'user-asset' | 'illustration';
  sizeBytes: number;
  mimeType: string;
  createdAt: ISODate;
  url: string;
  label: string;
}
