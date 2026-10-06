/**
 * Service layer entry point.
 *
 * UI → service → repository → mock database. Components never import
 * repositories directly, so Phase 2 can swap repositories for API clients
 * without touching a single screen.
 */
export { authService, AuthError } from './authService';
export { buildEntitlements, entitlementsFor, planFor } from './entitlements';
export type { Entitlements, FeatureKey, UsageSnapshot } from './entitlements';
export { bookService } from './bookService';
export { userService, UserError } from './userService';
export type { ProfilePatch } from './userService';
export { templateService } from './templateService';
export { aiService } from './aiService';
export type { AiAction, AiRequest, AiResponse, BookGenerationStep } from './aiService';
export { preflightService, spineWidthFor } from './preflightService';
export { exportService } from './exportService';
export { publishingService, PUBLISHING_STEPS } from './publishingService';
export { marketplaceService } from './marketplaceService';
export { revenueService, PERIODS } from './revenueService';
export { analyticsService } from './analyticsService';
export { subscriptionService } from './subscriptionService';
export { cmsService } from './cmsService';
export { adminService } from './adminService';
export { storageService, assetService, MockR2Provider } from './storageService';
export { notificationService, emailService } from './notificationService';
export { searchService } from './searchService';
export { assets as galleryAssets } from './seedUrlHelpers';
