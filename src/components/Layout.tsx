import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { BackToTop } from '@/components/BackToTop'
import { CookieConsent } from '@/components/CookieConsent'

/** Restores scroll position on navigation (but not on hash links). */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.replace('#', ''))
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname, hash])

  return null
}

export const Layout = () => (
  <div className="flex min-h-dvh flex-col bg-page">
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
    >
      Skip to main content
    </a>
    <ScrollToTop />
    <Header />
    <main id="main-content" className="flex-1">
      <Outlet />
    </main>
    <Footer />
    <BackToTop />
    <CookieConsent />
  </div>
)
