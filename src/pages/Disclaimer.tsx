import { Link } from 'react-router-dom'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { LegalPage } from '@/components/LegalPage'
import { LaunchNotice } from '@/components/LaunchNotice'

const SECTIONS = [
  { id: 'independent', label: '1. Independent service providers' },
  { id: 'referral-model', label: '2. Our referral and connection model' },
  { id: 'no-guarantee', label: '3. No guarantee of availability' },
  { id: 'verification', label: '4. Verification and responsibility' },
  { id: 'pricing', label: '5. Pricing and quotes' },
  { id: 'content', label: '6. Informational content' },
  { id: 'emergencies', label: '7. Emergencies and safety' },
  { id: 'external', label: '8. External links and third-party content' },
  { id: 'contact', label: '9. Questions' },
]

const Disclaimer = () => {
  useSeo({
    title: 'Disclaimer',
    description:
      'Important information about the Safe Home Network referral model: independent providers, no guarantee of service quality or availability, and your verification responsibilities.',
    path: '/disclaimer',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Disclaimer', path: '/disclaimer' },
    ]),
  })

  return (
    <LegalPage
      title="Disclaimer"
      description="How our connection and referral model works, and what we do — and do not — guarantee."
      lastUpdated="November 6, 2026"
      crumb="Disclaimer"
      sections={SECTIONS}
    >
      {SITE.showLaunchNotices ? (
        <LaunchNotice title="Legal review required">
          <p>
            Review this disclaimer with counsel to confirm it matches your contracts with providers and the
            disclosure requirements in the states you operate in. It should be read together with our{' '}
            <Link to="/terms-and-conditions">Terms &amp; Conditions</Link>.
          </p>
        </LaunchNotice>
      ) : null}

      <h2 id="independent">1. Independent service providers</h2>
      <p>
        The service providers referenced on this website are independent businesses. They are not our
        employees, agents, joint venturers or partners, and we do not direct or control how they perform work.
        Each provider is solely responsible for its own licensing, permits, insurance, employees,
        subcontractors, pricing, scheduling, workmanship and compliance with applicable law.
      </p>

      <h2 id="referral-model">2. Our referral and connection model</h2>
      <p>
        {SITE.name} operates a directory and referral platform. We help homeowners learn about home service
        categories, check whether providers are listed for their ZIP code, and — where available — review
        provider contact options. We do not perform home repairs or improvements, and we do not act as a
        contractor, construction manager, inspection service, warranty provider or insurer of any kind.
      </p>
      <p>
        We may receive compensation from participating providers when we connect them with homeowners. This
        does not change the price a provider quotes you, and it does not create an obligation for you to hire
        any provider.
      </p>

      <h2 id="no-guarantee">3. No guarantee of availability</h2>
      <p>
        Availability of any service depends on participating providers and their coverage areas at the time of
        your request. Coverage information reflects our records as of its last review and may change without
        notice. A positive availability result is not a commitment that a provider will contact you, accept
        your project, or perform work within any particular timeline.
      </p>

      <h2 id="verification">4. Verification and responsibility</h2>
      <p>
        We do not verify, certify or endorse provider licensing, insurance coverage, bonding, work history or
        customer satisfaction, and nothing on this website should be read as such an endorsement. Before
        engaging any provider, you should independently:
      </p>
      <ul>
        <li>Confirm the provider’s license or registration with your state or local licensing authority.</li>
        <li>Request a current certificate of insurance and confirm it covers the work being performed.</li>
        <li>Ask for a written contract that states scope, materials, timeline, payment schedule and warranty terms.</li>
        <li>Confirm who is responsible for permits and inspections.</li>
        <li>Check references or reviews from sources you trust.</li>
      </ul>

      <h2 id="pricing">5. Pricing and quotes</h2>
      <p>
        We do not provide estimates, quotes or pricing guidance for any project. Any pricing, fee, warranty or
        financing information you receive comes from the provider. Prices vary by region, season, materials,
        site conditions and scope, and a quote from one provider is not a guarantee that another provider will
        match it.
      </p>

      <h2 id="content">6. Informational content</h2>
      <p>
        Articles, service descriptions and FAQs on this website are written to help homeowners understand
        common projects and ask better questions. They are general information, not professional advice, and
        they may not reflect your specific property, local building code, or the current state of a trade
        practice. Always confirm details with a qualified professional and your local building department.
      </p>

      <h2 id="emergencies">7. Emergencies and safety</h2>
      <p>
        This website is not an emergency service. If you smell gas, see sparks or smoke, have active water
        entering your home, or face any immediate risk to safety, leave the area if necessary and contact the
        appropriate emergency service, utility or a qualified local provider directly.
      </p>

      <h2 id="external">8. External links and third-party content</h2>
      <p>
        Links to provider websites or other third-party resources are provided for convenience. We do not
        control and are not responsible for third-party content, policies or practices.
      </p>

      <h2 id="contact">9. Questions</h2>
      <p>
        If anything in this disclaimer is unclear, contact us at{' '}
        <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> before relying on any information on
        the website.
      </p>
    </LegalPage>
  )
}

export default Disclaimer
