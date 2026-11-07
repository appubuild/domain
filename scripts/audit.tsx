/**
 * Static render audit — renders every route and checks internal links, in-page
 * anchors, image sources and duplicate IDs.
 *
 *   npm run audit
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

const ROUTES = [
  '/',
  '/about',
  '/services',
  '/how-it-works',
  '/contact',
  '/service-area',
  '/privacy-policy',
  '/terms-and-conditions',
  '/disclaimer',
  '/do-not-sell-or-share',
  '/accessibility',
]

const SERVICE_SLUGS = [
  'roofing',
  'roof-repair',
  'plumbing',
  'hvac',
  'ac-repair',
  'water-damage',
  'pest-control',
  'kitchen-remodeling',
  'bathroom-remodeling',
  'bedroom-remodeling',
  'electrical',
  'window-installation',
  'door-installation',
  'concrete-paving',
  'locksmith',
]

const ALL_ROUTES = [...ROUTES, ...SERVICE_SLUGS.map((slug) => `/services/${slug}`)]
const PUBLIC_DIR = resolve(process.cwd(), 'public')

/**
 * Copy that must never reach a public page: environment variable names, source
 * paths, launch reminders or sample-data labels.
 */
const BANNED_PUBLIC_COPY = [
  'VITE_',
  'src/config',
  'before launch',
  'EXAMPLE_',
  'example coverage',
  'sample dataset',
  'demo dataset',
  'ZIP code checker',
  'Check availability',
  'Enter your ZIP',
  'availability checker',
  'lorem ipsum',
  'not configured',
  'configuration required',
  'localhost',
  '127.0.0.1',
]

let problems = 0
const report = (route: string, message: string) => {
  problems += 1
  console.log(`  ✗ ${route} — ${message}`)
}

for (const route of ALL_ROUTES) {
  const html = renderToString(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )

  // Internal links must resolve to a known route.
  for (const match of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = match[1].replace(/\/$/, '') || '/'
    const known =
      ALL_ROUTES.includes(href) ||
      href === '/404' ||
      /^\/(images|assets)\//.test(href) ||
      ['/favicon.svg', '/sitemap.xml', '/robots.txt'].includes(href)
    if (!known) report(route, `unknown internal link ${href}`)
  }

  // In-page anchors need a matching id.
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(match[1])) report(route, `dead in-page anchor #${match[1]}`)
  }

  // Images must exist in /public.
  for (const match of html.matchAll(/src="(\/images\/[^"]+)"/g)) {
    if (!existsSync(resolve(PUBLIC_DIR, match[1].replace(/^\//, '')))) {
      report(route, `missing image ${match[1]}`)
    }
  }

  // Duplicate ids break label/aria references.
  const seen = new Set<string>()
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(match[1])) report(route, `duplicate id ${match[1]}`)
    seen.add(match[1])
  }

  // Every route should have exactly one h1.
  const h1Count = (html.match(/<h1/g) ?? []).length
  if (h1Count !== 1) report(route, `expected exactly one h1, found ${h1Count}`)

  // The ZIP / availability system is gone: no page may render a ZIP input.
  if (/name="zip"/i.test(html) || /id="zip"/i.test(html)) {
    report(route, 'ZIP input rendered')
  }

  // Phone numbers may only be printed on a service page, i.e. after the visitor
  // has selected a service. Listing pages show buttons, not numbers.
  const telLinks = [...html.matchAll(/href="(tel:[^"]+)"/g)].map((match) => match[1])
  if (!route.startsWith('/services/')) {
    if (telLinks.length > 0) {
      report(route, `${telLinks.length} tel: link(s) exposed before a service is selected`)
    }
  } else {
    if (!html.includes('Call Now')) report(route, 'service page is missing a Call Now button')
    if (!/Call Alternate/.test(html) && html.includes('Primary line')) {
      report(route, 'service page shows a primary line but no Call Alternate')
    }
  }

  // No developer-facing copy on a public page.
  const lowerHtml = html.toLowerCase()
  for (const banned of BANNED_PUBLIC_COPY) {
    if (lowerHtml.includes(banned.toLowerCase())) {
      report(route, `internal copy visible: "${banned}"`)
    }
  }
}

console.log(
  problems === 0
    ? `\nAudit passed: ${ALL_ROUTES.length} routes, no broken links, anchors, images or duplicate ids.`
    : `\n${problems} problem(s) found.`,
)
process.exit(problems === 0 ? 0 : 1)
