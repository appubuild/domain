/**
 * Phone directory + ZIP lookup test suite.
 *
 *   npm run test
 *
 * Runs against the real modules (no mocks for the directory) and a stubbed
 * `fetch` for the ZIP provider responses.
 */
import { SERVICE_PHONE_NUMBERS } from '../src/data/serviceNumbers'
import {
  CALL_DIRECTORY_CATEGORIES,
  SERVICE_NUMBER_MAP,
  getGroupsForService,
  getPhoneGroup,
} from '../src/data/serviceNumberMapping'
import {
  directoryStats,
  evaluateCampaign,
  resolveCallDirectory,
  toTelHref,
} from '../src/lib/phoneDirectory'
import { normalizeZip, validateZip } from '../src/lib/zip'
import { clearZipCache, lookupZip, formatLocation } from '../src/lib/zipLookup'
import type { UsLocation } from '../src/lib/zipLookup'

let pass = 0
let fail = 0

const check = (name: string, fn: () => void | boolean | Promise<void | boolean>) => {
  const run = async () => {
    try {
      const result = await fn()
      if (result === false) throw new Error('assertion returned false')
      pass += 1
      console.log(`  PASS  ${name}`)
    } catch (error) {
      fail += 1
      console.log(`  FAIL  ${name}\n        ${(error as Error).message}`)
    }
  }
  return run()
}

const ok = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
}

const eq = (actual: unknown, expected: unknown, message: string) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message} — expected ${b}, got ${a}`)
}

const ATLANTA: UsLocation = { zip: '30301', city: 'Atlanta', state: 'Georgia', stateAbbr: 'GA' }
const DENVER: UsLocation = { zip: '80202', city: 'Denver', state: 'Colorado', stateAbbr: 'CO' }

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

const stubFetch = (implementation: (url: string) => Promise<Response> | Response) => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(implementation(String(input)))) as typeof fetch
}

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

/* -------------------------------------------------------------------------- */

const run = async () => {
  console.log('\n── Directory structure ───────────────────────────────────────────')

  await check('10 service groups, 20 numbers total', () => {
    const stats = directoryStats()
    eq(stats.groups, 10, 'group count')
    eq(stats.total, 20, 'number count')
  })

  await check('every group has exactly two numbers with priorities 1 and 2', () => {
    for (const group of SERVICE_PHONE_NUMBERS) {
      eq(group.numbers.length, 2, `${group.id} number count`)
      eq(
        group.numbers.map((number) => number.priority),
        [1, 2],
        `${group.id} priorities`,
      )
    }
  })

  await check('all twenty numbers are active and publishable', () => {
    const stats = directoryStats()
    eq(stats.active, 20, 'active count')
    eq(stats.pending, 0, 'pending count')
    eq(stats.inactive, 0, 'inactive count')
  })

  await check('every live number records its campaign permission', () => {
    for (const group of SERVICE_PHONE_NUMBERS) {
      for (const number of group.numbers) {
        ok(number.campaign, `${number.id} has no campaign block`)
        eq(number.campaign?.nationwide, true, `${number.id} nationwide permission`)
        ok(
          typeof number.campaign?.notes === 'string' && number.campaign.notes.length > 0,
          `${number.id} must record why it is published`,
        )
      }
    }
  })

  await check('number ids and phone numbers are unique', () => {
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

  await check('all numbers use a valid US toll-free display format', () => {
    for (const group of SERVICE_PHONE_NUMBERS) {
      for (const number of group.numbers) {
        ok(/^\d{3}-\d{3}-\d{4}$/.test(number.number), `bad format ${number.number}`)
        ok(
          /^(800|833|844|855|866|877|888)/.test(number.number),
          `${number.number} is not a toll-free number`,
        )
      }
    }
  })

  await check('no internal labels leaked into the data file', () => {
    const source = JSON.stringify(SERVICE_PHONE_NUMBERS).toLowerCase()
    for (const banned of ['lokman', 'team member', 'internal', 'source label']) {
      ok(!source.includes(banned), `found banned label "${banned}"`)
    }
  })

  console.log('\n── Service → number mapping ─────────────────────────────────────')

  await check('every mapped group id exists in the directory', () => {
    for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
      for (const groupId of mapping.groupIds) {
        ok(getPhoneGroup(groupId), `${slug} references missing group ${groupId}`)
      }
    }
  })

  await check('each service only receives numbers from its own group', () => {
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

  await check('roofing maps to the roofing numbers only', () => {
    const numbers = getGroupsForService('roofing').flatMap((group) => group.numbers.map((n) => n.number))
    eq(numbers, ['800-779-3921', '888-863-0629'], 'roofing numbers')
  })

  await check('all ten directory categories resolve to a group', () => {
    eq(CALL_DIRECTORY_CATEGORIES.length, 10, 'category count')
    for (const category of CALL_DIRECTORY_CATEGORIES) {
      ok(getPhoneGroup(category.groupId), `${category.groupId} has no group`)
      ok(getGroupsForService(category.groupId).length === 1, `${category.groupId} does not resolve`)
    }
  })

  await check('services without an authorized group fall back to contact', () => {
    for (const slug of ['water-damage', 'pest-control', 'locksmith', 'concrete-paving']) {
      const state = resolveCallDirectory({
        serviceSlug: slug,
        serviceName: slug,
        location: ATLANTA,
        previewUnpublished: false,
      })
      eq(state.kind, 'no-directory', `${slug} state`)
    }
  })

  console.log('\n── tel: links and priority ──────────────────────────────────────')

  await check('tel hrefs use E.164 US format', () => {
    eq(toTelHref('800-779-3921'), 'tel:+18007793921', 'primary tel')
    eq(toTelHref('888-863-0629'), 'tel:+18888630629', 'alternate tel')
    eq(toTelHref('(800) 779-3921'), 'tel:+18007793921', 'formatted input')
  })

  await check('priority decides Call Now vs Call Alternate', () => {
    const state = resolveCallDirectory({
      serviceSlug: 'roofing',
      serviceName: 'Roofing',
      location: ATLANTA,
      previewUnpublished: false,
    })
    eq(state.kind, 'ready', 'state')
    if (state.kind !== 'ready') throw new Error('not ready')
    eq(state.numbers.length, 2, 'both lines offered')
    eq(state.numbers[0].slot, 'primary', 'first slot')
    eq(state.numbers[0].display, '800-779-3921', 'primary number')
    eq(state.numbers[0].telHref, 'tel:+18007793921', 'primary tel href')
    eq(state.numbers[1].slot, 'alternate', 'second slot')
    eq(state.numbers[1].display, '888-863-0629', 'alternate number')
    eq(state.numbers[1].telHref, 'tel:+18888630629', 'alternate tel href')
  })

  await check('a location is required before any number is offered', () => {
    const state = resolveCallDirectory({
      serviceSlug: 'roofing',
      serviceName: 'Roofing',
      location: null,
      previewUnpublished: false,
    })
    eq(state.kind, 'needs-location', 'state without a location')
  })

  console.log('\n── Publication rules ────────────────────────────────────────────')

  await check('a number set back to pending is never published', () => {
    const group = getPhoneGroup('roofing')!
    try {
      group.numbers.forEach((number) => {
        number.status = 'pending-verification'
        number.campaign = undefined
      })
      const state = resolveCallDirectory({
        serviceSlug: 'roofing',
        serviceName: 'Roofing',
        location: ATLANTA,
        previewUnpublished: false,
      })
      eq(state.kind, 'awaiting-verification', 'state')
    } finally {
      restoreDirectory()
    }
  })

  await check('development preview flags unpublished numbers', () => {
    const group = getPhoneGroup('roofing')!
    try {
      group.numbers.forEach((number) => {
        number.status = 'pending-verification'
        number.campaign = undefined
      })
      const state = resolveCallDirectory({
        serviceSlug: 'roofing',
        serviceName: 'Roofing',
        location: ATLANTA,
        previewUnpublished: true,
      })
      eq(state.kind, 'preview', 'state')
      if (state.kind !== 'preview') throw new Error('not preview')
      ok(
        state.numbers.every((number) => number.published === false),
        'preview numbers must be marked unpublished',
      )
      eq(state.numbers.length, 2, 'preview count')
    } finally {
      restoreDirectory()
    }
  })

  await check('inactive numbers are never offered', () => {
    const group = getPhoneGroup('plumbing')!
    try {
      group.numbers[0].status = 'inactive'
      const state = resolveCallDirectory({
        serviceSlug: 'plumbing',
        serviceName: 'Plumbing',
        location: ATLANTA,
        previewUnpublished: true,
      })
      eq(state.kind, 'ready', 'state')
      if (state.kind !== 'ready') throw new Error('not ready')
      eq(state.numbers.length, 1, 'only the active number is offered')
      eq(state.numbers[0].id, 'plumbing-2', 'active number id')
    } finally {
      restoreDirectory()
    }
  })

  console.log('\n── Campaign eligibility ─────────────────────────────────────────')

  await check('no campaign data means unverified (never offered)', () => {
    const number = { id: 't', number: '800-000-0000', priority: 1, status: 'active' as const }
    eq(evaluateCampaign(number, ATLANTA).eligibility, 'unverified', 'eligibility')
  })

  await check('nationwide permission is required explicitly', () => {
    const number = { id: 't', number: '800-000-0000', priority: 1, status: 'active' as const, campaign: {} }
    eq(evaluateCampaign(number, ATLANTA).eligibility, 'unverified', 'empty campaign')

    const withNationwide = { ...number, campaign: { nationwide: true } }
    eq(evaluateCampaign(withNationwide, ATLANTA).eligibility, 'eligible', 'nationwide true')
  })

  await check('state allow-lists restrict traffic', () => {
    const number = {
      id: 't',
      number: '800-000-0000',
      priority: 1,
      status: 'active' as const,
      campaign: { states: ['GA', 'FL'] },
    }
    eq(evaluateCampaign(number, ATLANTA).eligibility, 'eligible', 'GA allowed')
    eq(evaluateCampaign(number, DENVER).eligibility, 'restricted', 'CO blocked')
  })

  await check('ZIP allow-lists override state rules', () => {
    const number = {
      id: 't',
      number: '800-000-0000',
      priority: 1,
      status: 'active' as const,
      campaign: { states: ['GA'], zipCodes: ['30301'] },
    }
    eq(evaluateCampaign(number, ATLANTA).eligibility, 'eligible', 'allowed zip')
    eq(evaluateCampaign(number, DENVER).eligibility, 'restricted', 'blocked zip')
  })

  await check('state-restricted campaign yields an unverified-location panel', () => {
    const group = getPhoneGroup('window')!
    try {
      group.numbers.forEach((number) => {
        number.status = 'active'
        number.campaign = { states: ['GA'] }
      })
      const state = resolveCallDirectory({
        serviceSlug: 'window',
        serviceName: 'Window',
        location: DENVER,
        previewUnpublished: false,
      })
      eq(state.kind, 'unverified-location', 'state')
    } finally {
      restoreDirectory()
    }
  })

  console.log('\n── ZIP code validation ──────────────────────────────────────────')

  await check('accepts valid US ZIP codes', () => {
    for (const zip of ['00501', '10001', '30301', '90210', '99950']) {
      ok(validateZip(zip).valid, `${zip} should be valid`)
    }
  })

  await check('rejects malformed or out-of-range ZIP codes', () => {
    for (const zip of ['00000', '00012', '1234', 'abcde', '', '99951']) {
      ok(!validateZip(zip).valid, `${zip} should be invalid`)
    }
  })

  await check('accepts ZIP+4 input by using the five-digit base', () => {
    eq(normalizeZip('303011234'), '30301', 'zip+4 truncation')
    ok(validateZip('303011234').valid, 'ZIP+4 should validate on its base ZIP')
  })

  await check('normalizes pasted input to five digits', () => {
    eq(normalizeZip('30301-1234'), '30301', 'zip+4')
    eq(normalizeZip(' 30 301 '), '30301', 'spaces')
    eq(normalizeZip('90210abc'), '90210', 'letters')
  })

  console.log('\n── ZIP lookup API ───────────────────────────────────────────────')

  await check('returns city and state for a valid ZIP', async () => {
    clearZipCache()
    stubFetch(() =>
      jsonResponse({
        'post code': '30301',
        places: [{ 'place name': 'Atlanta', state: 'Georgia', 'state abbreviation': 'GA' }],
      }),
    )
    const result = await lookupZip('30301')
    ok(result.ok, 'expected success')
    if (!result.ok) return
    eq(result.location.city, 'Atlanta', 'city')
    eq(result.location.state, 'Georgia', 'state')
    eq(result.location.stateAbbr, 'GA', 'state abbr')
    eq(formatLocation(result.location), 'Atlanta, GA', 'formatted location')
  })

  await check('caches repeat lookups (no second network call)', async () => {
    clearZipCache()
    let calls = 0
    stubFetch(() => {
      calls += 1
      return jsonResponse({
        'post code': '80202',
        places: [{ 'place name': 'Denver', state: 'Colorado', 'state abbreviation': 'CO' }],
      })
    })
    await lookupZip('80202')
    const second = await lookupZip('80202')
    eq(calls, 1, 'fetch call count')
    ok(second.ok && second.cached, 'second lookup should be cached')
  })

  await check('maps 404 to a friendly not-found error', async () => {
    clearZipCache()
    stubFetch(() => jsonResponse({}, 404))
    const result = await lookupZip('12345')
    ok(!result.ok, 'expected failure')
    if (result.ok) return
    eq(result.error, 'not-found', 'error code')
    ok(result.message.includes('double-check'), 'message should guide the user')
  })

  await check('maps server errors to service-unavailable', async () => {
    clearZipCache()
    stubFetch(() => jsonResponse({}, 500))
    const result = await lookupZip('30301')
    ok(!result.ok && result.error === 'service-unavailable', 'error code')
  })

  await check('maps network failures to a retryable error', async () => {
    clearZipCache()
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const result = await lookupZip('30301')
    ok(!result.ok && result.error === 'network', 'error code')
  })

  await check('maps aborts to a timeout error', async () => {
    clearZipCache()
    stubFetch(() => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const result = await lookupZip('30301')
    ok(!result.ok && result.error === 'timeout', 'error code')
  })

  await check('rejects invalid input before any network call', async () => {
    clearZipCache()
    let called = false
    stubFetch(() => {
      called = true
      return jsonResponse({})
    })
    const result = await lookupZip('1234')
    ok(!result.ok && result.error === 'invalid', 'error code')
    ok(!called, 'fetch must not run for invalid input')
  })

  console.log('\n── Rendering ────────────────────────────────────────────────────')

  await check('all ten categories offer two call options for a confirmed US location', () => {
    for (const category of CALL_DIRECTORY_CATEGORIES) {
      const state = resolveCallDirectory({
        serviceSlug: category.groupId,
        serviceName: category.label,
        location: ATLANTA,
        previewUnpublished: false,
      })
      eq(state.kind, 'ready', `${category.groupId} state`)
      if (state.kind !== 'ready') continue
      eq(state.numbers.length, 2, `${category.groupId} number count`)
      ok(
        state.numbers.every(
          (number) =>
            number.telHref.startsWith('tel:+1') && number.telHref.replace(/[^0-9]/g, '').length === 11,
        ),
        `${category.groupId} tel href format`,
      )
    }
  })

  await check('service pages with a group offer calls, the rest show contact', () => {
    for (const [slug, mapping] of Object.entries(SERVICE_NUMBER_MAP)) {
      const state = resolveCallDirectory({
        serviceSlug: slug,
        serviceName: slug,
        location: ATLANTA,
        previewUnpublished: false,
      })
      eq(state.kind, mapping.groupIds.length > 0 ? 'ready' : 'no-directory', `${slug} state`)
    }
  })

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

void run()
