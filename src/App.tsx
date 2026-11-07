import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/components/ThemeProvider'
import { CallSheetProvider } from '@/components/calls/CallContext'
import { Layout } from '@/components/Layout'
import Home from '@/pages/Home'
import About from '@/pages/About'
import Services from '@/pages/Services'
import ServiceDetail from '@/pages/ServiceDetail'
import HowItWorks from '@/pages/HowItWorks'
import Contact from '@/pages/Contact'
import ServiceArea from '@/pages/ServiceArea'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import TermsAndConditions from '@/pages/TermsAndConditions'
import Disclaimer from '@/pages/Disclaimer'
import DoNotSellOrShare from '@/pages/DoNotSellOrShare'
import Accessibility from '@/pages/Accessibility'
import NotFound from '@/pages/NotFound'

/** The admin console is a separate chunk: public visitors never download it. */
const AdminApp = lazy(() => import('@/admin/AdminApp'))

const AdminLoadingFallback = () => (
  <div className="flex min-h-dvh items-center justify-center bg-page">
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-600" aria-hidden="true" />
      <p className="text-sm font-medium text-muted">Loading admin console…</p>
    </div>
  </div>
)

const App = () => (
  <ThemeProvider>
    <CallSheetProvider>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<AdminLoadingFallback />}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:slug" element={<ServiceDetail />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/service-area" element={<ServiceArea />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
          <Route path="/disclaimer" element={<Disclaimer />} />
          <Route path="/do-not-sell-or-share" element={<DoNotSellOrShare />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </CallSheetProvider>
  </ThemeProvider>
)

export default App
