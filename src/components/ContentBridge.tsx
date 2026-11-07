/**
 * Bridges the bundled site to the PHP API.
 *
 *  · loads published content once (services, numbers, settings, FAQs)
 *  · injects the Google verification meta tag and any approved tracking snippet
 *
 * Renders nothing. When `VITE_API_BASE_URL` is not set it is inert, so a static
 * build behaves exactly as before.
 */
import { useEffect } from 'react'
import { API_ENABLED } from '@/lib/api/client'
import { ensureApiContent } from '@/lib/api/bootstrapContent'
import { getIntegrations, isSafeSnippet, subscribeRuntimeConfig } from '@/lib/api/runtimeConfig'

const INJECTED_ATTR = 'data-shn-injected'

const markInjected = (element: Element): void => {
  element.setAttribute(INJECTED_ATTR, 'true')
}

const alreadyInjected = (slot: string): boolean =>
  Boolean(document.querySelector(`[${INJECTED_ATTR}="${slot}"]`))

/**
 * Appends a validated snippet to the document, executing scripts the way the
 * browser expects (setting textContent on a freshly created script element).
 */
const injectSnippet = (snippet: string, target: 'head' | 'body', slot: string): void => {
  if (!isSafeSnippet(snippet)) return

  const template = document.createElement('template')
  template.innerHTML = snippet

  Array.from(template.content.childNodes).forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element

    if (element.tagName === 'SCRIPT') {
      const script = document.createElement('script')
      Array.from(element.attributes).forEach((attribute) => {
        script.setAttribute(attribute.name, attribute.value)
      })
      script.text = element.textContent ?? ''
      markInjected(script)
      script.setAttribute(INJECTED_ATTR, slot)
      ;(target === 'head' ? document.head : document.body).appendChild(script)
      return
    }

    const clone = element.cloneNode(true)
    if (clone instanceof Element) {
      markInjected(clone)
      clone.setAttribute(INJECTED_ATTR, slot)
    }
    ;(target === 'head' ? document.head : document.body).appendChild(clone)
  })
}

/** Standard gtag bootstrap for a validated G- measurement id. */
const injectMeasurementId = (measurementId: string): void => {
  if (!/^G-[A-Z0-9]{4,12}$/i.test(measurementId) || alreadyInjected('ga4')) return

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  script.setAttribute(INJECTED_ATTR, 'ga4')
  document.head.appendChild(script)

  const inline = document.createElement('script')
  inline.text = [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('config', ${JSON.stringify(measurementId)});`,
  ].join('\n')
  inline.setAttribute(INJECTED_ATTR, 'ga4')
  document.head.appendChild(inline)
}

const applyIntegrations = (): void => {
  if (!API_ENABLED) return
  const integrations = getIntegrations()
  if (!integrations) return

  if (integrations.google_verification && !document.head.querySelector('meta[name="google-site-verification"]')) {
    const meta = document.createElement('meta')
    meta.name = 'google-site-verification'
    meta.content = integrations.google_verification
    meta.setAttribute(INJECTED_ATTR, 'verification')
    document.head.appendChild(meta)
  }

  if (integrations.analytics_id && /^G-/i.test(integrations.analytics_id)) {
    injectMeasurementId(integrations.analytics_id)
  }

  if (integrations.header_scripts && !alreadyInjected('header-snippet')) {
    injectSnippet(integrations.header_scripts, 'head', 'header-snippet')
  }

  if (integrations.footer_scripts && !alreadyInjected('footer-snippet')) {
    injectSnippet(integrations.footer_scripts, 'body', 'footer-snippet')
  }
}

const ContentBridge = () => {
  useEffect(() => {
    if (!API_ENABLED) return
    void ensureApiContent()
  }, [])

  useEffect(() => {
    if (!API_ENABLED) return
    applyIntegrations()
    return subscribeRuntimeConfig(() => applyIntegrations())
  }, [])

  return null
}

export default ContentBridge
