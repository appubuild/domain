import { Link } from 'react-router-dom'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { LegalPage } from '@/components/LegalPage'

const SECTIONS = [
  { id: 'acceptance', label: '1. Acceptance of terms' },
  { id: 'services', label: '2. What this website provides' },
  { id: 'no-contractor', label: '3. We are not a contractor' },
  { id: 'providers', label: '4. Independent providers' },
  { id: 'availability', label: '5. Availability and accuracy' },
  { id: 'acceptable-use', label: '6. Acceptable use' },
  { id: 'intellectual-property', label: '7. Intellectual property' },
  { id: 'third-party', label: '8. Third-party links' },
  { id: 'disclaimer', label: '9. Disclaimers' },
  { id: 'liability', label: '10. Limitation of liability' },
  { id: 'indemnity', label: '11. Indemnification' },
  { id: 'law', label: '12. Governing law and disputes' },
  { id: 'changes', label: '13. Changes and termination' },
  { id: 'contact', label: '14. Contact' },
]

const TermsAndConditions = () => {
  useSeo({
    title: 'Terms & Conditions',
    description:
      'The terms that govern use of the Safe Home Network website, including the service discovery and referral model, provider relationships and limitations of liability.',
    path: '/terms-and-conditions',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Terms & Conditions', path: '/terms-and-conditions' },
    ]),
  })

  return (
    <LegalPage
      title="Terms & Conditions"
      description={`These terms govern your use of ${SITE.name} and explain the limits of what our platform provides.`}
      lastUpdated="November 6, 2026"
      crumb="Terms & Conditions"
      sections={SECTIONS}
    >

      <h2 id="acceptance">1. Acceptance of terms</h2>
      <p>
        These Terms &amp; Conditions (“Terms”) form a binding agreement between you and {SITE.legalName} (“
        {SITE.name},” “we,” “us,” or “our”) governing your use of this website. By accessing or using the
        website, you accept these Terms. If you do not agree, do not use the website.
      </p>

      <h2 id="services">2. What this website provides</h2>
      <p>
        {SITE.name} is a home services discovery and referral platform. The website provides educational
        content about home service categories, published telephone lines that connect homeowners with
        independent service providers for a given trade, and information about those providers where it has
        been authorized for publication.
      </p>
      <p>
        The website is free for homeowners to browse and use. We may receive compensation from participating
        providers when we connect them with a homeowner. Compensation does not change the price a provider
        quotes you, and it does not obligate you to hire anyone.
      </p>

      <h2 id="no-contractor">3. We are not a contractor</h2>
      <p>
        We do not perform, supervise, inspect or warrant any home repair, installation, remodeling,
        restoration or maintenance work. We do not employ or dispatch technicians, and we are not a party to
        any agreement you enter into with a provider. Any work performed is performed solely by the
        independent provider you engage, under that provider’s own contract, pricing, schedule, warranty and
        insurance.
      </p>

      <h2 id="providers">4. Independent providers</h2>
      <p>
        Providers listed on or introduced through this website are independent businesses. They are
        responsible for:
      </p>
      <ul>
        <li>Holding all licenses, registrations, permits and insurance required by their trade and jurisdiction.</li>
        <li>Complying with building codes, permit and inspection requirements.</li>
        <li>The accuracy of the information they provide about their services, coverage and pricing.</li>
        <li>The quality, safety, timeliness and outcome of the work they perform.</li>
        <li>Their own employees, subcontractors and agents.</li>
      </ul>
      <p>
        We do not verify, endorse or guarantee any provider’s licensing, insurance, workmanship, pricing or
        availability. You are responsible for conducting your own due diligence before engaging a provider,
        including confirming licensing and insurance with the appropriate state or local authority and
        obtaining a written contract and scope of work.
      </p>

      <h2 id="availability">5. Availability and accuracy</h2>
      <p>
        Coverage results reflect the coverage records we maintain for each service and are based on
        participating providers and their stated service areas. Coverage changes over time and may not reflect
        every provider operating in a given ZIP code. A result indicating availability is not a booking, a
        quote, a commitment by any provider to respond, or a guarantee that service will be performed.
      </p>
      <p>
        Content on this website is provided for general informational purposes. It is not a substitute for a
        professional on-site assessment, a building inspection, engineering advice, or the advice of a
        licensed tradesperson.
      </p>

      <h2 id="acceptable-use">6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the website for any unlawful purpose or in violation of these Terms.</li>
        <li>Submit false, misleading or fraudulent information, or impersonate another person.</li>
        <li>Use automated means to scrape, harvest or datamine the website or submit bulk requests.</li>
        <li>Attempt to gain unauthorized access to any system, interfere with site operations, or probe for vulnerabilities.</li>
        <li>Use the website to send unsolicited advertising or to contact providers for purposes unrelated to a genuine home service request.</li>
        <li>Reproduce, resell or redistribute our content without written permission.</li>
      </ul>

      <h2 id="intellectual-property">7. Intellectual property</h2>
      <p>
        The website’s design, text, graphics, logos, icons, images, arrangement and software are owned by us
        or licensed to us and are protected by intellectual property laws. You may view and print pages for
        your own non-commercial use. Any other use — including reproduction, modification, distribution,
        framing or creation of derivative works — requires our prior written consent. Third-party trademarks
        and imagery remain the property of their respective owners.
      </p>

      <h2 id="third-party">8. Third-party links</h2>
      <p>
        The website may contain links to third-party websites, including provider websites. We do not control
        and are not responsible for the content, availability, accuracy, policies or practices of those sites.
        Following a third-party link is at your own risk.
      </p>

      <h2 id="disclaimer">9. Disclaimers</h2>
      <p>
        THE WEBSITE AND ALL CONTENT ARE PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND,
        EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        NON-INFRINGEMENT AND ACCURACY. We do not warrant that the website will be uninterrupted, error-free or
        free of harmful components, or that any coverage information, provider information or content is
        complete, current or accurate. Some jurisdictions do not allow the exclusion of certain warranties, so
        some exclusions may not apply to you.
      </p>

      <h2 id="liability">10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, {SITE.legalName.toUpperCase()} AND ITS OFFICERS, DIRECTORS,
        EMPLOYEES, AGENTS AND AFFILIATES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
        CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL OR
        USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE WEBSITE OR ANY WORK PERFORMED BY A PROVIDER,
        WHETHER BASED IN CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY OR OTHERWISE, EVEN IF WE HAVE BEEN
        ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        TO THE EXTENT PERMITTED BY LAW, OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING
        TO THE WEBSITE WILL NOT EXCEED ONE HUNDRED US DOLLARS (US $100). Some jurisdictions do not allow
        certain limitations, so parts of this section may not apply to you.
      </p>

      <h2 id="indemnity">11. Indemnification</h2>
      <p>
        You agree to indemnify, defend and hold harmless {SITE.legalName} and its officers, directors,
        employees, agents and affiliates from any claims, liabilities, damages, losses and expenses (including
        reasonable legal fees) arising out of your use of the website, your violation of these Terms, or your
        dealings with any provider.
      </p>

      <h2 id="law">12. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the United States and the state in which {SITE.legalName} is
        organized, without regard to conflict-of-law principles. Before filing any formal action, you agree to
        contact us and attempt to resolve the dispute informally. Any dispute not resolved informally will be
        brought in the state or federal courts located in that state, and you consent to their jurisdiction,
        unless applicable law requires otherwise.
      </p>
      <p>
        Nothing in these Terms limits any non-waivable rights you have under applicable consumer protection
        law.
      </p>

      <h2 id="changes">13. Changes and termination</h2>
      <p>
        We may modify these Terms at any time by posting an updated version with a revised “Last updated”
        date. Continued use of the website after changes are posted constitutes acceptance. We may suspend or
        discontinue all or part of the website at any time without notice. Sections concerning disclaimers,
        liability, indemnification and intellectual property survive termination.
      </p>

      <h2 id="contact">14. Contact</h2>
      <p>
        Questions about these Terms? Email{' '}
        <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> or use our{' '}
        <Link to="/contact">contact form</Link>. See also our{' '}
        <Link to="/privacy-policy">Privacy Policy</Link> and <Link to="/disclaimer">Disclaimer</Link>.
      </p>
    </LegalPage>
  )
}

export default TermsAndConditions
