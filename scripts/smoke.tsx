/**
 * Render smoke test — mounts every route through react-dom/server to catch
 * render-time crashes that a build alone would not surface.
 *
 *   npx vite build --ssr scripts/smoke.tsx --outDir .smoke && node .smoke/smoke.js
 */
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'

const ROUTES = [
  '/',
  '/about',
  '/services',
  '/services/roofing',
  '/services/roof-repair',
  '/services/plumbing',
  '/services/hvac',
  '/services/ac-repair',
  '/services/water-damage',
  '/services/pest-control',
  '/services/kitchen-remodeling',
  '/services/bathroom-remodeling',
  '/services/bedroom-remodeling',
  '/services/electrical',
  '/services/window-installation',
  '/services/door-installation',
  '/services/concrete-paving',
  '/services/locksmith',
  '/contact',
  '/how-it-works',
  '/service-area',
  '/privacy-policy',
  '/terms-and-conditions',
  '/disclaimer',
  '/do-not-sell-or-share',
  '/accessibility',
  '/services/does-not-exist',
  '/totally-unknown-page',
]

let failures = 0

for (const route of ROUTES) {
  try {
    const html = renderToString(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    )
    const okLength = html.length > 2000
    if (!okLength) failures += 1
    console.log(`${okLength ? 'PASS' : 'FAIL'}  ${route.padEnd(34)} ${html.length} bytes`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${route.padEnd(34)} ${(error as Error).message}`)
  }
}

console.log(failures === 0 ? '\nAll routes rendered.' : `\n${failures} route(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
