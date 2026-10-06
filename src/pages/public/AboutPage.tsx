import { useCmsPage } from '@/hooks/queries';
import { CmsPageView } from '@/pages/public/CmsPageView';
import { Section, SectionHeading } from '@/components/shared/sections';
import { Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { Seo } from '@/components/shared/Seo';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/primitives';

export default function AboutPage() {
  const { data: page, isLoading, isError, refetch } = useCmsPage('about');
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="container space-y-5 py-14">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="container py-16">
        <ErrorState title="The about page could not load" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <>
      <CmsPageView page={page} breadcrumbLabel="About" />
      <Section tone="muted">
        <SectionHeading eyebrow="How we build" title="Product principles we hold ourselves to" description="Six rules that decide what ships and what does not." />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['One document model', 'A book is one artefact. Every view — writing, design, preview, export — reads the same structure.'],
            ['Print is not an export option', 'Trim, gutter, bleed and margins are first-class properties of a page, not a setting buried in a dialog.'],
            ['Nothing is a dead end', 'If a feature is limited by your plan, the limit is explained and the upgrade path is one click away.'],
            ['No lock-in', 'Your manuscript exports cleanly to DOCX, EPUB, PDF and plain text. Leaving should always be possible.'],
            ['Honest AI', 'AI assists with context, never writes silently. Every suggestion is shown before it lands in your draft.'],
            ['Accessible by default', 'Keyboard navigation, focus management, contrast and screen-reader labels are part of the definition of done.'],
          ] as const).map(([title, body]) => (
            <Card key={title}>
              <CardContent>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Work with us, or tell us what is broken</h2>
            <p className="mt-1 text-sm text-muted-foreground">We read every message, including the ones that start with “this does not work”.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/contact')}>Contact the team</Button>
            <Button variant="outline" onClick={() => navigate('/blog')}>
              Read the blog
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
