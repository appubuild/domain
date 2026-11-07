import { Link } from 'react-router-dom'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { LegalPage } from '@/components/LegalPage'

const SECTIONS = [
  { id: 'commitment', label: '1. Our commitment' },
  { id: 'conformance', label: '2. Conformance target' },
  { id: 'measures', label: '3. Accessibility measures' },
  { id: 'assistive', label: '4. Themes, motion and zoom' },
  { id: 'limitations', label: '5. Known limitations' },
  { id: 'third-party', label: '6. Third-party content' },
  { id: 'feedback', label: '7. Feedback and assistance' },
  { id: 'ongoing', label: '8. Ongoing evaluation' },
]

const Accessibility = () => {
  useSeo({
    title: 'Accessibility Statement',
    description:
      'Safe Home Network aims to meet WCAG 2.2 AA. Read our accessibility measures, known limitations and how to request assistance or report a barrier.',
    path: '/accessibility',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Accessibility', path: '/accessibility' },
    ]),
  })

  return (
    <LegalPage
      title="Accessibility Statement"
      description={`${SITE.name} is committed to making this website usable by as many people as possible, including visitors who use assistive technology.`}
      lastUpdated="November 6, 2026"
      crumb="Accessibility Statement"
      sections={SECTIONS}
    >
      <h2 id="commitment">1. Our commitment</h2>
      <p>
        We want every visitor to be able to research home services and reach a service line for the trade
        they need, regardless of ability or the device they use. Accessibility is treated as part of the build process
        rather than an afterthought: semantic HTML, keyboard operability and readable contrast are
        requirements on this site, not optional extras.
      </p>

      <h2 id="conformance">2. Conformance target</h2>
      <p>
        This website is designed and developed with the goal of conforming to the Web Content Accessibility
        Guidelines (WCAG) 2.2 Level AA. We use a combination of manual testing, keyboard-only navigation and
        automated checks to work toward that target. Conformance is a continuous effort; this statement
        describes the current state rather than a certification.
      </p>

      <h2 id="measures">3. Accessibility measures</h2>
      <ul>
        <li>Semantic HTML landmarks (header, navigation, main, footer) and a visible “skip to main content” link.</li>
        <li>Logical heading hierarchy on every page and descriptive page titles.</li>
        <li>Full keyboard operability, including the navigation menu, mobile drawer, FAQ accordion and ZIP code dialog.</li>
        <li>Visible focus indicators and focus management when dialogs open and close.</li>
        <li>Form labels, helper text, inline error messages and programmatic error announcements.</li>
        <li>Text alternatives for meaningful images; decorative images are hidden from assistive technology.</li>
        <li>Color combinations chosen for AA contrast in both light and dark themes.</li>
        <li>Status messages (such as availability results) exposed to screen readers.</li>
        <li>Touch targets sized for comfortable use on mobile devices.</li>
      </ul>

      <h2 id="assistive">4. Themes, motion and zoom</h2>
      <p>
        A light/dark theme toggle is available in the header and in the mobile menu, with the choice saved in
        your browser. Animations are subtle and are reduced or removed automatically when your device requests
        reduced motion. Layouts reflow for narrow screens and support browser zoom up to 200% without loss of
        content or functionality.
      </p>

      <h2 id="limitations">5. Known limitations</h2>
      <ul>
        <li>
          Content copied from third-party sources, or provider-supplied descriptions added in the future, may
          not meet the same standard until it is reviewed.
        </li>
        <li>
          Choosing a service and revealing its call buttons requires JavaScript. The service pages also list
          the same primary and alternate numbers as text, and visitors who cannot use JavaScript can reach our
          team by email at <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a>.
        </li>
        <li>
          Map-style or third-party embedded tools, if added later, may have their own accessibility
          limitations outside our control.
        </li>
      </ul>

      <h2 id="third-party">6. Third-party content</h2>
      <p>
        Some resources linked from this site are operated by third parties, including provider websites. We
        cannot guarantee their accessibility, but we welcome reports about any third-party content that
        creates a barrier to using our own.
      </p>

      <h2 id="feedback">7. Feedback and assistance</h2>
      <p>
        If you encounter an accessibility barrier, or you need information from this website in an alternative
        format, please tell us. Email{' '}
        <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> with a short description of the page
        and the problem, or use our <Link to="/contact">contact form</Link>. We aim to acknowledge
        accessibility feedback within two business days and to provide a reasonable alternative in the
        meantime.
      </p>

      <h2 id="ongoing">8. Ongoing evaluation</h2>
      <p>
        We review accessibility when adding features, run periodic automated audits, and re-test key flows
        such as the service call buttons and mobile navigation after changes. This statement will be updated
        as the site evolves.
      </p>
    </LegalPage>
  )
}

export default Accessibility
