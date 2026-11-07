/**
 * Hydrates the site's bundled content from the PHP API.
 *
 * The React components keep importing the same modules they always have
 * (`@/config/services`, `@/data/serviceNumbers`, …). When an API base URL is
 * configured those modules are refreshed in place from the database, so the UI
 * renders published content without a component rewrite. When the variable is
 * absent — or the request fails — the bundled content stays in place and the
 * site behaves exactly as it did before, including on plain static hosting.
 */
import type { FaqItem } from '@/types'
import { hydrateServices } from '@/config/services'
import { hydrateServicePhoneNumbers } from '@/data/serviceNumbers'
import { hydrateCallDirectory, hydrateServiceNumberMap } from '@/data/serviceNumberMapping'
import { hydrateSite } from '@/config/site'
import { hydrateFaqs } from '@/config/faqs'
import { API_ENABLED } from './client'
import {
  fetchGroupIndex,
  fetchIntegrations,
  fetchPublicFaqs,
  fetchPublicSeo,
  fetchPublicSettings,
  fetchServiceDirectory,
  mapCategory,
  mapDirectory,
  mapService,
  mapSettingsToSitePatch,
  type LiveDirectory,
} from './publicContent'
import { setIntegrations, setPublicSeo } from './runtimeConfig'

export type ContentSource = 'bundled' | 'loading' | 'api' | 'fallback'

export interface ContentState {
  source: ContentSource
  error: string | null
  loadedAt: string | null
}

let state: ContentState = {
  source: API_ENABLED ? 'loading' : 'bundled',
  error: null,
  loadedAt: null,
}

let directory: LiveDirectory | null = null
let inFlight: Promise<ContentState> | null = null

const listeners = new Set<(next: ContentState) => void>()

const setState = (patch: Partial<ContentState>): void => {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener(state))
}

export const getContentState = (): ContentState => state

export const subscribeContent = (listener: (next: ContentState) => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Numbers and ids the analytics beacon needs to describe a call click. */
export const getLiveDirectory = (): LiveDirectory | null => directory

const toFaqItems = (group: { faqs: { question: string; answer: string }[] } | undefined): FaqItem[] =>
  (group?.faqs ?? [])
    .filter((faq) => Boolean(faq.question && faq.answer))
    .map((faq) => ({ question: faq.question, answer: faq.answer }))

/**
 * Loads everything the public site needs. Safe to call more than once: the
 * promise is shared and successful hydration happens once.
 */
export const ensureApiContent = (): Promise<ContentState> => {
  if (!API_ENABLED) {
    setState({ source: 'bundled' })
    return Promise.resolve(state)
  }
  if (inFlight) return inFlight

  setState({ source: 'loading', error: null })

  inFlight = (async (): Promise<ContentState> => {
    const [serviceResult, groupResult, settingsResult, faqResult, integrationResult, seoResult] =
      await Promise.allSettled([
        fetchServiceDirectory(),
        fetchGroupIndex(),
        fetchPublicSettings(),
        fetchPublicFaqs(),
        fetchIntegrations(),
        fetchPublicSeo(),
      ])

    let hydratedAnything = false
    const errors: string[] = []

    if (serviceResult.status === 'fulfilled' && serviceResult.value.services.length > 0) {
      const services = serviceResult.value.services.map(mapService)
      const categories = serviceResult.value.categories.map(mapCategory)
      hydrateServices(services, categories)

      directory = mapDirectory(serviceResult.value.services)
      hydrateServicePhoneNumbers(directory.groups)
      hydrateServiceNumberMap(directory.mapping)
      hydratedAnything = true
    } else if (serviceResult.status === 'rejected') {
      errors.push(`services: ${(serviceResult.reason as Error)?.message ?? 'failed'}`)
    }

    // The picker lists every group, including ones with no published number.
    if (groupResult.status === 'fulfilled' && directory && groupResult.value.length > 0) {
      const groups = groupResult.value
      hydrateCallDirectory(
        groups
          .filter((group) => group.has_active_numbers)
          .map((group) => {
            const mapped = directory?.directory.find((entry) => entry.groupId === group.id)
            return {
              groupId: group.id,
              label: group.label ?? group.name,
              blurb: group.blurb ?? mapped?.blurb ?? '',
              icon: group.icon ?? mapped?.icon ?? 'wrench',
              serviceSlug: mapped?.serviceSlug,
            }
          }),
      )
    } else if (groupResult.status === 'rejected') {
      errors.push(`phone groups: ${(groupResult.reason as Error)?.message ?? 'failed'}`)
    }

    if (settingsResult.status === 'fulfilled') {
      hydrateSite(mapSettingsToSitePatch(settingsResult.value))
      hydratedAnything = true
    } else {
      errors.push(`settings: ${(settingsResult.reason as Error)?.message ?? 'failed'}`)
    }

    if (faqResult.status === 'fulfilled') {
      const byId = new Map(faqResult.value.map((group) => [group.id, group]))
      hydrateFaqs({
        home: toFaqItems(byId.get('home')),
        howItWorks: toFaqItems(byId.get('howItWorks') ?? byId.get('how-it-works')),
      })
    } else {
      errors.push(`faqs: ${(faqResult.reason as Error)?.message ?? 'failed'}`)
    }

    if (integrationResult.status === 'fulfilled') {
      setIntegrations(integrationResult.value)
    } else {
      errors.push(`integrations: ${(integrationResult.reason as Error)?.message ?? 'failed'}`)
    }

    if (seoResult.status === 'fulfilled') {
      setPublicSeo(seoResult.value)
    }

    const next: ContentState = {
      source: hydratedAnything ? 'api' : 'fallback',
      error: errors.length > 0 ? errors.join(' · ') : null,
      loadedAt: new Date().toISOString(),
    }

    setState(next)

    if (errors.length > 0 && import.meta.env.DEV) {
      // Visible during development only; visitors never see console noise.
      console.warn('[content] API partially unavailable, using bundled copy for those sections:', errors)
    }

    return next
  })()

  return inFlight
}
