import { useParams, useNavigate } from 'react-router-dom';
import { useCmsPage, useCmsPages } from '@/hooks/queries';
import { CmsPageView } from '@/pages/public/CmsPageView';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Button, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { NotFoundPage } from '@/pages/states/StatePages';

/**
 * Renders an admin-created CMS page by slug. Falls back to a "page not found"
 * state when the slug does not exist or is still a draft.
 */
export default function PublicCmsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: page, isLoading } = useCmsPage(slug);
  const { data: pages } = useCmsPages();

  if (isLoading) {
    return (
      <div className="container space-y-5 py-14">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (!page || page.status !== 'published') return <NotFoundPage />;

  const others = (pages ?? []).filter((entry) => entry.status === 'published' && entry.slug !== page.slug).slice(0, 4);

  return (
    <>
      <Seo title={page.seo.title || page.title} description={page.seo.description} canonical={`/pages/${page.slug}`} />
      <CmsPageView page={page} />
      {others.length > 0 && (
        <Section tone="muted">
          <SectionHeading title="More from Scriptora" align="left" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((entry) => (
              <Card key={entry.id} className="cursor-pointer transition-shadow hover:shadow-card" onClick={() => navigate(`/pages/${entry.slug}`)}>
                <CardContent>
                  <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.seo.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      )}
      <div className="container pb-10">
        <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: page.title }]} />
        <Button variant="outline" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </div>
    </>
  );
}
