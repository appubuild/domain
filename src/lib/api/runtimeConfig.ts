/**
 * Runtime configuration published by the API (tracking + verification codes,
 * SEO defaults). Kept outside React so both the document head and the admin
 * preview can read it without prop-drilling.
 *
 * Everything here is server-validated: the API only returns snippets that pass
 * its allow-list, and this module refuses anything that does not look like a
 * script/meta/link tag as a second line of defence.
 */
import type { ApiIntegrations, ApiPublicSeo } from './publicContent'

type Listener = () => void

let integrations: ApiIntegrations | null = null
let seo: ApiPublicSeo | null = null
const listeners = new Set<Listener>()

const notify = (): void => {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {
      /* a broken listener must not break the site */
    }
  })
}

export const setIntegrations = (next: ApiIntegrations | null): void => {
  integrations = next
  notify()
}

export const setPublicSeo = (next: ApiPublicSeo | null): void => {
  seo = next
  notify()
}

export const getIntegrations = (): ApiIntegrations | null => integrations

export const getPublicSeo = (): ApiPublicSeo | null => seo

export const subscribeRuntimeConfig = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Only script, meta, link, style and noscript tags may reach the document.
 * The API enforces the same rule; this stops a tampered response as well.
 */
export const isSafeSnippet = (snippet: string): boolean => {
  if (snippet.trim() === '') return false
  if (/<(script|meta|link|style|noscript)\b/i.test(snippet) === false) return false
  const tags = snippet.match(/<\s*([a-zA-Z][a-zA-Z0-9]*)/g) ?? []
  return tags.every((tag) => /<\s*(script|meta|link|style|noscript)$/i.test(tag.trim()))
}
