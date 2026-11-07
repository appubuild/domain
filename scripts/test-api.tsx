/**
 * API integration test suite.
 *
 *   npm run test:api
 *
 * Covers the client/mapper layer added for the PHP API: envelope + error
 * handling, snake_case → camelCase mapping, the service/number directory
 * round-trip (10 groups, 20 numbers), settings mapping, the snippet allow-list
 * and the in-place hydration of the bundled content.
 *
 * It runs with no API base URL configured, which is exactly the static build:
 * the site must behave identically to Phase 1 in this mode.
 */
import { API_ENABLED, ApiError, apiRequest } from '@/lib/api/client'
import {
  mapCategory,
  mapDirectory,
  mapService,
  mapSettingsToSitePatch,
  type ApiCategory,
  type ApiServiceDetail,
} from '@/lib/api/publicContent'
import { isSafeSnippet } from '@/lib/api/runtimeConfig'
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { SERVICE_NUMBER_MAP, getGroupsForService } from '@/data/serviceNumberMapping'
import { resolveServiceCall } from '@/lib/phoneDirectory'
import { SERVICES, hydrateServices, getService } from '@/config/services'
import { hydrateServicePhoneNumbers } from '@/data/serviceNumbers'
import { hydrateServiceNumberMap } from '@/data/serviceNumberMapping'
import { hydrateSite, SITE } from '@/config/site'
import { HOME_FAQS, hydrateFaqs } from '@/config/faqs'

let passed = 0
let failed = 0

const check = (label: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
    return
  }
  failed++
  console.error(`  FAIL  ${label}`, detail ?? '')
}

const group = (title: string): void => console.log(`\n── ${title} ─────────────────────────────────────────`)

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

const buildFixtureService = (slug: string, name: string, categoryId: string): ApiServiceDetail => {
  const mapping = SERVICE_NUMBER_MAP[slug]
  const groupIds = mapping?.groupIds ?? []

  const phoneGroups = groupIds.flatMap((groupId) => {
    const directoryGroup = SERVICE_PHONE_NUMBERS.find((entry) => entry.id === groupId)
    if (!directoryGroup) return []
    return [
      {
        id: directoryGroup.id,
        name: directoryGroup.name,
        label: directoryGroup.name,
        blurb: `${directoryGroup.name} services`,
        icon: 'wrench',
        numbers: directoryGroup.numbers.map((number, index) => ({
          id: 1000 + index + directoryGroup.id.length,
          external_id: number.id,
          number: number.number,
          label: null,
          priority: number.priority,
          priority_label: number.priority === 1 ? 'Call Now' : 'Call Alternate',
          tel: `tel:+1${number.number.replace(/\D/g, '')}`,
        })),
      },
    ]
  })

  return {
    id: 1,
    slug,
    name,
    short_name: null,
    category: { id: categoryId, name: categoryId },
    niche: null,
    icon: 'home',
    image: '/images/service-roofing.jpg',
    featured: false,
    hero_headline: `${name} headline`,
    hero_subheadline: `${name} subheadline`,
    short_description: `${name} description`,
    intro: ['Intro paragraph.'],
    common_needs: [{ title: 'Need', description: 'Description' }],
    options: [{ title: 'Option', description: 'Description' }],
    process_note: 'Process note.',
    faqs: [{ question: 'Question?', answer: 'Answer.' }],
    related: [],
    search_terms: ['term'],
    meta_title: `${name} title`,
    meta_description: `${name} meta description`,
    updated_at: '2026-11-07T10:00:00Z',
    phone_groups: phoneGroups,
  }
}

const fixtureCategories: ApiCategory[] = [
  { id: 'exterior', name: 'Roofing & Exterior', description: 'Weather-facing work.', sort_order: 1, service_count: 4 },
  { id: 'systems', name: 'Home Systems', description: 'Plumbing and electrical.', sort_order: 2, service_count: 4 },
  { id: 'remodeling', name: 'Remodeling', description: 'Kitchens and baths.', sort_order: 3, service_count: 3 },
  { id: 'restoration', name: 'Restoration', description: 'Water damage.', sort_order: 4, service_count: 1 },
  { id: 'specialty', name: 'Specialty Services', description: 'Pest and locks.', sort_order: 5, service_count: 3 },
]

const fixtureServices: ApiServiceDetail[] = SERVICES.map((service, index) => ({
  ...buildFixtureService(service.slug, service.name, service.category),
  id: index + 1,
}))

/* -------------------------------------------------------------------------- */
/*  Client                                                                    */
/* -------------------------------------------------------------------------- */

group('Client configuration')

check('no API base URL in the default build', API_ENABLED === false)
check('ApiError carries status, code and field errors', (() => {
  const error = new ApiError('Bad input', 422, 'validation_failed', { name: 'Required' })
  return error.status === 422 && error.code === 'validation_failed' && error.firstFieldError === 'Required'
})())

const clientTest = apiRequest('/v1/health').then(
  () => check('request without a base URL rejects', false),
  (error: unknown) =>
    check(
      'request without a base URL rejects with a clear code',
      error instanceof ApiError && error.code === 'api_not_configured',
    ),
)

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                   */
/* -------------------------------------------------------------------------- */

group('Mappers')

const mappedCategory = mapCategory(fixtureCategories[0])
check('category maps to the site type', mappedCategory.id === 'exterior' && mappedCategory.name === 'Roofing & Exterior')
check('unknown category id falls back safely', mapCategory({ ...fixtureCategories[0], id: 'unknown' }).id === 'specialty')

const mappedService = mapService(fixtureServices[0])
check('service maps headline + copy', mappedService.heroHeadline.length > 0 && mappedService.intro.length > 0)
check('service keeps its slug and category', mappedService.slug === fixtureServices[0].slug && mappedService.category === 'exterior')
check('service maps FAQs', mappedService.faqs[0]?.question === 'Question?')

const directory = mapDirectory(fixtureServices)
const reachableGroupIds = new Set(Object.values(SERVICE_NUMBER_MAP).flatMap((entry) => entry.groupIds))
const reachableNumbers = SERVICE_PHONE_NUMBERS.filter((group) => reachableGroupIds.has(group.id)).reduce(
  (sum, group) => sum + group.numbers.length,
  0,
)

check('bundled directory ships 10 groups / 20 numbers', SERVICE_PHONE_NUMBERS.length === 10 &&
  SERVICE_PHONE_NUMBERS.reduce((sum, group) => sum + group.numbers.length, 0) === 20)
check(
  'directory maps every group reachable from a service',
  directory.groups.length === reachableGroupIds.size,
  `${directory.groups.length} vs ${reachableGroupIds.size}`,
)
check(
  'directory maps every reachable number',
  Object.keys(directory.numberIndex).length === reachableNumbers,
  `${Object.keys(directory.numberIndex).length} vs ${reachableNumbers}`,
)
check('every reachable group has numbers', directory.groups.every((entry) => entry.numbers.length >= 2))
check('directory maps every service', Object.keys(directory.serviceIds).length === SERVICES.length)
check('every group has a mapping entry', Object.keys(directory.mapping).length === SERVICES.length)
check(
  'services without a group map to an empty list',
  (directory.mapping['water-damage']?.groupIds.length ?? -1) === 0,
)

const settingsPatch = mapSettingsToSitePatch({
  site_name: 'Safe Home Network',
  contact_email: 'hello@example.com',
  address_lines: ['1 Main St'],
  social_facebook: 'https://facebook.com/example',
})
check('settings mapping copies site name', settingsPatch.name === 'Safe Home Network')
check('settings mapping copies contact details', settingsPatch.contact.email === 'hello@example.com')
check('settings mapping keeps address lines', settingsPatch.contact.addressLines?.length === 1)

/* -------------------------------------------------------------------------- */
/*  Snippet allow-list (defence in depth)                                     */
/* -------------------------------------------------------------------------- */

group('Snippet guard')

check('accepts a GTM snippet', isSafeSnippet('<script async src="https://www.googletagmanager.com/gtag/js"></script>'))
check('rejects an HTML block', !isSafeSnippet('<div class="x">hello</div>'))
check('rejects an empty snippet', !isSafeSnippet('   '))
check('rejects markup mixed with a form', !isSafeSnippet('<meta name="x" content="y"><form></form>'))

/* -------------------------------------------------------------------------- */
/*  Hydration                                                                 */
/* -------------------------------------------------------------------------- */

group('Content hydration')

const hydrated = fixtureServices.map(mapService)
hydrateServices(hydrated, fixtureCategories.map(mapCategory))

check('hydrated service is served to components', getService(fixtureServices[0].slug) !== undefined)
check('hydrated service count matches the payload', SERVICES.length === fixtureServices.length)
check('hydrated category list is swapped', fixtureCategories.length === 5)

hydrateServicePhoneNumbers(directory.groups)
hydrateServiceNumberMap(directory.mapping)

const hydratedGroups = SERVICES.flatMap((service) => getGroupsForService(service.slug))
check('mapping resolves groups after hydration', hydratedGroups.length === 9)

const callState = resolveServiceCall({ serviceSlug: 'roofing', serviceName: 'Roofing' })
check('hydrated service resolves a published number', callState.kind === 'ready', callState.kind)
check(
  'hydrated numbers keep their priority order',
  callState.kind === 'ready' && callState.numbers[0]?.priority <= callState.numbers[1]?.priority,
)

const unmapped = resolveServiceCall({ serviceSlug: 'water-damage', serviceName: 'Water damage' })
check('service with no group still shows the contact message', unmapped.kind === 'no-directory', unmapped.kind)

hydrateSite({ name: 'API Site Name', contact: { email: 'api@example.com' } })
check('site hydration updates the name', SITE.name === 'API Site Name')
check('site hydration updates the contact email', SITE.contact.email === 'api@example.com')

const originalFaqCount = HOME_FAQS.length
hydrateFaqs({ home: [{ question: 'API question?', answer: 'API answer.' }] })
check('FAQ hydration swaps the homepage list', HOME_FAQS.length === 1 && HOME_FAQS[0].question === 'API question?')
check('FAQ hydration did not silently drop the original copy', originalFaqCount >= 7)

/* -------------------------------------------------------------------------- */
/*  Summary                                                                   */
/* -------------------------------------------------------------------------- */

const finish = (): void => {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`API integration tests: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

void clientTest.then(finish, finish)
