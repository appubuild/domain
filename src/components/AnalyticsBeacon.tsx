/**
 * Records page views and outbound intent events through the first-party API.
 *
 *  · `page_view` on every route change
 *  · `service_click` when a visitor follows a service link
 *  · `call_click` when a visitor taps a `tel:` link
 *
 * It deliberately records *clicks*, not connected calls. A connected call only
 * exists when the call-tracking network reports one — see the admin analytics
 * endpoints. Collection is disabled without an API base URL and honours Do Not
 * Track.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { API_ENABLED } from '@/lib/api/client'
import { getLiveDirectory } from '@/lib/api/bootstrapContent'
import { trackCallClick, trackPageView, trackServiceClick } from '@/lib/api/analytics'

const SERVICE_PATH = /^\/services\/([^/?#]+)$/

const AnalyticsBeacon = () => {
  const location = useLocation()

  // Page views (the admin console is not part of the public analytics)
  useEffect(() => {
    if (!API_ENABLED || location.pathname.startsWith('/admin')) return
    trackPageView(location.pathname)
  }, [location.pathname])

  // Clicks on service links and tel: links
  useEffect(() => {
    if (!API_ENABLED || location.pathname.startsWith('/admin')) return

    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return

      const href = anchor.getAttribute('href') ?? ''
      const directory = getLiveDirectory()

      if (href.startsWith('tel:')) {
        const digits = href.replace(/\D/g, '').replace(/^1/, '')
        const record = directory?.numberIndex[digits]
        const slugFromPath = location.pathname.match(SERVICE_PATH)?.[1]
        const serviceSlug = record?.serviceSlug ?? slugFromPath

        trackCallClick({
          serviceId: serviceSlug ? (directory?.serviceIds[serviceSlug] ?? null) : null,
          phoneNumberId: record?.id ?? null,
          path: location.pathname,
        })
        return
      }

      const serviceMatch = href.match(SERVICE_PATH)
      if (serviceMatch?.[1]) {
        const slug = serviceMatch[1]
        trackServiceClick(directory?.serviceIds[slug] ?? null, href)
      }
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [location.pathname])

  return null
}

export default AnalyticsBeacon
