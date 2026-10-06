/**
 * Central entitlement layer.
 *
 * No component decides what a plan allows — they ask this module. Phase 2 can
 * swap the implementation for server-side entitlements without touching the UI.
 */
import type { Book, ExportFormat, ID, Plan, User } from '@/types/domain';
import { getDatabase } from '@/store/db';
import { userRepo } from '@/repositories';

export interface UsageSnapshot {
  books: { used: number; limit: number; percent: number; unlimited: boolean };
  storage: { usedBytes: number; limitBytes: number; percent: number };
  aiCredits: { used: number; limit: number; percent: number };
  aiImages: { used: number; limit: number; percent: number };
  seats: { used: number; limit: number };
}

export interface Entitlements {
  plan: Plan;
  usage: UsageSnapshot;
  canCreateBook: () => boolean;
  canExport: (format: ExportFormat) => boolean;
  canUseAI: (credits?: number) => boolean;
  canUseAiImages: () => boolean;
  canGenerateCover: () => boolean;
  canPublish: () => boolean;
  canSellBook: () => boolean;
  canUseMarketplace: () => boolean;
  canUseCollaboration: () => boolean;
  canUsePremiumTemplates: () => boolean;
  canUseAdvancedEditor: () => boolean;
  canUsePrintProfiles: () => boolean;
  canUseFeature: (key: FeatureKey) => boolean;
  upgradeReason: (key: FeatureKey | ExportFormat | 'ai' | 'ai-images' | 'book' | 'storage') => string;
}

export type FeatureKey =
  | 'premium_templates'
  | 'ai_images'
  | 'cover_generation'
  | 'marketplace_selling'
  | 'collaboration'
  | 'advanced_editor'
  | 'print_profiles'
  | 'custom_domain';

export function planFor(user: User | undefined): Plan {
  const db = getDatabase();
  const planId = user?.planId ?? 'plan_free';
  return db.plans.find((plan) => plan.id === planId) ?? db.plans[0];
}

export function userBooks(userId: ID | undefined): Book[] {
  if (!userId) return [];
  return getDatabase().books.filter((book) => book.ownerId === userId && book.status !== 'trashed');
}

export function buildEntitlements(user: User | undefined): Entitlements {
  const plan = planFor(user);
  const books = userBooks(user?.id);
  const features = plan.features;

  const usage: UsageSnapshot = {
    books: {
      used: books.length,
      limit: features.maxBooks,
      percent: features.maxBooks < 0 ? 0 : Math.min(100, Math.round((books.length / features.maxBooks) * 100)),
      unlimited: features.maxBooks < 0,
    },
    storage: {
      usedBytes: user?.storageUsedBytes ?? 0,
      limitBytes: features.storageGb * 1024 * 1024 * 1024,
      percent: Math.min(100, Math.round(((user?.storageUsedBytes ?? 0) / (features.storageGb * 1024 * 1024 * 1024)) * 100)),
    },
    aiCredits: {
      used: user?.aiCreditsUsed ?? 0,
      limit: features.aiCredits,
      percent: Math.min(100, Math.round(((user?.aiCreditsUsed ?? 0) / features.aiCredits) * 100)),
    },
    aiImages: {
      used: user?.aiImageCreditsUsed ?? 0,
      limit: features.aiImageCredits,
      percent: Math.min(100, Math.round(((user?.aiImageCreditsUsed ?? 0) / Math.max(1, features.aiImageCredits)) * 100)),
    },
    seats: { used: 1, limit: features.teamSeats },
  };

  const AI_HEADROOM_BONUS = 5;
  const storageRemaining = usage.storage.limitBytes - usage.storage.usedBytes;
  const bookHeadroom = features.maxBooks < 0 || books.length < features.maxBooks;
  const aiHeadroom =
    usage.aiCredits.limit + AI_HEADROOM_BONUS > usage.aiCredits.used + 1;

  return {
    plan,
    usage,
    canCreateBook: () => bookHeadroom && storageRemaining > 5 * 1024 * 1024,
    canExport: (format) => features.exportFormats.includes(format),
    canUseAI: (credits = 1) => aiHeadroom && usage.aiCredits.used + credits <= usage.aiCredits.limit + AI_HEADROOM_BONUS,
    canUseAiImages: () => features.aiImageGeneration && usage.aiImages.used < usage.aiImages.limit,
    canGenerateCover: () => features.coverGeneration,
    canPublish: () => features.exportFormats.includes('pdf') || features.exportFormats.includes('epub3'),
    canSellBook: () => features.marketplaceSelling,
    canUseMarketplace: () => true,
    canUseCollaboration: () => features.collaboration,
    canUsePremiumTemplates: () => features.premiumTemplates,
    canUseAdvancedEditor: () => features.advancedEditor,
    canUsePrintProfiles: () => features.printProfiles,
    canUseFeature: (key) => {
      switch (key) {
        case 'premium_templates':
          return features.premiumTemplates;
        case 'ai_images':
          return features.aiImageGeneration && usage.aiImages.used < usage.aiImages.limit;
        case 'cover_generation':
          return features.coverGeneration;
        case 'marketplace_selling':
          return features.marketplaceSelling;
        case 'collaboration':
          return features.collaboration;
        case 'advanced_editor':
          return features.advancedEditor;
        case 'print_profiles':
          return features.printProfiles;
        case 'custom_domain':
          return features.customDomain;
        default:
          return true;
      }
    },
    upgradeReason: (key) => {
      switch (key) {
        case 'ai':
          return `You've used ${usage.aiCredits.used} of ${usage.aiCredits.limit} AI credits this period.`;
        case 'ai-images':
          return `You've used ${usage.aiImages.used} of ${usage.aiImages.limit} AI image credits.`;
        case 'book':
          return `Your ${plan.name} plan includes ${features.maxBooks} book projects.`;
        case 'storage':
          return 'Your asset storage is nearly full.';
        case 'premium_templates':
          return 'Premium templates are included with Pro and Business.';
        case 'print_profiles':
          return 'Print profiles with bleed, gutter and crop marks are a Pro feature.';
        case 'cover_generation':
          return 'AI cover generation is available on Pro and Business.';
        case 'marketplace_selling':
          return 'Selling in the marketplace is available on Pro and Business.';
        case 'collaboration':
          return 'Inviting editors and viewers is available on Pro and Business.';
        case 'advanced_editor':
          return 'Design mode, layers and canvas tools are available on Pro and Business.';
        case 'custom_domain':
          return 'Custom author domains are part of the Business plan.';
        default:
          return `The ${key.toUpperCase()} export format is not included in your ${plan.name} plan.`;
      }
    },
  };
}

/** Convenience helpers used by non-React code paths. */
export function entitlementsFor(userId: ID | undefined) {
  return buildEntitlements(userRepo.find(userId));
}
