/**
 * Service call directory test suite.
 *
 *   npm run test
 *
 * Covers the data, the mapping, the call resolution rules and the rendered
 * markup: numbers must appear only after a service is selected, and only the
 * numbers assigned to that service.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { SERVICE_PHONE_NUMBERS } from '../src/data/serviceNumbers'
import {
  CALL_DIRECTORY_CATEGORIES,
  SERVICE_NUMBER_MAP,
  getGroupsForService,
  getPhoneGroup,
} from '../src/data/serviceNumberMapping'
import {
  directoryStats,
  hasCallDirectory,
  isCampaignPermitted,
  resolveServiceCall,
  toTelHref,
} from '../src/lib/phoneDirectory'
import { getService } from '../src/config/services'
import { ServiceCard } from '../src/components/ServiceCard'
import { CallSheetProvider } from '../src/components/calls/CallContext'

let pass = 0
let fail = 0

const check = (name: string, fn: () => void | boolean) => {
  try {
    const result = fn()
    if (result === false) throw new Error('assertion returned false')
    pass += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    fail += 1
    console.log(`  FAIL  ${name}\n        ${(error as Error).message}`)
  }
}

const ok = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}

const eq = (actual: unknown, expected: unknown, message: string) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message} — expected ${b}, got ${a}`)
}

/**
 * Deep copy of the shipped directory. Tests mutate the live objects to exercise
 * every branch, then restore from this snapshot so later assertions still see
 * the real production data.
 */
const SNAPSHOT = JSON.parse(JSON.stringify(SERVICE_PHONE_NUMBERS)) as typeof SERVICE_PHONE_NUMBERS

const restoreDirectory = () => {
  SERVICE_PHONE_NUMBERS.forEach((group, groupIndex) => {
    const original = SNAPSHOT[groupIndex]
    group.numbers.forEach((number, numberIndex) => {
      number.status = original.numbers[numberIndex].status
      number.campaign = original.numbers[numberIndex].campaign
      number.priority = original.numbers[numberIndex].priority
    })
  })
}

const renderRoute = (path: string) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const telLinksIn = (html: string) => [...html.matchAll(/href="(tel:[^"]+)"/g)].map((match) => match[1])

const numericDigits = (tel: string) => tel.replace(/[^0-9]/g, '')

/* -------------------------------------------------------------------------- */

console.log('\n── Directory structure ───────────────────────────────────────────')

check('10 service groups with 20 numbers', () => {
  const stats = directoryStats()
  eq(stats.groups, 10, 'group count')
  eq(stats.total, 20, 'number count')
})

check('every group has exactly two numbers, priorities 1 and 2', () => {
  for (const group of SERVICE_PHONE_NUMBERS) {
    eq(group.numbers.length, 2, `${group.id} number count`)
    eq(
      group.numbers.map((number) => number.priority),
      [1, 2],
      `${group.id} priorities`,
    )
  }
})

check('all twenty numbers are active and publishable', () => {
  const stats = directoryStats()
  eq(stats.active, 20, 'active count')
  eq(stats.publishable, 20, 'publishable count')
  eq(stats.pending, 0, 'pending count')
  eq(stats.inactive, 0, 'inactive count')
})

check('ids and phone numbers are unique', () => {
  const ids = new Set<string>()
  const numbers = new Set<string>()
  for (const group of SERVICE_PHONE_NUMBERS) {
    for (const number of group.numbers) {
      ok(!ids.has(number.id), `duplicate id ${number.id}`)
      ok(!numbers.has(number.number), `duplicate number ${number.number}`)
      ids.add(number.id)
      numbers.add(number.number)
    }
  }
  eq(ids.size, 20, 'unique ids')
})

check('all numbers use a valid US toll-free display format', () => {
  for (const group of SERVICE_PHONE_NUMBERS) {
    for (const number of group.numbers) {
      ok(/^\d{3}-\d{3}-\d{4}$/.test(number.number), `bad format ${number.number}`)
      ok(/^(800|833|844|855|866|877|888)/.test(number.number), `${number.number} is not toll-free`)
    }
  }
})

check('no internal labels leaked into the data file', () => {
  const source = JSON.stringify(SERVICE_PHONE_NUMBERS).toLowerCase()
  for (const banned of ['lokman', 'team member', 'internal', 'source label']) {
    ok(!source.includes(banned), `found banned label "${banned}"`)
  }
})

console.log('\n── Service → number mapping ─────────────────────────────────────')

check('every mapped group id exists in the directory', () => {
  for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
    for (const groupId of mapping.groupIds) {
      ok(getPhoneGroup(groupId), `${slug} references missing group ${groupId}`)
    }
  }
})

check('each service only receives numbers from its own group', () => {
  for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
    const ownNumbers = new Set(
      mapping.groupIds.flatMap((groupId) =>
        (getPhoneGroup(groupId)?.numbers ?? []).map((number) => number.number),
      ),
    )
    const delivered = getGroupsForService(slug).flatMap((group) => group.numbers.map((n) => n.number))
    for (const number of delivered) ok(ownNumbers.has(number), `${slug} received foreign number ${number}`)
  }
})

check('roofing maps to the roofing numbers only', () => {
  const numbers = getGroupsForService('roofing').flatMap((group) => group.numbers.map((n) => n.number))
  eq(numbers, ['800-779-3921', '888-863-0629'], 'roofing numbers')
})

check('all ten call categories resolve to a group', () => {
  eq(CALL_DIRECTORY_CATEGORIES.length, 10, 'category count')
  for (const category of CALL_DIRECTORY_CATEGORIES) {
    ok(getPhoneGroup(category.groupId), `${category.groupId} has no group`)
    ok(getGroupsForService(category.groupId).length === 1, `${category.groupId} does not resolve`)
  }
})

check('services without an authorized group fall back to contact', () => {
  for (const slug of ['water-damage', 'pest-control', 'locksmith', 'concrete-paving']) {
    const state = resolveServiceCall({ serviceSlug: slug, serviceName: slug, previewUnpublished: false })
    eq(state.kind, 'no-directory', `${slug} state`)
  }
})

console.log('\n── Call resolution (no location involved) ───────────────────────')

check('tel hrefs use E.164 US format', () => {
  eq(toTelHref('800-779-3921'), 'tel:+18007793921', 'primary tel')
  eq(toTelHref('888-863-0629'), 'tel:+18888630629', 'alternate tel')
  eq(toTelHref('(800) 779-3921'), 'tel:+18007793921', 'formatted input')
})

check('priority decides Call Now vs Call Alternate', () => {
  const state = resolveServiceCall({ serviceSlug: 'roofing', serviceName: 'Roofing', previewUnpublished: false })
  eq(state.kind, 'ready', 'state')
  if (state.kind !== 'ready') throw new Error('not ready')
  eq(state.numbers.length, 2, 'both lines offered')
  eq(state.numbers[0].slot, 'primary', 'first slot')
  eq(state.numbers[0].display, '800-779-3921', 'primary number')
  eq(state.numbers[0].telHref, 'tel:+18007793921', 'primary href')
  eq(state.numbers[1].slot, 'alternate', 'second slot')
  eq(state.numbers[1].display, '888-863-0629', 'alternate number')
  eq(state.numbers[1].telHref, 'tel:+18888630629', 'alternate href')
})

check('resolution needs no ZIP code or location argument', () => {
  const state = resolveServiceCall({ serviceSlug: 'plumbing', serviceName: 'Plumbing' })
  eq(state.kind, 'ready', 'state')
})

check('all ten categories return two call options', () => {
  for (const category of CALL_DIRECTORY_CATEGORIES) {
    const state = resolveServiceCall({
      serviceSlug: category.groupId,
      serviceName: category.label,
      previewUnpublished: false,
    })
    eq(state.kind, 'ready', `${category.groupId} state`)
    if (state.kind !== 'ready') continue
    eq(state.numbers.length, 2, `${category.groupId} number count`)
    ok(
      state.numbers.every((number) => number.telHref.startsWith('tel:+1') && numericDigits(number.telHref).length === 11),
      `${category.groupId} tel format`,
    )
  }
})

console.log('\n── Publication rules ────────────────────────────────────────────')

check('a number set back to pending is never published', () => {
  const group = getPhoneGroup('roofing')!
  try {
    group.numbers.forEach((number) => {
      number.status = 'pending-verification'
      number.campaign = undefined
    })
    const state = resolveServiceCall({ serviceSlug: 'roofing', serviceName: 'Roofing', previewUnpublished: false })
    eq(state.kind, 'awaiting-verification', 'state')
  } finally {
    restoreDirectory()
  }
})

check('development preview flags unpublished numbers', () => {
  const group = getPhoneGroup('roofing')!
  try {
    group.numbers.forEach((number) => {
      number.status = 'pending-verification'
      number.campaign = undefined
    })
    const state = resolveServiceCall({ serviceSlug: 'roofing', serviceName: 'Roofing', previewUnpublished: true })
    eq(state.kind, 'preview', 'state')
    if (state.kind !== 'preview') throw new Error('not preview')
    ok(state.numbers.every((number) => number.published === false), 'preview numbers flagged unpublished')
  } finally {
    restoreDirectory()
  }
})

check('inactive numbers are never offered', () => {
  const group = getPhoneGroup('plumbing')!
  try {
    group.numbers[0].status = 'inactive'
    const state = resolveServiceCall({ serviceSlug: 'plumbing', serviceName: 'Plumbing', previewUnpublished: true })
    eq(state.kind, 'ready', 'state')
    if (state.kind !== 'ready') throw new Error('not ready')
    eq(state.numbers.length, 1, 'only the active number is offered')
    eq(state.numbers[0].id, 'plumbing-2', 'active number id')
  } finally {
    restoreDirectory()
  }
})

check('a number without an explicit nationwide permission is withheld', () => {
  const number = { id: 't', number: '800-000-0000', priority: 1, status: 'active' as const }
  eq(isCampaignPermitted(number), false, 'missing campaign')
  eq(isCampaignPermitted({ ...number, campaign: {} }), false, 'empty campaign')
  eq(isCampaignPermitted({ ...number, campaign: { nationwide: true } }), true, 'nationwide campaign')
})

check('state or ZIP restricted campaigns are withheld (no location is collected)', () => {
  const number = { id: 't', number: '800-000-0000', priority: 1, status: 'active' as const }
  eq(isCampaignPermitted({ ...number, campaign: { states: ['GA'] } }), false, 'state allow-list')
  eq(isCampaignPermitted({ ...number, campaign: { zipCodes: ['30301'] } }), false, 'zip allow-list')
})

console.log('\n── Rendered pages ───────────────────────────────────────────────')

check('ZIP / availability modules are gone from the codebase', () => {
  for (const path of [
    'src/components/availability',
    'src/lib/zip.ts',
    'src/lib/zipLookup.ts',
    'src/lib/coverage.ts',
    'src/config/coverage.ts',
    'src/config/providers.ts',
  ]) {
    ok(!existsSync(resolve(process.cwd(), path)), `${path} still exists`)
  }
})

check('a service card shows Call Now but never a phone number', () => {
  const service = getService('roofing')!
  const html = renderToString(
    <MemoryRouter>
      <CallSheetProvider>
        <ServiceCard service={service} />
      </CallSheetProvider>
    </MemoryRouter>,
  )
  ok(html.includes('Call Now'), 'Call Now button missing')
  eq(telLinksIn(html), [], 'no tel: link may appear before a service is selected')
  ok(!html.includes('800-779-3921'), 'card must not print the number')
})

check('the services index lists Call Now buttons with no numbers', () => {
  const html = renderRoute('/services')
  ok(html.includes('Call Now'), 'Call Now missing on /services')
  eq(telLinksIn(html), [], '/services must not expose tel: links')
  ok(!html.includes('800-779-3921'), '/services must not print roofing number')
})

check('the homepage has no ZIP input and no tel: link', () => {
  const html = renderRoute('/')
  eq(telLinksIn(html), [], 'homepage must not expose tel: links')
  ok(!/name="zip"/i.test(html), 'ZIP input still present')
  ok(!/id="zip"/i.test(html), 'ZIP input id still present')
  ok(!/Enter (your )?ZIP/i.test(html), 'ZIP prompt copy still present')
  ok(html.includes('Call Now'), 'homepage is missing Call Now')
})

check('service detail pages expose only their own two numbers', () => {
  const html = renderRoute('/services/roofing')
  const links = telLinksIn(html)
  eq(links, ['tel:+18007793921', 'tel:+18888630629'], 'roofing tel links')
  ok(html.includes('Call Now'), 'Call Now missing')
  ok(html.includes('Call Alternate'), 'Call Alternate missing')
  ok(!html.includes('800-736-1462'), 'plumbing number leaked into roofing page')
})

check('every service page either shows call links or a contact message', () => {
  for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
    const html = renderRoute(`/services/${slug}`)
    const links = telLinksIn(html)
    if (mapping.groupIds.length > 0) {
      ok(links.length === 2, `${slug} expected 2 tel links, got ${links.length}`)
      ok(html.includes('Call Now'), `${slug} missing Call Now`)
    } else {
      eq(links, [], `${slug} must not expose tel links`)
      ok(html.includes('Contact our team'), `${slug} missing contact fallback`)
    }
  }
})

check('removing the ZIP step did not break other routes', () => {
  for (const route of ['/about', '/contact', '/how-it-works', '/service-area', '/privacy-policy']) {
    const html = renderRoute(route)
    ok(html.length > 500, `${route} rendered too little`)
    ok(!/name="zip"/i.test(html), `${route} still renders a ZIP input`)
  }
})

check('hasCallDirectory matches the mapped services', () => {
  for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
    eq(hasCallDirectory(slug), mapping.groupIds.length > 0, `${slug} hasCallDirectory`)
  }
})

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
