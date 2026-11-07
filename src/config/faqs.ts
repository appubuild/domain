import type { FaqItem } from '@/types'

/** Homepage / globally relevant questions. Service-specific FAQs live in services.ts. */
export const HOME_FAQS: FaqItem[] = [
  {
    question: 'Does Safe Home Network perform home repairs?',
    answer:
      'No. We are a connection and referral platform. We do not employ technicians, dispatch crews or perform any of the work listed on this site. The phone lines on this site connect you with independent providers who perform the work and set their own pricing, scheduling and warranty terms.',
  },
  {
    question: 'Is it free to use Safe Home Network?',
    answer:
      'Browsing the site and calling a service line is free for homeowners and carries no obligation. We may receive compensation from participating providers when we connect them with a homeowner, which is how the platform is funded. That compensation does not change the price a provider quotes you.',
  },
  {
    question: 'How do the Call Now buttons work?',
    answer:
      'Choose the service you need and a Call Now button appears for that service. It opens the primary and alternate phone numbers assigned to that trade. Tapping a button starts a normal phone call on your device — we never dial automatically, forward your call or connect you without your action.',
  },
  {
    question: 'Should I call the primary or the alternate number?',
    answer:
      'Start with the primary line. If it is busy or does not answer, the alternate line is the same service category reachable by a second number. Both are published service lines for that trade, and neither is a general switchboard for every category.',
  },
  {
    question: 'Do I need to enter a ZIP code?',
    answer:
      'No. The site no longer asks for a ZIP code. You pick a service and call the line assigned to it, and the provider you reach confirms what is available at your address. We removed the ZIP check rather than publish coverage answers we could not verify.',
  },
  {
    question: 'Are the providers licensed and insured?',
    answer:
      'Providers are independent businesses and are responsible for holding whatever licenses, permits, registrations and insurance their trade and jurisdiction require. Licensing rules vary by state and locality, so ask the provider directly and verify credentials with your state or local licensing authority before work begins.',
  },
  {
    question: 'What happens to the information I share?',
    answer:
      'The website does not collect a ZIP code or location. If you email or message our team, we use your contact details only to respond to your request. We do not sell personal information. See our Privacy Policy and Do Not Sell or Share page for the full details and your choices.',
  },
]

export const HOW_IT_WORKS_FAQS: FaqItem[] = [
  {
    question: 'Do I have to choose a provider through Safe Home Network?',
    answer:
      'No. The platform exists to make discovery easier, not to lock you in. You are always free to compare other providers, request additional quotes, or walk away entirely.',
  },
  {
    question: 'How are service lines assigned to trades?',
    answer:
      'Each trade has its own published line, stored in one central directory. A roofing call always goes to the roofing line, plumbing to the plumbing line, and so on — a number is never reused across unrelated trades, and no number is invented.',
  },
  {
    question: 'What if a service has no phone line yet?',
    answer:
      'A few categories do not have a published line yet. Those pages say so plainly and offer our contact form instead of showing a number that might belong to a different trade.',
  },
  {
    question: 'What information should I have ready before I call?',
    answer:
      'Have a short description of the problem, photos if the issue is visible, the age of the home or equipment if you know it, and a rough budget range. Ask whether the provider charges a service or diagnostic fee before they visit.',
  },
  {
    question: 'How quickly will a provider respond?',
    answer:
      'Response times are set by each independent provider and vary by season and demand. Emergency categories such as active water intrusion or a roof leak during a storm are usually best handled by calling the provider or your insurer directly.',
  },
]
