import { useNavigate } from 'react-router-dom';
import { Seo } from '@/components/shared/Seo';
import { BreadcrumbBar } from '@/components/shared/sections';
import { Button, Card, CardContent } from '@/components/ui/primitives';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}

const CONTACT_BLOCK: LegalSection = {
  heading: 'How to reach us about this policy',
  paragraphs: [
    'Rights, takedown and compliance notices: rights@scriptora.app. Support and account questions: support@scriptora.app.',
    'Written notices should include your name, contact details, the specific material concerned, the URL where it appears, and a statement of the right you are asserting.',
  ],
};

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  terms: {
    slug: 'terms',
    title: 'Terms of service',
    summary: 'The agreement between you and Scriptora for using the writing, design, publishing and selling tools.',
    updated: '2026-09-01',
    sections: [
      {
        heading: '1. What Scriptora is',
        paragraphs: [
          'Scriptora is a book creation and publishing platform. It provides writing, design, formatting, export and marketplace tools so that an author can take a book from a blank page to a published product.',
          'This build of the product runs entirely in your browser against a local database. Creating an account, publishing a book, and buying a book are simulated operations used to demonstrate the complete product workflow.',
        ],
      },
      {
        heading: '2. Your account',
        paragraphs: [
          'You are responsible for the accuracy of the information on your account and for keeping your credentials secure.',
          'You must be old enough to enter a binding contract in your jurisdiction. Accounts may be suspended where we detect fraud, abuse, or a violation of these terms.',
        ],
        bullets: [
          'One person, one account. Team seats may be added on eligible plans.',
          'Do not share access in a way that defeats per-seat licensing.',
          'Tell us promptly if you believe your account has been compromised.',
        ],
      },
      {
        heading: '3. Your content',
        paragraphs: [
          'You keep every right you hold in the manuscripts, images, fonts and metadata you upload. We claim no ownership over your work.',
          'You grant us the limited licence needed to operate the service: to store your files, render exports, generate previews, and — only if you list a book for sale — to display and distribute it through the marketplace.',
        ],
        bullets: [
          'Deleting a book removes it from the marketplace immediately.',
          'Exporting your manuscript is always available, including DOCX and plain text.',
          'We do not train models on your manuscripts in this product.',
        ],
      },
      {
        heading: '4. Acceptable use',
        paragraphs: ['Do not use Scriptora to publish or distribute material that infringes rights, defames, harasses, sexualises minors, or is unlawful in the jurisdictions where the book is offered for sale.'],
        bullets: [
          'No plagiarism, including unattributed AI-generated text presented as another author’s work.',
          'No malware, phishing or deceptive content in any exported file.',
          'No attempts to bypass entitlement limits, rate limits or moderation.',
        ],
      },
      {
        heading: '5. AI assistance',
        paragraphs: [
          'AI features produce suggestions. You decide whether to insert, replace or discard them, and you are responsible for the content of your finished book.',
          'Credit costs are declared before an action runs. Unused credits do not carry between billing periods, and credits are not refundable.',
        ],
      },
      {
        heading: '6. Subscriptions and billing',
        paragraphs: [
          'Paid plans renew automatically until cancelled. You can cancel at any time from the subscription screen and keep access until the end of the paid period.',
          'Downgrading never deletes your work. It reduces the limits applied to new books, exports, AI usage and marketplace selling.',
        ],
      },
      {
        heading: '7. Marketplace sales',
        paragraphs: [
          'You set the price of your book. We retain the platform commission for your plan and pass the remainder to you on the published payout schedule.',
          'Refunds within the published window are deducted from future earnings, and negative balances are carried forward rather than invoiced.',
        ],
      },
      {
        heading: '8. Availability and liability',
        paragraphs: [
          'We aim for high availability but do not guarantee uninterrupted service. The service is provided as-is, and our aggregate liability is limited to the greater of the fees you paid in the previous twelve months or one hundred US dollars.',
        ],
      },
      {
        heading: '9. Changes to these terms',
        paragraphs: ['We will give reasonable notice of material changes. Continuing to use the service after a change takes effect constitutes acceptance of the updated terms.'],
      },
      CONTACT_BLOCK,
    ],
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy policy',
    summary: 'What data Scriptora processes, why, where it lives, and the controls available to you.',
    updated: '2026-09-01',
    sections: [
      {
        heading: '1. Summary',
        paragraphs: [
          'We collect the minimum needed to run a book platform: your account details, the content you create, and the technical data required to keep the service secure and working.',
          'We do not sell personal data, and we do not use your manuscripts to train models.',
        ],
      },
      {
        heading: '2. Data we process',
        paragraphs: ['The categories below cover everything this product stores. In the current build, all of it lives in your own browser.'],
        bullets: [
          'Account: name, email, password hash, plan, locale, country.',
          'Content: books, chapters, pages, designs, assets, comments, notes.',
          'Commerce: orders, receipts, refunds, payout summary, pricing.',
          'Technical: session data, theme preference, notification history.',
        ],
      },
      {
        heading: '3. Why we process it',
        paragraphs: [
          'To provide the service, fulfil orders, prevent abuse, support you when you ask for help, and meet legal obligations such as tax reporting on payouts.',
          'Analytics in this build are derived locally from your own database. A production deployment would use a privacy-respecting, cookie-free measurement service.',
        ],
      },
      {
        heading: '4. Where your data lives',
        paragraphs: [
          'In this build, your database is stored in your browser’s local storage and never transmitted. A production deployment would store data in a managed PostgreSQL cluster with encrypted object storage for assets.',
        ],
      },
      {
        heading: '5. Your controls',
        paragraphs: ['You can export everything, reset the entire database, or delete individual books at any time from Settings.'],
        bullets: [
          'Export a full JSON copy of your workspace from Settings → Data.',
          'Reset the demo database to its seeded state at any time.',
          'Delete a book permanently from the trash view, including its assets.',
        ],
      },
      {
        heading: '6. Children',
        paragraphs: ['Accounts are intended for users old enough to contract independently. We do not knowingly collect data from younger children without guardian consent.'],
      },
      CONTACT_BLOCK,
    ],
  },
  'refund-policy': {
    slug: 'refund-policy',
    title: 'Refund policy',
    summary: 'How refunds work for marketplace purchases and platform subscriptions.',
    updated: '2026-09-01',
    sections: [
      {
        heading: '1. Marketplace book purchases',
        paragraphs: [
          'Books bought through the Scriptora marketplace can be refunded within 14 days of purchase, provided the book has not been substantially read and no export has been taken.',
          'Refunds are processed to the original payment method. Where a refund is issued, the author’s earnings for that sale are reversed.',
        ],
        bullets: [
          'Self-service refunds are available from Library → Order details.',
          'Free books need no refund, but you may remove them from your library.',
          'Repeat refund behaviour may result in purchase restrictions.',
        ],
      },
      {
        heading: '2. Subscriptions',
        paragraphs: [
          'Monthly plans can be cancelled at any time and remain active until the end of the paid period. Annual plans are refundable on a pro-rata basis in the first 30 days.',
          'If we make a material change that removes a feature you specifically paid for, we will offer a pro-rata refund on request.',
        ],
      },
      {
        heading: '3. AI credits',
        paragraphs: ['Credits are consumed on use and are not refundable, including where a suggestion is discarded. Failed generations do not consume credits.'],
      },
      {
        heading: '4. How to request a refund',
        paragraphs: [
          'Marketplace purchases: open the book in your library and choose Request refund. Subscriptions: open Subscription → Billing history → Request refund on the invoice.',
          'If a self-service option is unavailable, contact support@scriptora.app with your order or invoice number and we will respond within one business day.',
        ],
      },
      CONTACT_BLOCK,
    ],
  },
  copyright: {
    slug: 'copyright',
    title: 'Copyright and DMCA policy',
    summary: 'How we handle infringement claims, counter-notices and repeat infringers on the marketplace.',
    updated: '2026-09-01',
    sections: [
      {
        heading: '1. Our position',
        paragraphs: [
          'Scriptora hosts author-uploaded works. We do not review every book before publication, and authors are responsible for ensuring they hold the necessary rights.',
          'We respond to complete, good-faith takedown notices by removing or disabling access to the material promptly.',
        ],
      },
      {
        heading: '2. Filing a notice',
        paragraphs: ['Send notices to rights@scriptora.app. A valid notice must include:'],
        bullets: [
          'Identification of the copyrighted work you say has been infringed.',
          'The exact URL of the material on Scriptora.',
          'Your name, address, telephone number and email address.',
          'A statement of good-faith belief that the use is unauthorised.',
          'A statement, under penalty of perjury, that the information is accurate and that you are the rights holder or authorised to act for them.',
          'Your physical or electronic signature.',
        ],
      },
      {
        heading: '3. Counter-notices',
        paragraphs: [
          'If your book was removed and you believe the removal was mistaken, you may submit a counter-notice with the same contact details, identification of the removed material, and a statement consenting to the jurisdiction of the appropriate court.',
          'We may restore the material after ten business days unless the original complainant informs us that they have filed an action.',
        ],
      },
      {
        heading: '4. Repeat infringers',
        paragraphs: ['Accounts that receive repeated substantiated notices are suspended and, where appropriate, terminated, with associated listings removed. Payout balances tied to infringing sales may be reversed.'],
      },
      {
        heading: '5. Author rights in your own work',
        paragraphs: ['You retain copyright in everything you write and upload. Publishing with Scriptora is a licence to distribute, not a transfer of ownership, and it is not exclusive unless you separately agree otherwise.'],
      },
      CONTACT_BLOCK,
    ],
  },
  'community-guidelines': {
    slug: 'community-guidelines',
    title: 'Community guidelines',
    summary: 'Expectations for authors, reviewers and collaborators across the Scriptora platform.',
    updated: '2026-09-01',
    sections: [
      {
        heading: '1. The short version',
        paragraphs: ['Write what you want. Treat readers, reviewers and collaborators decently. Do not use the platform to harm or deceive people.'],
      },
      {
        heading: '2. Books and content',
        paragraphs: ['We host a wide range of material, including difficult and adult subjects. Some lines are absolute.'],
        bullets: [
          'No sexual content involving minors, ever.',
          'No content that incites violence or hatred against a protected group.',
          'No plagiarism, and no misrepresenting AI output as another person’s work.',
          'No instructions for causing serious harm, and no malware in exported files.',
          'Adult material must be marked clearly and listed in the appropriate category.',
        ],
      },
      {
        heading: '3. Reviews and ratings',
        paragraphs: ['Reviews should reflect a genuine reading experience. We remove reviews that are abusive, spoiler-laden without warning, or written to manipulate ratings.'],
        bullets: [
          'Do not review your own book, or a competitor’s, to move the rating.',
          'Do not offer incentives for reviews.',
          'Report a review that breaks these rules and a moderator will assess it.',
        ],
      },
      {
        heading: '4. Collaboration',
        paragraphs: ['Editors, designers and beta readers can be invited to a book with a defined role. Use the role that reflects what they need.'],
        bullets: [
          'Owner: full control, including deletion and payouts.',
          'Editor: write and comment access.',
          'Viewer: read-only access to the manuscript.',
        ],
      },
      {
        heading: '5. Moderation and appeals',
        paragraphs: [
          'Moderation decisions are recorded in the admin audit log with a reason. If you believe a decision was wrong, reply to the notification or email support and a different moderator will review it.',
        ],
      },
      CONTACT_BLOCK,
    ],
  },
};

export function LegalPageView({ documentKey }: { documentKey: keyof typeof LEGAL_DOCUMENTS }) {
  const navigate = useNavigate();
  const doc = LEGAL_DOCUMENTS[documentKey];
  const others = Object.values(LEGAL_DOCUMENTS).filter((entry) => entry.slug !== doc.slug);

  return (
    <>
      <Seo title={doc.title} description={doc.summary} canonical={`/${doc.slug}`} noIndex />
      <div className="container">
        <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: doc.title }]} />
      </div>
      <div className="container grid gap-8 pb-12 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardContent>
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
              <nav aria-label="Document sections" className="mt-2 space-y-1.5">
                {doc.sections.map((section, index) => (
                  <a
                    key={section.heading}
                    href={`#section-${index}`}
                    className="block text-xs leading-snug text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {section.heading}
                  </a>
                ))}
              </nav>
              <p className="mt-4 border-t border-border pt-3 text-2xs text-muted-foreground">
                Last updated {doc.updated}
              </p>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardContent>
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Other policies</p>
              <ul className="mt-2 space-y-1.5">
                {others.map((entry) => (
                  <li key={entry.slug}>
                    <button type="button" onClick={() => navigate(`/${entry.slug}`)} className="text-left text-xs text-primary hover:underline">
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>

        <article className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">{doc.title}</h1>
          <p className="mt-2 text-base text-muted-foreground">{doc.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">Last updated {doc.updated}</p>
          <div className="mt-8 space-y-8">
            {doc.sections.map((section, index) => (
              <section key={section.heading} id={`section-${index}`} className="scroll-mt-24">
                <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
                <div className="mt-2.5 space-y-3">
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex} className="text-sm leading-relaxed text-muted-foreground">
                      {paragraph}
                    </p>
                  ))}
                </div>
                {section.bullets && (
                  <ul className="mt-3 space-y-2">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                        <span className="mt-0.5 text-xs text-primary" aria-hidden>
                          •
                        </span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-2 border-t border-border pt-6">
            <Button onClick={() => navigate('/contact')}>Contact rights team</Button>
            <Button variant="outline" onClick={() => navigate('/faq')}>
              Read the FAQ
            </Button>
          </div>
        </article>
      </div>
    </>
  );
}

