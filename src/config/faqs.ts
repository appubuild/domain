import type { FaqItem } from '@/types'

/** Homepage / globally relevant questions. Service-specific FAQs live in services.ts. */
export const HOME_FAQS: FaqItem[] = [
  {
    question: 'Does Safe Home Network perform home repairs?',
    answer:
      'No. We are a connection and referral platform. We do not employ technicians, dispatch crews or perform any of the work listed on this site. When you request a connection, you are matched with independent providers who perform the work and set their own pricing, scheduling and warranty terms.',
  },
  {
    question: 'Is it free to use Safe Home Network?',
    answer:
      'Checking availability and requesting information is free for homeowners and carries no obligation. We may receive compensation from participating providers when we connect them with a homeowner, which is how the platform is funded. That compensation does not change the price a provider quotes you.',
  },
  {
    question: 'How does the ZIP code checker work?',
    answer:
      'You choose a service and enter a 5-digit US ZIP code. We compare it against our coverage records for that service. If we have verified coverage, we show you the provider options listed for that area. If coverage is not verified, we say so and invite you to contact our team instead of guessing.',
  },
  {
    question: 'Does checking availability guarantee a provider will contact me?',
    answer:
      'No. Availability depends on participating providers and their coverage areas, and provider rosters change. A result means a service is or is not listed in our records for that ZIP code — it is not a booking, a quote, or a guarantee of service.',
  },
  {
    question: 'Are the providers licensed and insured?',
    answer:
      'Providers are independent businesses and are responsible for holding whatever licenses, permits, registrations and insurance their trade and jurisdiction require. Licensing rules vary by state and locality, so ask the provider directly and verify credentials with your state or local licensing authority before work begins.',
  },
  {
    question: 'Which areas do you cover?',
    answer:
      'Coverage varies by service and expands as providers join. The only reliable way to check is to run a ZIP code search for the service you need. If your area is not listed yet, contact our team and we will let you know when coverage changes.',
  },
  {
    question: 'What happens to the information I share?',
    answer:
      'We use your ZIP code to check coverage and your contact details to respond to your request. We do not sell personal information. See our Privacy Policy and Do Not Sell or Share page for the full details and your choices.',
  },
]

export const HOW_IT_WORKS_FAQS: FaqItem[] = [
  {
    question: 'Do I have to choose a provider through Safe Home Network?',
    answer:
      'No. The platform exists to make discovery easier, not to lock you in. You are always free to compare other providers, request additional quotes, or walk away entirely.',
  },
  {
    question: 'How are providers added to the directory?',
    answer:
      'Providers join by agreeing to be listed for specific service categories and coverage areas. We record the category, coverage and contact details they authorize us to publish. Providers remain responsible for their own licensing and insurance.',
  },
  {
    question: 'Why does a ZIP code sometimes show "coverage not verified"?',
    answer:
      'Because we would rather say that than guess. Coverage data is maintained per service and must be confirmed before we display it. When we have no verified record for a service area, the checker tells you to contact our team.',
  },
  {
    question: 'What information should I have ready before I call a provider?',
    answer:
      'Have your ZIP code, a short description of the problem, photos if the issue is visible, the age of the home or equipment if you know it, and a rough budget range. Ask whether the provider charges a service or diagnostic fee before they visit.',
  },
  {
    question: 'How quickly will a provider respond?',
    answer:
      'Response times are set by each independent provider and vary by season and demand. Emergency categories such as active water intrusion or a roof leak during a storm are usually best handled by calling the provider or your insurer directly.',
  },
]
