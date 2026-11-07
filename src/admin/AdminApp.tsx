/**
 * Admin console entry point.
 *
 * Mounted from `App.tsx` at `/admin/*` and lazy-loaded, so none of this code is
 * downloaded by public visitors. All routes below require a demo session except
 * the sign-in screen.
 */
import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminAuthProvider, useAdminAuth } from '@/admin/context/AdminAuthContext'
import { ToastProvider } from '@/admin/context/ToastContext'
import { AdminLayout } from '@/admin/components/AdminLayout'
import { LoginPage } from '@/admin/pages/LoginPage'
import { DashboardPage } from '@/admin/pages/DashboardPage'
import { AnalyticsPage } from '@/admin/pages/AnalyticsPage'
import { ServicesPage } from '@/admin/pages/ServicesPage'
import { NumbersPage } from '@/admin/pages/NumbersPage'
import { NichesPage } from '@/admin/pages/NichesPage'
import { PagesPage } from '@/admin/pages/PagesPage'
import { BlogPage } from '@/admin/pages/BlogPage'
import { BlogEditorPage } from '@/admin/pages/BlogEditorPage'
import { PageEditorPage } from '@/admin/pages/PageEditorPage'
import { CategoriesPage } from '@/admin/pages/CategoriesPage'
import { PublishingPage } from '@/admin/pages/PublishingPage'
import { HomepagePage } from '@/admin/pages/HomepagePage'
import { LeadsPage } from '@/admin/pages/LeadsPage'
import { SettingsPage } from '@/admin/pages/SettingsPage'
import { SeoPage } from '@/admin/pages/SeoPage'
import { ProfilePage } from '@/admin/pages/ProfilePage'

/** Route guard: unauthenticated visitors are sent to the sign-in screen. */
const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAdminAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/** Signed-in visitors never see the login form again. */
const RedirectIfAuthenticated = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAdminAuth()
  if (isAuthenticated) return <Navigate to="/admin" replace />
  return <>{children}</>
}

const AdminDocumentEffects = () => {
  useEffect(() => {
    // The console must never be indexed, and it should not inherit the public
    // page title while it is open.
    const previousTitle = document.title
    document.title = 'Admin Console · Safe Home Network'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex,nofollow'
    meta.dataset.adminRobots = 'true'
    document.head.appendChild(meta)
    return () => {
      document.title = previousTitle
      meta.remove()
    }
  }, [])
  return null
}

export const AdminApp = () => (
  <AdminAuthProvider>
    <ToastProvider>
      <AdminDocumentEffects />
      <Routes>
        <Route
          path="login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="numbers" element={<NumbersPage />} />
          <Route path="niches" element={<NichesPage />} />
          <Route path="pages" element={<PagesPage />} />
          <Route path="pages/new" element={<PageEditorPage />} />
          <Route path="pages/:id" element={<PageEditorPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/new" element={<BlogEditorPage />} />
          <Route path="blog/:id" element={<BlogEditorPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="publishing" element={<PublishingPage />} />
          <Route path="homepage" element={<HomepagePage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="seo" element={<SeoPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </ToastProvider>
  </AdminAuthProvider>
)

export default AdminApp
