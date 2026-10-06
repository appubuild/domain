import * as React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useAdminSettings } from '@/hooks/queries';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { ForbiddenPage, MaintenancePage, NotFoundPage, ServerErrorPage } from '@/pages/states/StatePages';
import { Spinner } from '@/components/ui/primitives';

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      }
    >
      {children}
    </React.Suspense>
  );
}

const HomePage = React.lazy(() => import('@/pages/public/HomePage'));
const FeaturesPage = React.lazy(() => import('@/pages/public/FeaturesPage'));
const HowItWorksPage = React.lazy(() => import('@/pages/public/HowItWorksPage'));
const TemplatesPage = React.lazy(() => import('@/pages/public/TemplatesPage'));
const TemplateDetailPage = React.lazy(() => import('@/pages/public/TemplateDetailPage'));
const PricingPage = React.lazy(() => import('@/pages/public/PricingPage'));
const AiWritingPage = React.lazy(() => import('@/pages/public/AiWritingPage'));
const PublishingPage = React.lazy(() => import('@/pages/public/PublishingPage'));
const MarketplacePage = React.lazy(() => import('@/pages/public/MarketplacePage'));
const MarketplaceBookPage = React.lazy(() => import('@/pages/public/MarketplaceBookPage'));
const BooksPage = React.lazy(() => import('@/pages/public/BooksPage'));
const AuthorsPage = React.lazy(() => import('@/pages/public/AuthorsPage'));
const AuthorProfilePage = React.lazy(() => import('@/pages/public/AuthorProfilePage'));
const AboutPage = React.lazy(() => import('@/pages/public/AboutPage'));
const ContactPage = React.lazy(() => import('@/pages/public/ContactPage'));
const FaqPage = React.lazy(() => import('@/pages/public/FaqPage'));
const BlogPage = React.lazy(() => import('@/pages/public/BlogPage'));
const BlogPostPage = React.lazy(() => import('@/pages/public/BlogPostPage'));
const LoginPage = React.lazy(() => import('@/pages/public/LoginPage'));
const RegisterPage = React.lazy(() => import('@/pages/public/RegisterPage'));
const ForgotPasswordPage = React.lazy(() => import('@/pages/public/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('@/pages/public/ResetPasswordPage'));
const TermsPage = React.lazy(() => import('@/pages/public/TermsPage'));
const PrivacyPage = React.lazy(() => import('@/pages/public/PrivacyPage'));
const RefundPolicyPage = React.lazy(() => import('@/pages/public/RefundPolicyPage'));
const CopyrightPage = React.lazy(() => import('@/pages/public/CopyrightPage'));
const CommunityGuidelinesPage = React.lazy(() => import('@/pages/public/CommunityGuidelinesPage'));
const CmsPageBySlug = React.lazy(() => import('@/pages/public/PublicCmsPage'));
const ReaderPage = React.lazy(() => import('@/pages/public/ReaderPage'));

const DashboardHomePage = React.lazy(() => import('@/pages/dashboard/DashboardHomePage'));
const OnboardingPage = React.lazy(() => import('@/pages/dashboard/OnboardingPage'));
const BooksListPage = React.lazy(() => import('@/pages/dashboard/BooksListPage'));
const CreateBookPage = React.lazy(() => import('@/pages/dashboard/CreateBookPage'));
const BookOverviewPage = React.lazy(() => import('@/pages/dashboard/BookOverviewPage'));
const EditorPage = React.lazy(() => import('@/pages/editor/EditorPage'));
const AssetsPage = React.lazy(() => import('@/pages/dashboard/AssetsPage'));
const AiStudioPage = React.lazy(() => import('@/pages/dashboard/AiStudioPage'));
const TemplatesDashboardPage = React.lazy(() => import('@/pages/dashboard/TemplatesDashboardPage'));
const PublishingCentrePage = React.lazy(() => import('@/pages/dashboard/PublishingCentrePage'));
const ExportCentrePage = React.lazy(() => import('@/pages/dashboard/ExportCentrePage'));
const MyListingsPage = React.lazy(() => import('@/pages/dashboard/MyListingsPage'));
const EarningsPage = React.lazy(() => import('@/pages/dashboard/EarningsPage'));
const AnalyticsPage = React.lazy(() => import('@/pages/dashboard/AnalyticsPage'));
const ReviewsDashboardPage = React.lazy(() => import('@/pages/dashboard/ReviewsDashboardPage'));
const LibraryPage = React.lazy(() => import('@/pages/dashboard/LibraryPage'));
const WishlistPage = React.lazy(() => import('@/pages/dashboard/WishlistPage'));
const SubscriptionPage = React.lazy(() => import('@/pages/dashboard/SubscriptionPage'));
const SettingsPage = React.lazy(() => import('@/pages/dashboard/SettingsPage'));
const AuthorProfileEditorPage = React.lazy(() => import('@/pages/dashboard/AuthorProfileEditorPage'));
const NotificationsPage = React.lazy(() => import('@/pages/dashboard/NotificationsPage'));
const ActivityPage = React.lazy(() => import('@/pages/dashboard/ActivityPage'));
const DashboardSearchPage = React.lazy(() => import('@/pages/dashboard/SearchResultsPage'));

const AdminDashboardPage = React.lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminAnalyticsPage = React.lazy(() => import('@/pages/admin/AdminAnalyticsPage'));
const AdminUsersPage = React.lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminUserDetailPage = React.lazy(() => import('@/pages/admin/AdminUserDetailPage'));
const AdminAuthorsPage = React.lazy(() => import('@/pages/admin/AdminAuthorsPage'));
const AdminSubscriptionsPage = React.lazy(() => import('@/pages/admin/AdminSubscriptionsPage'));
const AdminBooksPage = React.lazy(() => import('@/pages/admin/AdminBooksPage'));
const AdminTemplatesPage = React.lazy(() => import('@/pages/admin/AdminTemplatesPage'));
const AdminCategoriesPage = React.lazy(() => import('@/pages/admin/AdminCategoriesPage'));
const AdminMarketplacePage = React.lazy(() => import('@/pages/admin/AdminMarketplacePage'));
const AdminOrdersPage = React.lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminRevenuePage = React.lazy(() => import('@/pages/admin/AdminRevenuePage'));
const AdminPlansPage = React.lazy(() => import('@/pages/admin/AdminPlansPage'));
const AdminReviewsPage = React.lazy(() => import('@/pages/admin/AdminReviewsPage'));
const AdminReportsPage = React.lazy(() => import('@/pages/admin/AdminReportsPage'));
const AdminCmsPage = React.lazy(() => import('@/pages/admin/AdminCmsPage'));
const AdminHomepagePage = React.lazy(() => import('@/pages/admin/AdminHomepagePage'));
const AdminPagesPage = React.lazy(() => import('@/pages/admin/AdminPagesPage'));
const AdminBlogPage = React.lazy(() => import('@/pages/admin/AdminBlogPage'));
const AdminPromotionsPage = React.lazy(() => import('@/pages/admin/AdminPromotionsPage'));
const AdminNotificationsPage = React.lazy(() => import('@/pages/admin/AdminNotificationsPage'));
const AdminAiPage = React.lazy(() => import('@/pages/admin/AdminAiPage'));
const AdminStoragePage = React.lazy(() => import('@/pages/admin/AdminStoragePage'));
const AdminFlagsPage = React.lazy(() => import('@/pages/admin/AdminFlagsPage'));
const AdminEmailPage = React.lazy(() => import('@/pages/admin/AdminEmailPage'));
const AdminSettingsPage = React.lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminAuditLogsPage = React.lazy(() => import('@/pages/admin/AdminAuditLogsPage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children, moderatorOnly = false }: { children: React.ReactNode; moderatorOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  const allowed = moderatorOnly ? user.role === 'admin' || user.role === 'moderator' : user.role === 'admin';
  if (!allowed) return <ForbiddenPage />;
  return <>{children}</>;
}

/** Blocks the authenticated app while an admin has switched maintenance mode on. */
function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { data: settings, isLoading } = useAdminSettings();
  const { user } = useAuth();
  if (isLoading) return <>{children}</>;
  if (settings?.general.maintenanceMode && user?.role !== 'admin') return <MaintenancePage />;
  return <>{children}</>;
}

export function AppRoutes() {
  const isMobile = useIsMobile();

  return (
    <Routes>
      {/* ------------------------------------------------------- public site */}
      <Route element={<PublicLayout />}>
        <Route index element={<Lazy><HomePage /></Lazy>} />
        <Route path="features" element={<Lazy><FeaturesPage /></Lazy>} />
        <Route path="how-it-works" element={<Lazy><HowItWorksPage /></Lazy>} />
        <Route path="templates" element={<Lazy><TemplatesPage /></Lazy>} />
        <Route path="templates/:slug" element={<Lazy><TemplateDetailPage /></Lazy>} />
        <Route path="pricing" element={<Lazy><PricingPage /></Lazy>} />
        <Route path="ai-writing" element={<Lazy><AiWritingPage /></Lazy>} />
        <Route path="publishing" element={<Lazy><PublishingPage /></Lazy>} />
        <Route path="marketplace" element={<Lazy><MarketplacePage /></Lazy>} />
        <Route path="marketplace/:bookId" element={<Lazy><MarketplaceBookPage /></Lazy>} />
        <Route path="books" element={<Lazy><BooksPage /></Lazy>} />
        <Route path="authors" element={<Lazy><AuthorsPage /></Lazy>} />
        <Route path="authors/:authorId" element={<Lazy><AuthorProfilePage /></Lazy>} />
        <Route path="about" element={<Lazy><AboutPage /></Lazy>} />
        <Route path="contact" element={<Lazy><ContactPage /></Lazy>} />
        <Route path="faq" element={<Lazy><FaqPage /></Lazy>} />
        <Route path="blog" element={<Lazy><BlogPage /></Lazy>} />
        <Route path="blog/:slug" element={<Lazy><BlogPostPage /></Lazy>} />
        <Route path="terms" element={<Lazy><TermsPage /></Lazy>} />
        <Route path="privacy" element={<Lazy><PrivacyPage /></Lazy>} />
        <Route path="refund-policy" element={<Lazy><RefundPolicyPage /></Lazy>} />
        <Route path="copyright" element={<Lazy><CopyrightPage /></Lazy>} />
        <Route path="community-guidelines" element={<Lazy><CommunityGuidelinesPage /></Lazy>} />
        <Route path="pages/:slug" element={<Lazy><CmsPageBySlug /></Lazy>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* --------------------------------------------------------- auth pages */}
      <Route path="/login" element={<Lazy><LoginPage /></Lazy>} />
      <Route path="/register" element={<Lazy><RegisterPage /></Lazy>} />
      <Route path="/forgot-password" element={<Lazy><ForgotPasswordPage /></Lazy>} />
      <Route path="/reset-password" element={<Lazy><ResetPasswordPage /></Lazy>} />

      {/* ------------------------------------------------------------- reader */}
      <Route path="/read/:bookId" element={<Lazy><ReaderPage /></Lazy>} />

      {/* ---------------------------------------------------------- dashboard */}
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <MaintenanceGate>
              <Lazy><OnboardingPage /></Lazy>
            </MaintenanceGate>
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <MaintenanceGate>
              <DashboardLayout />
            </MaintenanceGate>
          </RequireAuth>
        }
      >
        <Route index element={<Lazy><DashboardHomePage /></Lazy>} />
        <Route path="books" element={<Lazy><BooksListPage /></Lazy>} />
        <Route path="books/new" element={<Lazy><CreateBookPage /></Lazy>} />
        <Route path="books/:bookId" element={<Lazy><BookOverviewPage /></Lazy>} />
        <Route path="templates" element={<Lazy><TemplatesDashboardPage /></Lazy>} />
        <Route path="assets" element={<Lazy><AssetsPage /></Lazy>} />
        <Route path="ai" element={<Lazy><AiStudioPage /></Lazy>} />
        <Route path="publishing" element={<Lazy><PublishingCentrePage /></Lazy>} />
        <Route path="exports" element={<Lazy><ExportCentrePage /></Lazy>} />
        <Route path="marketplace" element={<Lazy><MyListingsPage /></Lazy>} />
        <Route path="earnings" element={<Lazy><EarningsPage /></Lazy>} />
        <Route path="analytics" element={<Lazy><AnalyticsPage /></Lazy>} />
        <Route path="reviews" element={<Lazy><ReviewsDashboardPage /></Lazy>} />
        <Route path="library" element={<Lazy><LibraryPage /></Lazy>} />
        <Route path="wishlist" element={<Lazy><WishlistPage /></Lazy>} />
        <Route path="subscription" element={<Lazy><SubscriptionPage /></Lazy>} />
        <Route path="settings" element={<Lazy><SettingsPage /></Lazy>} />
        <Route path="profile" element={<Lazy><AuthorProfileEditorPage /></Lazy>} />
        <Route path="notifications" element={<Lazy><NotificationsPage /></Lazy>} />
        <Route path="activity" element={<Lazy><ActivityPage /></Lazy>} />
        <Route path="search" element={<Lazy><DashboardSearchPage /></Lazy>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* -------------------------------------------------------- book editor */}
      <Route
        path="/dashboard/books/:bookId/editor"
        element={
          <RequireAuth>
            <MaintenanceGate>
              <Lazy><EditorPage /></Lazy>
            </MaintenanceGate>
          </RequireAuth>
        }
      />

      {/* --------------------------------------------------------------- admin */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin moderatorOnly>
              <AdminLayout />
            </RequireAdmin>
          </RequireAuth>
        }
      >
        <Route index element={<Lazy><AdminDashboardPage /></Lazy>} />
        <Route path="analytics" element={<Lazy><AdminAnalyticsPage /></Lazy>} />
        <Route path="users" element={<Lazy><AdminUsersPage /></Lazy>} />
        <Route path="users/:userId" element={<Lazy><AdminUserDetailPage /></Lazy>} />
        <Route path="authors" element={<Lazy><AdminAuthorsPage /></Lazy>} />
        <Route path="subscriptions" element={<Lazy><AdminSubscriptionsPage /></Lazy>} />
        <Route path="books" element={<Lazy><AdminBooksPage /></Lazy>} />
        <Route path="books/:bookId" element={<AdminBookRedirect />} />
        <Route path="templates" element={<Lazy><AdminTemplatesPage /></Lazy>} />
        <Route path="categories" element={<Lazy><AdminCategoriesPage /></Lazy>} />
        <Route path="marketplace" element={<Lazy><AdminMarketplacePage /></Lazy>} />
        <Route path="orders" element={<Lazy><AdminOrdersPage /></Lazy>} />
        <Route path="revenue" element={<Lazy><AdminRevenuePage /></Lazy>} />
        <Route path="plans" element={<Lazy><AdminPlansPage /></Lazy>} />
        <Route path="reviews" element={<Lazy><AdminReviewsPage /></Lazy>} />
        <Route path="reports" element={<Lazy><AdminReportsPage /></Lazy>} />
        <Route path="cms" element={<Lazy><AdminCmsPage /></Lazy>} />
        <Route path="cms/homepage" element={<Lazy><AdminHomepagePage /></Lazy>} />
        <Route path="cms/pages" element={<Lazy><AdminPagesPage /></Lazy>} />
        <Route path="blog" element={<Lazy><AdminBlogPage /></Lazy>} />
        <Route path="promotions" element={<Lazy><AdminPromotionsPage /></Lazy>} />
        <Route path="notifications" element={<Lazy><AdminNotificationsPage /></Lazy>} />
        <Route path="ai" element={<Lazy><AdminAiPage /></Lazy>} />
        <Route path="storage" element={<Lazy><AdminStoragePage /></Lazy>} />
        <Route path="flags" element={<Lazy><AdminFlagsPage /></Lazy>} />
        <Route path="email" element={<Lazy><AdminEmailPage /></Lazy>} />
        <Route path="settings" element={<Lazy><AdminSettingsPage /></Lazy>} />
        <Route path="audit-logs" element={<Lazy><AdminAuditLogsPage /></Lazy>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* -------------------------------------------------------- error states */}
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      <Route path="/maintenance" element={<MaintenancePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function AdminBookRedirect() {
  const location = useLocation();
  const bookId = location.pathname.split('/').pop();
  return <Navigate to={`/dashboard/books/${bookId}`} replace />;
}
