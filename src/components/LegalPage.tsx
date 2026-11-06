import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, FileText } from 'lucide-react'
import { PageHero } from '@/components/PageHero'
import { FOOTER_LEGAL_LINKS, SITE } from '@/config/site'

interface LegalPageProps {
  title: string
  description: string
  lastUpdated: string
  crumb: string
  sections: { id: string; label: string }[]
  children: ReactNode
}

/** Shared shell for policy pages: hero, sticky table of contents, readable prose. */
export const LegalPage = ({ title, description, lastUpdated, crumb, sections, children }: LegalPageProps) => (
  <>
    <PageHero
      compact
      eyebrow="Legal & compliance"
      title={title}
      description={description}
      crumbs={[{ label: crumb }]}
    />

    <section className="section pt-8 sm:pt-10">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-line bg-soft p-4">
              <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.16em] text-muted">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                On this page
              </p>
              <ul className="mt-3 space-y-1">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-md px-1.5 py-1 text-[0.8125rem] leading-5 text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">Other policies</p>
                <ul className="mt-2 space-y-1">
                  {FOOTER_LEGAL_LINKS.filter((link) => link.label !== crumb).map((link) => (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        className="flex items-start gap-1 rounded-md px-1.5 py-1 text-[0.75rem] leading-5 text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        {link.label}
                        <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>

          <article className="min-w-0">
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Last updated: {lastUpdated}
            </p>
            <div className="prose-legal max-w-3xl">{children}</div>
            <div className="mt-10 rounded-2xl border border-line bg-soft p-5">
              <p className="text-[0.8125rem] leading-6 text-muted">
                Questions about this document? Email{' '}
                <a href={`mailto:${SITE.contact.email}`} className="link">
                  {SITE.contact.email}
                </a>{' '}
                or use our{' '}
                <Link to="/contact" className="link">
                  contact form
                </Link>
                .
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  </>
)
