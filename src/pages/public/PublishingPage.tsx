import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, CtaBand, BreadcrumbBar, ComparisonTable } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent, Table } from '@/components/ui/primitivesComposed';
import { useExportFormats, usePreflightRows, DEMO_BOOK_ID } from '@/hooks/useFeatureData';
import { usePreflight } from '@/hooks/queries';
import { exportService, publishingService } from '@/services';
import { PUBLISHING_PROFILES } from '@/data/constants';
import { formatCurrency } from '@/lib/format';

export default function PublishingPage() {
  const navigate = useNavigate();
  const formats = useExportFormats();
  const { data: report } = usePreflight(DEMO_BOOK_ID, 'paperback');
  const issues = usePreflightRows();
  const [profileId, setProfileId] = React.useState(PUBLISHING_PROFILES[0].id);

  const profile = exportService.profile(profileId);

  return (
    <>
      <Seo
        title="Publishing — preflight, seven export formats and five profiles"
        description="Export print-ready PDF, EPUB 3, DOCX, HTML and more from one book project, with a preflight checker that catches what printers reject."
        canonical="/publishing"
        keywords={['print ready pdf', 'epub 3 export', 'book preflight', 'kdp formatting']}
      />
      <section className="border-b border-border bg-muted/40 py-12">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Publishing' }]} />
          <SectionHeading
            eyebrow="Publishing"
            title="From finished manuscript to a file a printer will accept"
            description="Publishing profiles encode real platform requirements. Preflight tells you what fails before you upload anywhere."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/dashboard/exports')}>Open the export centre</Button>
            <Button variant="outline" onClick={() => navigate('/dashboard/publishing')}>
              Publishing submission flow
            </Button>
          </div>
        </div>
      </section>

      <Section>
        <SectionHeading eyebrow="Formats" title="Seven exports, generated from your live project" description="Digital first or print first — you choose per export, and history keeps every file." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(['digital', 'print'] as const).map((family) => (
            <div key={family} className="contents">
              {formats
                .filter((format) => (family === 'print' ? ['print-pdf'] .includes(format.id) : !['print-pdf'].includes(format.id)))
                .map((format) => (
                  <Card key={format.id}>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">{format.label}</p>
                        <Badge variant={family === 'print' ? 'warning' : 'info'}>{family === 'print' ? 'Print' : 'Digital'}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{format.description}</p>
                    </CardContent>
                  </Card>
                ))}
            </div>
          ))}
        </div>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Profiles" title="Pick a destination — the requirements follow" description="Profiles are data. Adding a new platform is configuration, not a code change." />
        <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-2">
            {PUBLISHING_PROFILES.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setProfileId(entry.id)}
                  aria-pressed={profileId === entry.id}
                  className={
                    profileId === entry.id
                      ? 'w-full rounded-xl border border-primary bg-primary/5 px-4 py-3 text-left'
                      : 'w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40'
                  }
                >
                  <p className="text-sm font-semibold text-foreground">{entry.name}</p>
                  <p className="text-2xs uppercase tracking-wide text-muted-foreground">{entry.family}</p>
                </button>
              </li>
            ))}
          </ul>
          <Card>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{profile.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Bleed required', profile.requirements.bleedRequired ? 'Yes' : 'No'],
                  ['Min pages', String(profile.requirements.minPages)],
                  ['Max pages', String(profile.requirements.maxPages)],
                  ['Min image DPI', String(profile.requirements.minDpi)],
                  ['Font embedding', profile.requirements.fontEmbedding ? 'Required' : 'Optional'],
                  ['Bleed allowed', profile.requirements.allowBleed ? 'Yes' : 'No'],
                  ['Formats', profile.formats.join(', ')],
                  ['Trim sizes', profile.requirements.trimSizes?.length ? `${profile.requirements.trimSizes.length} supported` : 'Any'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="text-sm font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{profile.platformNote}</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Preflight" title="Fifteen rule groups, honest severities" description="Run against a real demo book: 22 checks passed, plus whatever still needs attention." />
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
          <Card>
            <CardContent>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Readiness score</p>
              <p className="mt-1 font-display text-4xl font-bold text-foreground">{report?.readiness ?? 0}%</p>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                  <span>Passed</span>
                  <span className="font-semibold">{report?.passed ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-warning/10 px-3 py-2 text-xs">
                  <span className="text-warning-foreground dark:text-warning">Warnings</span>
                  <span className="font-semibold text-foreground">{report?.warnings ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <span>Errors</span>
                  <span className="font-semibold">{report?.errors ?? 0}</span>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Fixable issues get a one-click fix in the export centre; the rest link straight to the page that needs attention.
              </p>
            </CardContent>
          </Card>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {issues.map((issue) => (
              <li key={issue.rowId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge variant={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}>{issue.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{issue.title}</p>
                  <p className="text-xs text-muted-foreground">{issue.fixHint}</p>
                </div>
                <Badge variant="outline">{issue.category}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tone="muted" id="earnings">
        <SectionHeading eyebrow="Author earnings" title="What selling actually pays" description="Commission depends on your plan. Every figure below is modelled in the revenue service." />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Pro commission', '15%', 'You keep 85% of every sale'],
            ['Business commission', '8%', 'You keep 92% of every sale'],
            ['Example sale', formatCurrency(4.99), 'Pro author receives $4.24 before fees'],
            ['Payout cycle', '30 days', 'Monthly run with a $50 threshold'],
          ].map(([label, value, detail]) => (
            <Card key={label}>
              <CardContent>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 font-display text-2xl font-bold text-foreground">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <ComparisonTable
          columns={['Scriptora free', 'Scriptora Pro', 'Scriptora Business']}
          rows={[
            { label: 'Export formats', values: ['PDF, TXT', 'All 7', 'All 7'] },
            { label: 'Print profiles', values: [false, true, true] },
            { label: 'EPUB 3', values: [false, true, true] },
            { label: 'Marketplace selling', values: [false, '15% commission', '8% commission'] },
            { label: 'AI credits / month', values: ['20', '2,000', '10,000'] },
            { label: 'Team seats', values: ['1', '1', '10'] },
          ]}
        />
      </Section>

      <Section>
        <SectionHeading eyebrow="Submission" title="Publishing is a ten-step flow, not a single button" description="Each step validates something real before the next unlocks." />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {publishingService.steps.map((step, index) => (
            <li key={step.id} className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-primary">Step {index + 1}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{step.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={() => navigate('/dashboard/publishing')}>Start a submission</Button>
          <Button variant="outline" onClick={() => navigate('/faq')}>
            Publishing FAQ
          </Button>
        </div>
      </Section>

      <Section tone="paper">
        <SectionHeading
          eyebrow="Phase 2"
          title="What changes when the real backend arrives"
          description="This build ships a complete, working pipeline with a local provider. Nothing below requires the UI to be rebuilt."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {([
            ['Rendering', 'PDF and EPUB rendering moves to a worker; the export service contract stays identical.'],
            ['Delivery', 'Files move to object storage with signed URLs; the storage abstraction is already in place.'],
            ['Payouts', 'Order and earnings models already separate platform fee, author earnings and refunds.'],
          ] as const).map(([title, body]) => (
            <Card key={title}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <CtaBand
          title="Publish your first book this month"
          description="Write it, preflight it, export it, list it. The whole pipeline is in one workspace."
          secondaryLabel="See pricing"
          secondaryHref="/pricing"
        />
      </Section>
    </>
  );
}
