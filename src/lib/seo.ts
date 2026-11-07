import { useEffect } from 'react'
import { SITE } from '@/config/site'

type MetaKind = 'name' | 'property'

const upsertMeta = (kind: MetaKind, key: string, content: string): void => {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${kind}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(kind, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

const upsertLink = (rel: string, href: string): void => {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!tag) {
    tag = document.createElement('link')
    tag.setAttribute('rel', rel)
    document.head.appendChild(tag)
  }
  tag.setAttribute('href', href)
}

export interface SeoOptions {
  title: string
  description: string
  /** Route path beginning with a slash, e.g. "/services/roofing". */
  path: string
  image?: string
  type?: 'website' | 'article'
  noindex?: boolean
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

const absoluteUrl = (pathOrUrl: string): string =>
  pathOrUrl.startsWith('http') ? pathOrUrl : `${SITE.url}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`

/** Sets document title, description, canonical, Open Graph, Twitter and JSON-LD. */
export const useSeo = ({
  title,
  description,
  path,
  image = SITE.seo.defaultImage,
  type = 'website',
  noindex = false,
  jsonLd,
}: SeoOptions): void => {
  useEffect(() => {
    const fullTitle = title.includes(SITE.name) ? title : SITE.seo.titleTemplate.replace('%s', title)
    const canonical = absoluteUrl(path)
    const imageUrl = absoluteUrl(image)

    document.title = fullTitle
    upsertMeta('name', 'description', description)
    upsertLink('canonical', canonical)
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow')

    upsertMeta('property', 'og:type', type)
    upsertMeta('property', 'og:site_name', SITE.name)
    upsertMeta('property', 'og:title', fullTitle)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', canonical)
    upsertMeta('property', 'og:image', imageUrl)

    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', fullTitle)
    upsertMeta('name', 'twitter:description', description)
    upsertMeta('name', 'twitter:image', imageUrl)

    const scriptId = 'shn-jsonld'
    const existing = document.getElementById(scriptId)
    if (jsonLd) {
      const script = (existing as HTMLScriptElement | null) ?? document.createElement('script')
      script.id = scriptId
      script.type = 'application/ld+json'
      script.textContent = JSON.stringify(jsonLd)
      if (!existing) document.head.appendChild(script)
    } else if (existing) {
      existing.remove()
    }

    return () => {
      // Leave the last route's metadata in place on unmount — the next route
      // immediately overwrites it, and this avoids a flash of default tags.
    }
  }, [title, description, path, image, type, noindex, jsonLd])
}

export const organizationJsonLd = (): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE.name,
  url: SITE.url,
  description: SITE.modelStatement,
  logo: absoluteUrl('/favicon.svg'),
})

export const websiteJsonLd = (): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE.name,
  url: SITE.url,
})

export const breadcrumbJsonLd = (items: { name: string; path: string }[]): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
})

export const faqJsonLd = (faqs: { question: string; answer: string }[]): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
})
