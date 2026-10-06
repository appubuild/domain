import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useHomepage } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { EditorMockup } from '@/components/shared/EditorMockup';
import { Section, SectionHeading, CtaBand, BreadcrumbBar, StatsRow } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent } from '@/components/ui/primitives';
import { Stepper, Accordion } from '@/components/ui/data';
import { cn } from '@/lib/utils';

const STAGES = [
  {
    id: 1,
    label: 'Write',
    title: 'Get the manuscript out of your head',
    body: 'Start blank, from a template, from a document you already have, or with the AI book generator. Scriptora builds the chapter structure as you go and keeps your word counts honest.',
    detail: [
      'Four ways to start: blank, template, AI wizard, import DOCX/HTML/EPUB/TXT',
      'Chapters, scenes and parts with drag-and-drop reordering',
      'Word targets per chapter and for the whole book',
      'Notes, comments and version snapshots attached to the book',
      'Autosave every few seconds with a truthful save indicator',
    ],
    cta: { label: 'Read the writing features', href: '/features#writing' },
  },
  {
    id: 2,
    label: 'Design',
    title: 'Design pages that will actually print',
    body: 'Switch to design mode and work on the same content as real pages. Set the trim size, margins and gutter first — the canvas enforces them for the rest of the book.',
    detail: [
      'Element canvas with drag, resize, rotate and keyboard nudge',
      'Layers, alignment guides, rulers, snapping and grid lines',
      'Nine print trim presets plus custom width, height and unit',
      'Mirror margins on facing pages with a real inside gutter',
      'Illustrations from the asset library or generated in place',
      'Cover designer with spine width calculated from page count',
    ],
    cta: { label: 'Read the design features', href: '/features#design' },
  },
  {
    id: 3,
    label: 'Format',
    title: 'Let the profile do the print maths',
    body: 'Pick a publishing profile — ebook, paperback, hardcover, KDP ebook or KDP print — and Scriptora applies its requirements, then tells you exactly what still fails.',
    detail: [
      'Profiles carry trim sizes, bleed rules, DPI minimums and page bands',
      'Automatic page numbering with front-matter exceptions',
      'Auto-generated table of contents from your chapter structure',
      'Running heads and footers, per section if you need it',
      'Preflight: passed, warning and error severities with fix hints',
      'One-click fixes for margins, gutter, bleed, TOC and numbering',
    ],
    cta: { label: 'Read the publishing features', href: '/features#publishing' },
  },
  {
    id: 4,
    label: 'Preview',
    title: 'See it as the reader and the printer will',
    body: 'Preview mode renders facing-page spreads with real page numbers, running heads and mirrored margins — the same geometry the exporter uses.',
    detail: [
      'Single page, facing spreads or continuous scroll',
      'Zoom from fit-width to 200% with keyboard control',
      'Jump to any page, chapter or preflight issue',
      'Cover preview with spine and barcode zone',
      'Reader preview for the EPUB output',
      'Nothing is a mock: the preview reads your live project',
    ],
    cta: { label: 'Explore the editor', href: '/features#design' },
  },
  {
    id: 5,
    label: 'Export',
    title: 'Seven formats, five profiles, one project',
    body: 'Digital PDF for direct sales, print PDF for offset, EPUB 3 for stores, DOCX for editors, HTML for the web and plain text for everything else.',
    detail: [
      'PDF, Print PDF, EPUB 2, EPUB 3, DOCX, HTML, TXT',
      'Export history with profile, size, status and re-download',
      'Estimated file size before you commit',
      'Font embedding and image downsampling options',
      'Digital and print outputs clearly separated',
      'Every export runs preflight first',
    ],
    cta: { label: 'See export options', href: '/publishing' },
  },
  {
    id: 6,
    label: 'Publish & sell',
    title: 'List it and get paid',
    body: 'Publish to the marketplace, set your price, decide who can see it — then track sales, revenue, buyers and countries per title.',
    detail: [
      'Ten-step publishing submission with a checklist',
      'Visibility: private, public, unlisted or marketplace',
      'Paid or free listings with discount support',
      'Built-in reader with bookmarks and reading progress',
      'Reviews and ratings with moderation',
      'Revenue, buyers, refunds and payouts per title',
    ],
    cta: { label: 'Read the marketplace features', href: '/features#marketplace' },
  },
];

export default function HowItWorksPage() {
  const navigate = useNavigate();
  const { data: homepage } = useHomepage();
  const [active, setActive] = React.useState(1);
  const stage = STAGES.find((entry) => entry.id === active) ?? STAGES[0];

  const [step, setStep] = React.useState('s1');
  const steps = [
    { id: 's1', label: 'Sign up free', description: 'No card. Free plan includes 3 books and writing mode.' },
    { id: 's2', label: 'Create the book', description: 'Blank, template, AI wizard or import an existing manuscript.' },
    { id: 's3', label: 'Write and design', description: 'One project, three modes, one document model.' },
    { id: 's4', label: 'Run preflight', description: 'Fix what the checker finds before it reaches a printer.' },
    { id: 's5', label: 'Export or publish', description: 'Download seven formats or list it for sale.' },
  ];

  return (
    <>
      <Seo
        title="How it works — six stages from idea to income"
        description="How Scriptora takes a book from blank page to published product: write, design, format, preview, export, publish and sell."
        canonical="/how-it-works"
        keywords={['how to publish a book', 'book formatting workflow', 'self publishing steps']}
      />
      <section className="border-b border-border bg-muted/40 py-12">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'How it works' }]} />
          <SectionHeading
            eyebrow="How it works"
            title="Six stages, one project, no round trips"
            description="Most author stacks break at stage three and stay broken. Here is how the pipeline is meant to feel."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-2">
            {STAGES.map((entry) => (
              <Button
                key={entry.id}
                size="sm"
                variant={active === entry.id ? 'default' : 'outline'}
                onClick={() => setActive(entry.id)}
                aria-pressed={active === entry.id}
              >
                {entry.id}. {entry.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Badge variant="secondary" className="mb-3">
              Stage {stage.id} of 6
            </Badge>
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{stage.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{stage.body}</p>
            <ul className="mt-6 space-y-2.5">
              {stage.detail.map((entry) => (
                <li key={entry} className="flex gap-2.5">
                  <span className="mt-0.5 text-xs text-primary" aria-hidden>
                    ✓
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{entry}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex gap-2">
              <Button onClick={() => navigate(stage.cta.href)}>{stage.cta.label}</Button>
              <Button variant="outline" onClick={() => setActive(stage.id === 6 ? 1 : stage.id + 1)}>
                {stage.id === 6 ? 'Back to stage 1' : `Next: ${STAGES[stage.id].label}`}
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            {stage.id === 2 ? (
              <EditorMockup mode="design" />
            ) : stage.id === 4 ? (
              <EditorMockup mode="preview" />
            ) : (
              <EditorMockup mode="write" />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {STAGES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setActive(entry.id)}
                  className={cn(
                    'rounded-xl border px-3.5 py-3 text-left transition-colors',
                    active === entry.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
                  )}
                >
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Stage {entry.id}</p>
                  <p className="text-sm font-semibold text-foreground">{entry.label}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Your first book" title="What the first hour actually looks like" description="Five steps, each one a real screen you can click today." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5">
          <Stepper steps={steps} current={step} onSelect={setStep} />
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            {steps.find((entry) => entry.id === step)?.description}
          </p>
          <Accordion items={steps.map((entry) => ({ id: entry.id, title: entry.label, content: <p className="text-sm text-muted-foreground">{entry.description}</p> }))} />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={() => navigate('/register')}>Create your account</Button>
          <Button variant="outline" onClick={() => navigate('/login?demo=1')}>
            Sign in to the demo account
          </Button>
        </div>
      </Section>

      {homepage?.sections.find((section) => section.key === 'trusted') && (
        <Section tone="paper">
          <SectionHeading eyebrow="By the numbers" title="Where the platform stands today" />
          <div className="mt-8">
            <StatsRow
              stats={(homepage?.sections.find((section) => section.key === 'trusted')?.items ?? []).map((entry) => ({
                label: entry.body,
                value: entry.title,
              }))}
            />
          </div>
        </Section>
      )}

      <Section>
        <SectionHeading eyebrow="Limits" title="What this build does and does not do yet" description="An honest list, because publishing promises are easy to make." />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-sm font-semibold text-foreground">Works today</p>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>· Full writing, design and preview modes</li>
                <li>· Real export file generation for all seven formats</li>
                <li>· Preflight with genuine one-click fixes</li>
                <li>· Marketplace listings, orders and revenue</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm font-semibold text-foreground">Mocked, swappable</p>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>· AI responses come from a local mock provider</li>
                <li>· Payments are modelled, not charged</li>
                <li>· Storage is local with byte accounting</li>
                <li>· Email events are recorded, not sent</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm font-semibold text-foreground">On the roadmap</p>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>· Real backend with PostgreSQL</li>
                <li>· Cloudflare R2 asset storage</li>
                <li>· Live AI providers and credit billing</li>
                <li>· Payment provider payouts</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section>
        <CtaBand
          title="Start at stage one"
          description="Create a free account, or open the demo workspace and follow the 20-step guided flow."
          primaryLabel="Start writing free"
          secondaryLabel="Try the demo account"
          secondaryHref="/login?demo=1"
        />
      </Section>
    </>
  );
}
