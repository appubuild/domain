<?php
/**
 * API v1 route table.
 *
 * Format: [METHOD, PATH, [Controller::class, 'method'], [middleware…]]
 *
 * Middleware:
 *   auth       — valid session cookie or bearer token
 *   csrf       — X-CSRF-Token required for cookie-authenticated writes
 *   role:X     — minimum role (viewer < editor < admin < owner)
 *   rate:X     — fixed-window throttle, see config/application.php
 *
 * Literal routes must precede parameterised ones (`/services/mapping` before
 * `/services/{id}`) because the router matches in declaration order.
 */

declare(strict_types=1);

use Shn\Controllers\AdminActivityController;
use Shn\Controllers\AdminAnalyticsController;
use Shn\Controllers\AdminBlogController;
use Shn\Controllers\AdminDashboardController;
use Shn\Controllers\AdminFaqController;
use Shn\Controllers\AdminHomepageController;
use Shn\Controllers\AdminLeadController;
use Shn\Controllers\AdminMediaController;
use Shn\Controllers\AdminPageController;
use Shn\Controllers\AdminPhoneNumberController;
use Shn\Controllers\AdminServiceController;
use Shn\Controllers\AdminSettingController;
use Shn\Controllers\AdminTaxonomyController;
use Shn\Controllers\AdminTeamController;
use Shn\Controllers\AuthController;
use Shn\Controllers\PublicAnalyticsController;
use Shn\Controllers\PublicContentController;
use Shn\Controllers\PublicLeadController;
use Shn\Controllers\PublicServiceController;

$write = ['auth', 'csrf'];

return [
    /* ------------------------------------------------------------------ */
    /*  Public                                                            */
    /* ------------------------------------------------------------------ */

    ['GET', '/v1/health', [PublicContentController::class, 'health'], ['rate:read']],

    ['GET', '/v1/services', [PublicServiceController::class, 'index'], ['rate:read']],
    ['GET', '/v1/services/{slug}', [PublicServiceController::class, 'show'], ['rate:read']],
    ['GET', '/v1/services/{slug}/numbers', [PublicServiceController::class, 'numbers'], ['rate:read']],
    ['GET', '/v1/categories', [PublicServiceController::class, 'categories'], ['rate:read']],
    ['GET', '/v1/niches', [PublicServiceController::class, 'niches'], ['rate:read']],
    ['GET', '/v1/phone-groups', [PublicServiceController::class, 'phoneGroups'], ['rate:read']],

    ['GET', '/v1/pages', [PublicContentController::class, 'pages'], ['rate:read']],
    ['GET', '/v1/pages/{slug}', [PublicContentController::class, 'page'], ['rate:read']],

    ['GET', '/v1/blog/categories', [PublicContentController::class, 'blogCategories'], ['rate:read']],
    ['GET', '/v1/blog/tags', [PublicContentController::class, 'blogTags'], ['rate:read']],
    ['GET', '/v1/blog', [PublicContentController::class, 'posts'], ['rate:read']],
    ['GET', '/v1/blog/{slug}', [PublicContentController::class, 'post'], ['rate:read']],

    ['GET', '/v1/homepage', [PublicContentController::class, 'homepage'], ['rate:read']],
    ['GET', '/v1/faqs', [PublicContentController::class, 'faqs'], ['rate:read']],
    ['GET', '/v1/settings', [PublicContentController::class, 'settings'], ['rate:read']],
    ['GET', '/v1/integrations', [PublicContentController::class, 'integrations'], ['rate:read']],
    ['GET', '/v1/seo', [PublicContentController::class, 'seo'], ['rate:read']],
    ['GET', '/v1/sitemap', [PublicContentController::class, 'sitemap'], ['rate:read']],

    ['POST', '/v1/leads', [PublicLeadController::class, 'store'], ['rate:lead']],
    ['POST', '/v1/analytics/events', [PublicAnalyticsController::class, 'store'], ['rate:analytics']],

    /* ------------------------------------------------------------------ */
    /*  Auth                                                              */
    /* ------------------------------------------------------------------ */

    ['POST', '/v1/auth/login', [AuthController::class, 'login'], ['rate:login']],
    ['POST', '/v1/auth/logout', [AuthController::class, 'logout'], $write],
    ['GET', '/v1/auth/session', [AuthController::class, 'session'], ['auth']],
    ['PATCH', '/v1/auth/profile', [AuthController::class, 'updateProfile'], $write],
    ['POST', '/v1/auth/password', [AuthController::class, 'changePassword'], $write],
    ['GET', '/v1/auth/sessions', [AuthController::class, 'sessions'], ['auth']],
    ['DELETE', '/v1/auth/sessions/{id}', [AuthController::class, 'revokeSession'], $write],
    ['POST', '/v1/auth/password/forgot', [AuthController::class, 'forgotPassword'], ['rate:password_reset']],
    ['POST', '/v1/auth/password/reset', [AuthController::class, 'resetPassword'], ['rate:password_reset']],

    /* ------------------------------------------------------------------ */
    /*  Admin — dashboard & audit                                          */
    /* ------------------------------------------------------------------ */

    ['GET', '/v1/admin/dashboard', [AdminDashboardController::class, 'summary'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/activity', [AdminActivityController::class, 'index'], ['auth', 'role:viewer']],

    /* ------------------------------ services -------------------------- */

    ['GET', '/v1/admin/services/mapping', [AdminServiceController::class, 'mapping'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/services', [AdminServiceController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/services', [AdminServiceController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/services/{id}', [AdminServiceController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/services/{id}', [AdminServiceController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/services/{id}', [AdminServiceController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/services/{id}/restore', [AdminServiceController::class, 'restore'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/services/{id}/groups', [AdminServiceController::class, 'syncGroups'], ['auth', 'csrf', 'role:editor']],

    /* --------------------------- phone numbers ------------------------ */

    ['GET', '/v1/admin/phone-numbers', [AdminPhoneNumberController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/phone-numbers', [AdminPhoneNumberController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/phone-numbers/{id}', [AdminPhoneNumberController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/phone-numbers/{id}', [AdminPhoneNumberController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/phone-numbers/{id}', [AdminPhoneNumberController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/phone-numbers/{id}/restore', [AdminPhoneNumberController::class, 'restore'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/phone-numbers/{id}/verify', [AdminPhoneNumberController::class, 'verify'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/phone-numbers/{id}/services', [AdminPhoneNumberController::class, 'services'], ['auth', 'role:viewer']],

    /* ----------------------------- taxonomy --------------------------- */

    ['GET', '/v1/admin/categories', [AdminTaxonomyController::class, 'categories'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/categories', [AdminTaxonomyController::class, 'storeCategory'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/categories/{id}', [AdminTaxonomyController::class, 'updateCategory'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/categories/{id}', [AdminTaxonomyController::class, 'destroyCategory'], ['auth', 'csrf', 'role:editor']],

    ['GET', '/v1/admin/niches', [AdminTaxonomyController::class, 'niches'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/niches', [AdminTaxonomyController::class, 'storeNiche'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/niches/{id}', [AdminTaxonomyController::class, 'showNiche'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/niches/{id}', [AdminTaxonomyController::class, 'updateNiche'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/niches/{id}', [AdminTaxonomyController::class, 'destroyNiche'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/niches/{id}/restore', [AdminTaxonomyController::class, 'restoreNiche'], ['auth', 'csrf', 'role:editor']],

    ['GET', '/v1/admin/phone-groups', [AdminTaxonomyController::class, 'groups'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/phone-groups', [AdminTaxonomyController::class, 'storeGroup'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/phone-groups/{id}', [AdminTaxonomyController::class, 'updateGroup'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/phone-groups/{id}', [AdminTaxonomyController::class, 'destroyGroup'], ['auth', 'csrf', 'role:admin']],

    /* ------------------------------ pages ----------------------------- */

    ['GET', '/v1/admin/pages', [AdminPageController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/pages', [AdminPageController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/pages/{id}', [AdminPageController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/pages/{id}', [AdminPageController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/pages/{id}', [AdminPageController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/pages/{id}/restore', [AdminPageController::class, 'restore'], ['auth', 'csrf', 'role:editor']],

    /* ------------------------------- blog ----------------------------- */

    ['GET', '/v1/admin/blog/categories', [AdminBlogController::class, 'categories'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/blog/categories', [AdminBlogController::class, 'storeCategory'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/blog/categories/{id}', [AdminBlogController::class, 'updateCategory'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/blog/categories/{id}', [AdminBlogController::class, 'destroyCategory'], ['auth', 'csrf', 'role:editor']],

    ['GET', '/v1/admin/blog/tags', [AdminBlogController::class, 'tags'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/blog/tags', [AdminBlogController::class, 'storeTag'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/blog/tags/{id}', [AdminBlogController::class, 'updateTag'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/blog/tags/{id}', [AdminBlogController::class, 'destroyTag'], ['auth', 'csrf', 'role:editor']],

    ['GET', '/v1/admin/blog', [AdminBlogController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/blog', [AdminBlogController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/blog/{id}', [AdminBlogController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/blog/{id}', [AdminBlogController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/blog/{id}', [AdminBlogController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],
    ['POST', '/v1/admin/blog/{id}/restore', [AdminBlogController::class, 'restore'], ['auth', 'csrf', 'role:editor']],

    /* ----------------------------- homepage --------------------------- */

    ['PUT', '/v1/admin/homepage-sections/order', [AdminHomepageController::class, 'reorder'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/homepage-sections', [AdminHomepageController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/homepage-sections', [AdminHomepageController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/homepage-sections/{id}', [AdminHomepageController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/homepage-sections/{id}', [AdminHomepageController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/homepage-sections/{id}', [AdminHomepageController::class, 'destroy'], ['auth', 'csrf', 'role:admin']],

    /* -------------------------------- FAQ ----------------------------- */

    ['GET', '/v1/admin/faq-groups', [AdminFaqController::class, 'groups'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/faq-groups', [AdminFaqController::class, 'storeGroup'], ['auth', 'csrf', 'role:editor']],
    ['PUT', '/v1/admin/faq-groups/{id}', [AdminFaqController::class, 'updateGroup'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/faq-groups/{id}', [AdminFaqController::class, 'destroyGroup'], ['auth', 'csrf', 'role:admin']],

    ['GET', '/v1/admin/faqs', [AdminFaqController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/faqs', [AdminFaqController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['GET', '/v1/admin/faqs/{id}', [AdminFaqController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/faqs/{id}', [AdminFaqController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/faqs/{id}', [AdminFaqController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],

    /* ----------------------------- settings --------------------------- */

    ['GET', '/v1/admin/settings', [AdminSettingController::class, 'index'], ['auth', 'role:admin']],
    ['PUT', '/v1/admin/settings', [AdminSettingController::class, 'update'], ['auth', 'csrf', 'role:admin']],
    ['GET', '/v1/admin/settings/seo', [AdminSettingController::class, 'seo'], ['auth', 'role:admin']],
    ['PUT', '/v1/admin/settings/seo', [AdminSettingController::class, 'updateSeo'], ['auth', 'csrf', 'role:admin']],
    ['POST', '/v1/admin/settings/integrations/preview', [AdminSettingController::class, 'integrationPreview'], ['auth', 'csrf', 'role:admin']],

    /* ------------------------------- leads ---------------------------- */

    ['GET', '/v1/admin/leads/stats', [AdminLeadController::class, 'stats'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/leads', [AdminLeadController::class, 'index'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/leads/{id}', [AdminLeadController::class, 'show'], ['auth', 'role:viewer']],
    ['PUT', '/v1/admin/leads/{id}', [AdminLeadController::class, 'update'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/leads/{id}', [AdminLeadController::class, 'destroy'], ['auth', 'csrf', 'role:admin']],

    /* ----------------------------- analytics -------------------------- */

    ['GET', '/v1/admin/analytics/overview', [AdminAnalyticsController::class, 'overview'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/timeseries', [AdminAnalyticsController::class, 'timeseries'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/sources', [AdminAnalyticsController::class, 'sources'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/referrers', [AdminAnalyticsController::class, 'referrers'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/landing-pages', [AdminAnalyticsController::class, 'landingPages'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/campaigns', [AdminAnalyticsController::class, 'campaigns'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/services', [AdminAnalyticsController::class, 'services'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/numbers', [AdminAnalyticsController::class, 'numbers'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/devices', [AdminAnalyticsController::class, 'devices'], ['auth', 'role:viewer']],
    ['GET', '/v1/admin/analytics/daily', [AdminAnalyticsController::class, 'daily'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/analytics/rebuild', [AdminAnalyticsController::class, 'rebuild'], ['auth', 'csrf', 'role:admin']],

    ['GET', '/v1/admin/calls', [AdminAnalyticsController::class, 'calls'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/calls', [AdminAnalyticsController::class, 'storeCall'], ['auth', 'csrf', 'role:admin']],
    ['GET', '/v1/admin/revenue', [AdminAnalyticsController::class, 'revenue'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/revenue', [AdminAnalyticsController::class, 'storeRevenue'], ['auth', 'csrf', 'role:admin']],

    /* ------------------------------ media ----------------------------- */

    ['GET', '/v1/admin/media', [AdminMediaController::class, 'index'], ['auth', 'role:viewer']],
    ['POST', '/v1/admin/media', [AdminMediaController::class, 'store'], ['auth', 'csrf', 'role:editor']],
    ['DELETE', '/v1/admin/media/{id}', [AdminMediaController::class, 'destroy'], ['auth', 'csrf', 'role:editor']],

    /* ------------------------------- team ----------------------------- */

    ['GET', '/v1/admin/team', [AdminTeamController::class, 'index'], ['auth', 'role:admin']],
    ['POST', '/v1/admin/team', [AdminTeamController::class, 'store'], ['auth', 'csrf', 'role:admin']],
    ['PUT', '/v1/admin/team/{id}', [AdminTeamController::class, 'update'], ['auth', 'csrf', 'role:admin']],
    ['DELETE', '/v1/admin/team/{id}', [AdminTeamController::class, 'destroy'], ['auth', 'csrf', 'role:admin']],
];
