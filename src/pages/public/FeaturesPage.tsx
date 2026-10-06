import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Seo } from '@/components/shared/Seo';
import { EditorMockup } from '@/components/shared/EditorMockup';
import { Section, SectionHeading, CtaBand, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { usePreflightRows, useExportFormats, DEMO_BOOK_ID } from '@/hooks/useFeatureData';
import { usePreflight } from '@/hooks/queries';

const GROUPS = [
  {
    id: 'writing',
    label: 'Writing',
    title: 'A long-form environment that stays out of your way',
    description: 'Built for manuscripts measured in tens of thousands of words, not slides.',
    bullets: [
      'Chapter, scene and part structure that survives every export',
      'Distraction-free mode with typewriter scrolling and focus dimming',
      'Per-chapter and whole-book word targets with progress tracking',
      'Find & replace across the whole book, with case and whole-word options',
      'Spell, grammar, dictionary and thesaurus surfaces ready for a real engine',
      'Notes and research attached to the book, not to a folder somewhere else',
      'Comments with resolve threads and collaborator roles',
      'Version history snapshots you can restore with one click',
      'Autosave with an honest Saving… / Saved / Unsaved indicator',
      'Keyboard-first editing: Ctrl/Cmd+S, Z, Shift+Z, F, and full shortcut reference',
    ],
  },
  {
    id: 'design',
    label: 'Design',
    title: 'Page design that understands printing',
    description: 'Trim, gutter, mirror margins and bleed are first-class properties, not export options.',
    bullets: [
      'Element canvas: text boxes, images, shapes, lines and decorations',
      'Drag, resize and rotate with pointer, touch and keyboard nudge',
      'Layer panel with reorder, lock, hide and multi-select',
      'Alignment guides, rulers, snapping and grid lines',
      'Nine print trim presets plus a fully custom size',
      'Facing-page spreads, mirrored margins and inside gutter',
      'Reusable text styles with baseline discipline and widow control',
      'Eight interior palettes with light and dark editorial variants',
      'Cover designer: front, spine and back on one spread',
      'Spine width calculated from real page count and paper stock',
      'Barcode zone, wrap and hinge guides placed for you',
      'Asset library with uploads, generated art and per-book reuse',
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    title: 'AI that reads your whole book',
    description: 'Assistance grounded in your outline, characters, timeline and style rules.',
    bullets: [
      'Continue, rewrite, improve, simplify, expand and shorten',
      'Tone shift, grammar pass, summarise and translate',
      'Chapter, outline, title, subtitle, blurb and keyword generation',
      'Character, dialogue and location drafting from your story bible',
      'AI book generator wizard with an editable outline before generation',
      'Book knowledge panel: characters, locations, timeline, facts, glossary, style',
      'Interior illustration and cover concept generation',
      'Every suggestion is insert, replace or copy — never forced',
      'Credit costs shown before you spend them',
      'Usage metered per plan with a clear upgrade path',
    ],
  },
  {
    id: 'publishing',
    label: 'Publishing',
    title: 'Export and preflight like a publisher',
    description: 'Seven formats and five publishing profiles from one book document model.',
    bullets: [
      'PDF, Print PDF, EPUB 2, EPUB 3, DOCX, HTML and plain text',
      'Profiles: ebook, paperback, hardcover, KDP-oriented ebook and print',
      'Preflight checker with passed, warning and error severities',
      'One-click fixes for margins, gutter, bleed, TOC, numbering and cover',
      'Page-size, font, link, image-DPI and overflow validation',
      'Table of contents generation and automatic page numbering',
      'Running heads and footers with per-section control',
      'Export history with size, profile, status and re-download',
      'Size estimation before you commit to an export',
      'Digital and print outputs clearly separated in one place',
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    title: 'Sell from the same project you wrote',
    description: 'Publish on your own terms, price as you like, and see exactly what you earn.',
    bullets: [
      'Free, paid or unlisted listings with a real product page',
      'Built-in reader: page mode, scroll mode, TOC, bookmarks and progress',
      'Reviews and ratings with admin moderation',
      'Wishlist and library with download access to what you bought',
      'Sales, revenue, buyers and country analytics per title',
      'Refunds tracked honestly against author earnings',
      'Payout summary with thresholds and method on file',
      'Author profiles with follower counts and social links',
      'Feature flags let the platform switch selling off gracefully',
      'Stripe-ready order model — no keys required in this build',
    ],
  },
] as const;

export default function FeaturesPage() {
  const navigate = useNavigate();
  const [active, setActive] = React.useState<string>('writing');
  const formats = useExportFormats();

  return (
    <>
      <Seo
        title="Features — writing, design, AI, publishing and selling"
        description="Every Scriptora feature group in detail: long-form writing, page design with print geometry, book-aware AI, preflight export and a marketplace that pays authors."
        canonical="/features"
        keywords={['book writing features', 'book design software', 'preflight export', 'author marketplace']}
      />
      <section className="border-b border-border bg-muted/40 py-12">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Features' }]} />
          <SectionHeading
            eyebrow="Features"
            title="Everything between an idea and a published book"
            description="Five feature groups, one document model. Pick a group to see exactly what ships today."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {GROUPS.map((group) => (
              <Button
                key={group.id}
                size="sm"
                variant={active === group.id ? 'default' : 'outline'}
                onClick={() => setActive(group.id)}
                aria-pressed={active === group.id}
              >
                {group.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {GROUPS.map((group) => (
        <Section key={group.id} id={group.id} tone={group.id === 'design' || group.id === 'marketplace' ? 'muted' : 'default'} className={cn(active !== group.id && 'hidden')}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <Badge variant="secondary" className="mb-3">
                {group.label}
              </Badge>
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{group.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{group.description}</p>
              {group.id === 'design' && <div className="mt-6"><EditorMockup mode="design" /></div>}
              {group.id === 'writing' && (
                <div className="mt-6 flex flex-wrap gap-2">
                  {['Source Serif 4', 'Playfair Display', 'Inter', 'JetBrains Mono'].map((font) => (
                    <Badge key={font} variant="outline">
                      {font}
                    </Badge>
                  ))}
                </div>
              )}
              {group.id === 'publishing' && (
                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {formats.map((format) => (
                    <div key={format.id} className="rounded-lg border border-border bg-card px-3 py-2">
                      <p className="text-xs font-semibold text-foreground">{format.label}</p>
                      <p className="text-2xs text-muted-foreground">{format.audience}</p>
                    </div>
                  ))}
                </div>
              )}
              {group.id === 'marketplace' && (
                <div className="mt-6 rounded-xl border border-border bg-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Commission</p>
                  <div className="mt-2 space-y-1.5 text-sm">
                    <p className="flex justify-between">
                      <span className="text-muted-foreground">Pro</span>
                      <span className="font-medium text-foreground">15% platform · 85% author</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-muted-foreground">Business</span>
                      <span className="font-medium text-foreground">8% platform · 92% author</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-muted-foreground">Payouts</span>
                      <span className="font-medium text-foreground">30-day cycle · $50 threshold</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {group.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5">
                  <span className="mt-0.5 text-xs text-primary" aria-hidden>
                    ✓
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ))}

      <Section tone="paper">
        <SectionHeading eyebrow="Try it" title="See the preflight that stops bad books shipping" description="Run the checker against a demo book, then fix issues one click at a time." />
        <PreflightDemo />
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Deep dive" title="How the five groups fit together" description="Every group is a view onto the same book document model." />
        <DeepDiveTabs />
      </Section>

      <Section>
        <CtaBand
          title="Write the first three chapters tonight"
          description="The free plan includes full writing mode, three books, two exports and one AI trial. No card required."
        />
      </Section>
    </>
  );
}

function PreflightDemo() {
  const issues = usePreflightRows();
  const { data: report } = usePreflight(DEMO_BOOK_ID, 'paperback');
  const navigate = useNavigate();
  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Readiness</p>
        <p className="mt-1 font-display text-4xl font-bold text-foreground">{report?.readiness ?? 0}%</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {report?.errors ?? 0} errors must be fixed, {report?.warnings ?? 0} warnings are advisory.
        </p>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
            <span>Passed checks</span>
            <span className="font-semibold">{report?.passed ?? 0}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            <span>Warnings</span>
            <span className="font-semibold">{report?.warnings ?? 0}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>Errors</span>
            <span className="font-semibold">{report?.errors ?? 0}</span>
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={() => navigate('/dashboard/exports')}>
          Open the export centre
        </Button>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {issues.map((issue) => (
          <li key={issue.rowId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Badge variant={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'success'}>{issue.severity}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{issue.title}</p>
              <p className="text-xs text-muted-foreground">{issue.detail}</p>
            </div>
            {issue.autoFixable ? <Badge variant="outline">One-click fix</Badge> : <Badge variant="secondary">Manual</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeepDiveTabs() {
  const [value, setValue] = React.useState('flow');
  const tabs = [
    { value: 'flow', label: 'The flow' },
    { value: 'api', label: 'Swap-in architecture' },
  ];
  return (
    <div className="mt-8">
      <Tabs tabs={tabs} value={value} onValueChange={setValue} />
      <div className="mt-5">
        {value === 'flow' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['1 · Write', 'Chapters, scenes and notes live in the book, with word counts and targets per section.'],
              ['2 · Design', 'The same section content flows into designed pages with your typography and geometry.'],
              ['3 · Format', 'Publishing profiles apply trim, margins, bleed, numbering, running heads and TOC.'],
              ['4 · Publish', 'Export seven formats, run preflight, then list the book for sale.'],
            ] as const).map(([title, body]) => (
              <Card key={title}>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['Storage', 'The storage service is abstracted. Today it is a mock provider with byte accounting; a Cloudflare R2 provider drops in without touching the UI.'],
              ['AI', 'AI actions are declared as capabilities with credit costs. Point the execution layer at a real provider and every panel keeps working.'],
              ['Payments', 'Orders, receipts and refunds are modelled as domain objects. A payment provider adapter fills them in; no keys are compiled into this build.'],
              ['Backend', 'Repositories read from a local provider today. Replacing them with HTTP calls leaves services and components untouched.'],
            ] as const).map(([title, body]) => (
              <Card key={title}>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
