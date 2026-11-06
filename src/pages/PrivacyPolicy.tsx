import { Link } from 'react-router-dom'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { LegalPage } from '@/components/LegalPage'
import { LaunchNotice } from '@/components/LaunchNotice'

const SECTIONS = [
  { id: 'overview', label: '1. Overview' },
  { id: 'information-we-collect', label: '2. Information we collect' },
  { id: 'zip-code', label: '3. ZIP code information' },
  { id: 'contact-form', label: '4. Contact form information' },
  { id: 'cookies', label: '5. Cookies and analytics' },
  { id: 'advertising', label: '6. Advertising and call tracking' },
  { id: 'sharing', label: '7. How we share information' },
  { id: 'sale', label: '8. No sale of personal information' },
  { id: 'retention', label: '9. Data retention' },
  { id: 'security', label: '10. Security' },
  { id: 'rights', label: '11. Your privacy rights' },
  { id: 'children', label: "12. Children's privacy" },
  { id: 'third-party', label: '13. Third-party links' },
  { id: 'changes', label: '14. Changes to this policy' },
  { id: 'contact', label: '15. Contact us' },
]

const PrivacyPolicy = () => {
  useSeo({
    title: 'Privacy Policy',
    description:
      'How Safe Home Network collects, uses, shares and protects personal information, including ZIP code lookups, contact form data, cookies and your privacy rights.',
    path: '/privacy-policy',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Privacy Policy', path: '/privacy-policy' },
    ]),
  })

  return (
    <LegalPage
      title="Privacy Policy"
      description={`This policy explains what ${SITE.name} collects, why we collect it, and the choices you have.`}
      lastUpdated="November 6, 2026"
      crumb="Privacy Policy"
      sections={SECTIONS}
    >
      {SITE.showLaunchNotices ? (
        <LaunchNotice title="Legal review required">
          <p>
            This policy is written for a home services connection and referral business and reflects how this
            website is built. It is a starting point, not legal advice. Have counsel review it against your
            actual data practices, vendor list and state obligations before launch, and complete the entity
            name in{' '}
            <code className="rounded bg-black/5 px-1 dark:bg-white/10">src/config/site.ts</code>.
          </p>
        </LaunchNotice>
      ) : null}

      <h2 id="overview">1. Overview</h2>
      <p>
        {SITE.name} (“{SITE.name},” “we,” “us,” or “our”) operates this website as a home services connection
        and referral platform for homeowners in the United States. This Privacy Policy describes how we
        collect, use, disclose and retain information when you visit our website, check service availability
        with a ZIP code, submit a contact form, or interact with our content.
      </p>
      <p>
        By using the website, you agree to the practices described here. If you do not agree, please do not
        use the website.
      </p>

      <h2 id="information-we-collect">2. Information we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>Name, email address and any other details you include in a contact form submission.</li>
        <li>The subject and content of your message, including a service category and ZIP code if you include them.</li>
        <li>Consent records, such as the date and time you agreed to be contacted.</li>
        <li>
          Information you provide when corresponding with us by email or when requesting a provider connection.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>Browser and device information, such as browser type, operating system and screen size.</li>
        <li>Approximate location derived from IP address, at the city or regional level.</li>
        <li>Pages viewed, referring URLs, and interactions with site features such as the availability checker.</li>
        <li>Standard server log information, including IP address and timestamps.</li>
      </ul>

      <h2 id="zip-code">3. ZIP code information</h2>
      <p>
        The availability checker asks for a five-digit US ZIP code. We use that ZIP code to compare your
        location against our service coverage records for the category you selected. Coverage lookups are
        performed to answer your request in that session.
      </p>
      <p>
        A ZIP code identifies an area, not a household. We do not use ZIP code entries to attempt to identify
        a specific person or address. If you choose to submit a contact request, we may retain the ZIP code
        together with your message so our team can respond accurately.
      </p>

      <h2 id="contact-form">4. Contact form information</h2>
      <p>
        When you submit our contact form, we collect the information required to respond: your name, email
        address, subject, message and consent acknowledgement. We use this information to reply to your
        inquiry and, where you ask us to, to help identify providers listed in your area.
      </p>
      <p>
        We may share the details necessary to respond to your request with a participating provider, but only
        when you ask us to connect you. We do not send your contact details to providers as part of a routine
        ZIP code check.
      </p>
      <p>
        Please do not submit sensitive information such as Social Security numbers, financial account numbers
        or government identification through the contact form.
      </p>

      <h2 id="cookies">5. Cookies and analytics</h2>
      <p>
        We use browser storage and cookies for a small number of purposes:
      </p>
      <ul>
        <li>
          <strong>Essential storage</strong> — remembering your light or dark theme preference and your cookie
          consent choice. These are set by us and are necessary for the site to work as intended.
        </li>
        <li>
          <strong>Analytics</strong> — only where you have consented, we may use analytics to understand which
          pages are visited and how the availability checker is used, so we can improve the site. Analytics
          data is aggregated and is not used to identify individuals.
        </li>
      </ul>
      <p>
        You can change your choice at any time using the “Cookie settings” link in the footer, and you can
        block or delete cookies in your browser settings. Blocking essential storage may affect theme
        persistence.
      </p>

      <h2 id="advertising">6. Advertising and call-tracking technologies</h2>
      <p>
        If we enable advertising or call-tracking technologies, they will be used to measure the performance
        of the website and understand how visitors reach us. Call-tracking platforms may display a tracking
        phone number in place of a business number and record the source of a call. When such a platform is
        active, it operates under its own privacy policy and may set its own cookies.
      </p>
      <p>
        At the time of publication, this website does not load third-party advertising or call-tracking
        scripts unless a provider has been explicitly configured. Where consent is required, these
        technologies will not load until you accept analytics cookies.
      </p>

      <h2 id="sharing">7. How we share information</h2>
      <p>We share information only in the following circumstances:</p>
      <ul>
        <li>
          <strong>At your request</strong> — with participating providers when you ask us to connect you about
          a specific service.
        </li>
        <li>
          <strong>Service providers</strong> — vendors that host the website, deliver email or forms, or
          provide analytics, under contracts that limit their use of the information.
        </li>
        <li>
          <strong>Legal reasons</strong> — when required by law, subpoena or court order, or to protect our
          rights, property or users.
        </li>
        <li>
          <strong>Business transfers</strong> — in connection with a merger, acquisition or sale of assets,
          subject to this policy’s protections.
        </li>
        <li>
          <strong>Aggregated data</strong> — de-identified, aggregated statistics about site usage and
          coverage demand.
        </li>
      </ul>

      <h2 id="sale">8. No sale of personal information</h2>
      <p>
        We do not sell personal information, and we do not share personal information for cross-context
        behavioral advertising as those terms are defined under applicable state privacy laws. For details and
        how to submit a request, see our{' '}
        <Link to="/do-not-sell-or-share">Do Not Sell or Share My Personal Information</Link> page.
      </p>

      <h2 id="retention">9. Data retention</h2>
      <p>
        We retain contact form submissions and related correspondence for as long as needed to respond to
        your request, resolve any follow-up, and meet legal, tax or recordkeeping obligations. Server logs and
        analytics data are retained for shorter periods for security and performance analysis. When
        information is no longer needed, we delete it or de-identify it.
      </p>

      <h2 id="security">10. Security</h2>
      <p>
        We use administrative, technical and physical safeguards designed to protect the information we hold,
        including encrypted transmission (HTTPS), access controls and vendor due diligence. No method of
        transmission or storage is completely secure, so we cannot guarantee absolute security. If we become
        aware of a breach affecting your personal information, we will notify you and the relevant authorities
        as required by law.
      </p>

      <h2 id="rights">11. Your privacy rights</h2>
      <p>
        Depending on where you live, you may have the right to request access to the personal information we
        hold about you, request correction or deletion, request a portable copy, or opt out of certain
        processing. California residents have rights under the CCPA/CPRA; residents of other states with
        comprehensive privacy laws may have comparable rights.
      </p>
      <p>
        To exercise a right, email{' '}
        <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> with the subject “Privacy Request.”
        We will verify your request using information you provide and respond within the timeframe required by
        applicable law. You may use an authorized agent where the law allows. We will not discriminate against
        you for exercising your privacy rights.
      </p>

      <h2 id="children">12. Children’s privacy</h2>
      <p>
        The website is intended for adults arranging home services. It is not directed to children, and we do
        not knowingly collect personal information from children under 13. If you believe a child has provided
        us personal information, contact us and we will delete it.
      </p>

      <h2 id="third-party">13. Third-party links</h2>
      <p>
        The website may link to third-party websites, including provider websites. We are not responsible for
        the privacy practices or content of those sites. Review their policies before providing information.
      </p>

      <h2 id="changes">14. Changes to this policy</h2>
      <p>
        We may update this policy to reflect changes in our practices or the law. When we do, we will update
        the “Last updated” date above. Material changes may be communicated through a notice on the website.
      </p>

      <h2 id="contact">15. Contact us</h2>
      <p>
        Questions about this policy or our data practices? Email{' '}
        <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> or use our{' '}
        <Link to="/contact">contact form</Link>. {SITE.legalName} is responsible for the personal information
        described in this policy.
      </p>
    </LegalPage>
  )
}

export default PrivacyPolicy
