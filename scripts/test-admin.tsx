/**
 * Admin console test suite (Phase 1, static demo).
 *
 *   npm run test:admin
 *
 * Covers: demo authentication rules, protected-route rendering, repository CRUD
 * for every entity, the seeded mapping between services and tracking numbers,
 * analytics helpers, and the fact that the admin console is excluded from the
 * public site's routing.
 */
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/components/ThemeProvider'
import AdminApp from '@/admin/AdminApp'
import { ADMIN_CONFIG, DEMO_CREDENTIALS, storageKey } from '@/admin/config/adminConfig'
import { localRepository, repository } from '@/admin/data/repository'
import { resetAdminDemoData } from '@/admin/data/repository'
import { storage, writeJSON } from '@/admin/data/storage'
import {
  ANALYTICS_WINDOW_DAYS,
  DAILY_SERIES,
  changePercent,
  previousRangeFor,
  rangeFor,
  totalsFor,
} from '@/admin/data/analytics'
import { buildSeedWorkspace } from '@/admin/data/seed'
import { directoryHealth, groupName, numbersForService, roleLabel } from '@/admin/lib/selectors'
import { formatCurrency, formatNumber, initialsOf, titleCase } from '@/admin/lib/format'
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { SERVICE_NUMBER_MAP } from '@/data/serviceNumberMapping'
import { SERVICES } from '@/config/services'

let passed = 0
let failed = 0

const check = (label: string, condition: boolean, detail?: string): void => {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const section = (title: string): void => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)

// Mirrors the production mount point in App.tsx (`/admin/*`), so the admin's
// relative routes resolve exactly as they do in the browser.
const renderAdmin = (path: string): string =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )

const run = async (): Promise<void> => {
  /* ---------------------------------------------------------------------- */
  section('Demo authentication configuration')

  check('demo credentials match the agreed login', DEMO_CREDENTIALS.email === 'info@safehomenetwork.com' && DEMO_CREDENTIALS.password === 'Sa123456')
  check('demo mode is explicitly flagged', ADMIN_CONFIG.authMode === 'demo')
  check('demo notice discloses the limitation', ADMIN_CONFIG.demo.notice.toLowerCase().includes('browser bundle'))
  check('session length is defined', ADMIN_CONFIG.demo.sessionHours > 0)
  check('Phase 2 API is disabled', ADMIN_CONFIG.api.enabled === false)
  check('API base URL is an empty placeholder', ADMIN_CONFIG.api.baseUrl === '')
  check('repository runs in local (mock) mode', repository.mode === 'local')

  /* ---------------------------------------------------------------------- */
  section('Protected routes')

  storage.remove(storageKey(ADMIN_CONFIG.storage.session))

  const adminHtml = renderAdmin('/admin')
  check('an unauthenticated visitor gets no dashboard', !adminHtml.includes('Dashboard'))
  check('unauthenticated /admin renders nothing sensitive', !adminHtml.includes('Tracking Numbers'))

  const loginHtml = renderAdmin('/admin/login')
  check('login screen renders', loginHtml.includes('Sign in to the console'))
  check('login screen shows the demo email', loginHtml.includes(DEMO_CREDENTIALS.email))
  check('login screen shows the demo password', loginHtml.includes(DEMO_CREDENTIALS.password))
  check('login screen discloses demo mode', loginHtml.includes('Demo mode'))

  const now = Date.now()
  writeJSON(storageKey(ADMIN_CONFIG.storage.session), {
    token: 'demo_token_test',
    user: {
      id: 'admin_demo',
      name: ADMIN_CONFIG.demo.name,
      email: ADMIN_CONFIG.demo.email,
      role: ADMIN_CONFIG.demo.role,
      initials: ADMIN_CONFIG.demo.initials,
    },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  })

  const authedHtml = renderAdmin('/admin')
  check('an authenticated session renders the dashboard', authedHtml.includes('Dashboard'))
  check('dashboard labels analytics as simulated', authedHtml.includes('Simulated analytics'))
  check('dashboard exposes no public call numbers', !/tel:\+1/.test(authedHtml))
  check('sidebar renders every section', ['Services', 'Tracking Numbers', 'Niches', 'Pages', 'Blog', 'Leads', 'Settings', 'SEO', 'Profile'].every((label) => authedHtml.includes(label)))

  const authedLogin = renderAdmin('/admin/login')
  check('a signed-in visitor is redirected away from the login form', !authedLogin.includes('Sign in to the console'))

  // Every protected screen must render without throwing.
  const ADMIN_ROUTES: [string, string][] = [
    ['/admin/analytics', 'Simulated analytics'],
    ['/admin/services', 'Create and manage the service categories'],
    ['/admin/numbers', 'Every line that can appear on the website'],
    ['/admin/niches', 'Group related services into verticals'],
    ['/admin/pages', 'drafts, published and scheduled'],
    ['/admin/blog', 'published ·'],
    ['/admin/homepage', 'Reorder the page, toggle sections on or off'],
    ['/admin/leads', 'Every contact-form enquiry and support message'],
    ['/admin/settings', 'Website settings'],
    ['/admin/seo', 'SEO settings'],
    ['/admin/profile', 'Your admin identity, session and recent console activity'],
  ]
  for (const [route, marker] of ADMIN_ROUTES) {
    let html = ''
    let threw = false
    try {
      html = renderAdmin(route)
    } catch {
      threw = true
    }
    check(`${route} renders`, !threw && html.includes(marker), threw ? 'threw during render' : 'marker missing')
  }

  storage.remove(storageKey(ADMIN_CONFIG.storage.session))

  /* ---------------------------------------------------------------------- */
  section('Seeded workspace mirrors the live directory')

  const seed = buildSeedWorkspace()
  check('seed contains every website service', seed.services.length === SERVICES.length, `${seed.services.length} vs ${SERVICES.length}`)
  check('seed contains every published number', seed.numbers.length === SERVICE_PHONE_NUMBERS.reduce((total, group) => total + group.numbers.length, 0))
  check('seed slugs match the live services', SERVICES.every((service) => seed.services.some((row) => row.slug === service.slug)))
  check(
    'each service points at its live phone group',
    SERVICES.every((service) => {
      const record = seed.services.find((row) => row.slug === service.slug)
      return record?.groupId === (SERVICE_NUMBER_MAP[service.slug]?.groupIds[0] ?? null)
    }),
  )
  check('every seeded number exists in the live directory', seed.numbers.every((row) => SERVICE_PHONE_NUMBERS.some((group) => group.numbers.some((phone) => phone.id === row.id && phone.number === row.number))))
  check('every number has a unique id', new Set(seed.numbers.map((row) => row.id)).size === seed.numbers.length)
  check('priorities are 1 and 2 per group', SERVICE_PHONE_NUMBERS.every((group) => group.numbers.map((phone) => phone.priority).sort().join(',') === '1,2'))
  check('seed includes niches, pages, posts, sections and leads', seed.niches.length > 0 && seed.pages.length > 0 && seed.posts.length > 0 && seed.sections.length > 0 && seed.leads.length > 0)
  check('seeded settings mirror the site', seed.settings.supportEmail.length > 0 && seed.settings.domain.length > 0)
  check('seeded SEO has a canonical base', seed.seo.canonicalBase.startsWith('https://'))

  /* ---------------------------------------------------------------------- */
  section('Repository CRUD')

  await resetAdminDemoData()
  const services = await localRepository.listServices()
  const createdService = await localRepository.createService({
    name: 'Solar Panel Installation',
    slug: 'solar-panel-installation',
    groupId: null,
    nicheId: services[0]?.nicheId ?? null,
    category: 'exterior',
    icon: 'Sun',
    featured: false,
    status: 'draft',
    sortOrder: 99,
    shortDescription: 'Demo service created by the test suite.',
    metaTitle: 'Solar Panel Installation',
    metaDescription: 'Demo metadata.',
  })
  check('createService adds a record', (await localRepository.listServices()).some((row) => row.id === createdService.id))

  let duplicateSlugRejected = false
  try {
    await localRepository.createService({ ...createdService, id: undefined as never, name: 'Duplicate' })
  } catch {
    duplicateSlugRejected = true
  }
  check('createService rejects a duplicate slug', duplicateSlugRejected)

  const updatedService = await localRepository.updateService(createdService.id, { status: 'published', name: 'Solar Installation' })
  check('updateService patches fields', updatedService.status === 'published' && updatedService.name === 'Solar Installation')

  await localRepository.deleteService(createdService.id)
  check('deleteService removes the record', !(await localRepository.listServices()).some((row) => row.id === createdService.id))

  const numbers = await localRepository.listNumbers()
  const roofing = numbers.filter((row) => row.groupId === 'roofing')
  check('seeded numbers keep their order', roofing.length === 2 && roofing.every((row) => row.status === 'active'))

  const newNumber = await localRepository.createNumber({
    groupId: 'roofing',
    number: '855-555-0199',
    label: 'Test overlay line',
    priority: 3,
    status: 'pending-verification',
    network: 'Test network',
    campaign: 'Test campaign',
    notes: 'Created by the test suite.',
  })
  check('createNumber adds a number', (await localRepository.listNumbers()).some((row) => row.id === newNumber.id))

  let invalidNumberRejected = false
  try {
    await localRepository.createNumber({ ...newNumber, number: '12' })
  } catch {
    invalidNumberRejected = true
  }
  check('createNumber validates the phone format', invalidNumberRejected)

  let duplicateNumberRejected = false
  try {
    await localRepository.createNumber({ ...newNumber, number: '800-779-3921' })
  } catch {
    duplicateNumberRejected = true
  }
  check('createNumber rejects a number already in the directory', duplicateNumberRejected)

  const paused = await localRepository.updateNumber(newNumber.id, { status: 'inactive' })
  check('updateNumber changes the status', paused.status === 'inactive')
  await localRepository.deleteNumber(newNumber.id)
  check('deleteNumber removes the number', !(await localRepository.listNumbers()).some((row) => row.id === newNumber.id))

  const niche = await localRepository.createNiche({
    name: 'Test Niche',
    slug: 'test-niche',
    description: 'Created by the test suite.',
    tone: 'brand',
    status: 'active',
  })
  check('createNiche works', (await localRepository.listNiches()).some((row) => row.id === niche.id))
  await localRepository.deleteNiche(niche.id)
  check('deleteNiche works', !(await localRepository.listNiches()).some((row) => row.id === niche.id))

  const page = await localRepository.createPage({
    title: 'Test Page',
    slug: '/test-page',
    template: 'standard',
    status: 'draft',
    excerpt: 'Created by the test suite.',
    seoTitle: 'Test Page',
    seoDescription: 'Demo page.',
  })
  check('createPage works', (await localRepository.listPages()).some((row) => row.id === page.id))
  const publishedPage = await localRepository.updatePage(page.id, { status: 'published' })
  check('updatePage publishes', publishedPage.status === 'published')
  await localRepository.deletePage(page.id)
  check('deletePage works', !(await localRepository.listPages()).some((row) => row.id === page.id))

  const post = await localRepository.createPost({
    title: 'Test Post',
    slug: 'test-post',
    category: 'General',
    status: 'draft',
    excerpt: 'Created by the test suite.',
    featuredImage: '',
    seoTitle: 'Test Post',
    seoDescription: 'Demo post.',
    author: 'Test',
    publishedAt: new Date().toISOString(),
  })
  check('createPost works', (await localRepository.listPosts()).some((row) => row.id === post.id))
  await localRepository.deletePost(post.id)
  check('deletePost works', !(await localRepository.listPosts()).some((row) => row.id === post.id))

  const sectionsBefore = await localRepository.listSections()
  const moved = await localRepository.moveSection(sectionsBefore[1].id, 'up')
  check('moveSection reorders the homepage', moved[0].id === sectionsBefore[1].id)

  const leads = await localRepository.listLeads()
  const updatedLead = await localRepository.updateLead(leads[0].id, { status: 'contacted', assignedTo: 'Demo Administrator' })
  check('updateLead changes the triage state', updatedLead.status === 'contacted' && updatedLead.assignedTo === 'Demo Administrator')

  const settings = await localRepository.updateSettings({ siteName: 'Safe Home Network (test)' })
  check('updateSettings persists', settings.siteName === 'Safe Home Network (test)')
  const seo = await localRepository.updateSeo({ robots: 'noindex,nofollow' })
  check('updateSeo persists', seo.robots === 'noindex,nofollow')

  const reset = await resetAdminDemoData()
  check('resetDemoData restores the seed', reset.settings.siteName === 'Safe Home Network' && reset.seo.robots === 'index,follow')
  check('resetDemoData restores services', reset.services.length === SERVICES.length)

  /* ---------------------------------------------------------------------- */
  section('Selectors')

  const health = directoryHealth(reset.services, reset.numbers)
  check('directory health counts every number', health.numbers === reset.numbers.length)
  check('directory health finds the six services without lines', health.servicesWithoutNumbers === 6, String(health.servicesWithoutNumbers))
  check('directory health reports 10 groups', health.groups === 10, String(health.groups))
  check('groupName resolves live groups', groupName('roofing') === 'Roofing')
  check('groupName handles a missing group', groupName(null) === 'No call group')
  check('roleLabel maps priority 1 to Primary', roleLabel(1) === 'Primary' && roleLabel(2) === 'Alternate')

  const roofingService = reset.services.find((row) => row.slug === 'roofing')
  const roofingNumbers = numbersForService(reset.numbers, roofingService)
  check('numbersForService returns only the service group', roofingNumbers.every((row) => row.groupId === 'roofing'))
  check('numbersForService sorts by priority', roofingNumbers[0]?.priority === 1)
  const waterDamage = reset.services.find((row) => row.slug === 'water-damage')
  check('services without a group expose no numbers', numbersForService(reset.numbers, waterDamage).length === 0)

  /* ---------------------------------------------------------------------- */
  section('Simulated analytics')

  check('90-day series is complete', DAILY_SERIES.length === ANALYTICS_WINDOW_DAYS)
  check('every day has non-zero visitors', DAILY_SERIES.every((row) => row.visitors > 0))
  check('calls are a subset of visitors', DAILY_SERIES.every((row) => row.calls < row.visitors))
  const week = totalsFor(rangeFor(7))
  const month = totalsFor(rangeFor(30))
  check('weekly totals are smaller than monthly', week.calls < month.calls)
  check('conversion is a percentage', week.conversion > 0 && week.conversion < 100)
  check('previous period is the same length', previousRangeFor(30).length === 30)
  check('changePercent handles a zero baseline', changePercent(10, 0) === 100 && changePercent(0, 0) === 0)
  check('rangeFor clamps the window', rangeFor(500).length === DAILY_SERIES.length)

  /* ---------------------------------------------------------------------- */
  section('Formatting helpers')

  check('formatNumber groups thousands', formatNumber(1234567) === '1,234,567')
  check('formatCurrency renders dollars', formatCurrency(1234.6) === '$1,235')
  check('initialsOf builds two letters', initialsOf('Demo Administrator') === 'DA')
  check('titleCase humanises slugs', titleCase('roof-repair') === 'Roof Repair')

  /* ---------------------------------------------------------------------- */
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
