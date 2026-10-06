import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, BookOpen, Eye, Globe, Heart, Link2, Loader2, MapPin, Palette, Save, Share2, Sparkles, Star, Users,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator, Switch } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { StatCard } from '@/components/ui/data';
import { BookCard } from '@/components/shared/BookCard';
import { useToast } from '@/components/ui/toast';
import { useBooks, useReviews } from '@/hooks/queries';
import { searchService, userService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatNumber, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SocialLinks } from '@/types/domain';

const GENRES = ['Literary fiction', 'Memoir', 'Slow living', 'Nature writing', 'Business', 'Poetry', 'Cookbook', 'Young adult', 'Self help', 'Historical'];

export default function AuthorProfileEditorPage() {
  const { user, refresh } = useAuth();
  const { success, error } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });
  const published = (books ?? []).filter((book) => book.status === 'published');
  const { data: reviews } = useReviews(published[0]?.id);
  const [tab, setTab] = React.useState('profile');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: '',
    tagline: '',
    bio: '',
    location: '',
    website: '',
    social: {} as SocialLinks,
    avatarUrl: '',
    genres: [] as string[],
    verified: false,
    featured: false,
  });

  const stored = user ? searchService.authorProfile(user.id) : undefined;

  React.useEffect(() => {
    if (!user) return;
    setForm({
      name: stored?.name ?? user.name,
      tagline: stored?.tagline ?? user.tagline,
      bio: stored?.bio ?? user.bio,
      location: stored?.location ?? user.country,
      website: stored?.social.website ?? user.website,
      social: stored?.social ?? user.social,
      avatarUrl: stored?.avatarUrl ?? user.avatarUrl,
      genres: stored?.genres ?? [],
      verified: stored?.verified ?? false,
      featured: stored?.featured ?? false,
    });
  }, [user, stored]);

  if (!user) return null;

  const stats = {
    books: (books ?? []).length,
    published: published.length,
    sales: published.reduce((total, book) => total + book.marketplace.sales, 0),
    followers: stored?.followers ?? user.followers,
    rating: published.length ? published.reduce((total, book) => total + book.marketplace.rating, 0) / published.length : 0,
    reviews: published.reduce((total, book) => total + book.marketplace.reviewCount, 0),
  };

  const save = async () => {
    setBusy(true);
    try {
      await userService.updateProfile(user.id, {
        name: form.name,
        tagline: form.tagline,
        bio: form.bio,
        country: form.location,
        website: form.website,
        social: { ...form.social, website: form.website },
        avatarUrl: form.avatarUrl,
      });
      await userService.updateAuthorProfile(user.id, {
        name: form.name,
        tagline: form.tagline,
        bio: form.bio,
        location: form.location,
        avatarUrl: form.avatarUrl,
        social: { ...form.social, website: form.website },
        genres: form.genres,
      });
      await refresh();
      qc.invalidateQueries({ queryKey: ['authors'] });
      success('Author profile saved', 'Your public page is updated immediately.');
    } catch (e) {
      error('Could not save profile', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Author profile</h1>
          <p className="text-sm text-muted-foreground">This is what readers see at /authors/{user.username}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/authors/${user.username}`)}>
            <Eye className="h-4 w-4" /> View public page
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/authors/${user.username}`); success('Profile link copied'); }}
          >
            <Share2 className="h-4 w-4" /> Share
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save profile
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Books" value={formatNumber(stats.books)} hint={`${stats.published} published`} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Copies sold" value={formatNumber(stats.sales)} hint="Across all marketplaces" icon={<Sparkles className="h-4 w-4" />} />
        <StatCard label="Followers" value={formatNumber(stats.followers)} hint={`${formatNumber(stats.reviews)} reviews received`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Average rating" value={stats.rating ? stats.rating.toFixed(2) : '—'} hint={form.verified ? 'Verification requested' : 'Not verified yet'} icon={<Star className="h-4 w-4" />} tone="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile details</CardTitle>
            <CardDescription>Everything here is editable and saved to the mock database.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={tab}
              onValueChange={setTab}
              tabs={[
                { value: 'profile', label: 'Details' },
                { value: 'social', label: 'Links' },
                { value: 'genres', label: 'Genres', count: form.genres.length },
              ]}
            />

            {tab === 'profile' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded-full bg-muted">
                    {form.avatarUrl ? <img src={form.avatarUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-brand-gradient text-xl font-semibold text-white">{form.name.slice(0, 1)}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(current.name)}` }))}>
                      <Sparkles className="h-4 w-4" /> Generate avatar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setForm((current) => ({ ...current, avatarUrl: '' }))}>Remove</Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="author-name">Pen name</label>
                    <Input id="author-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="author-location">Location</label>
                    <Input id="author-location" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Pembrokeshire, Wales" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-sm font-medium" htmlFor="author-tagline">Tagline</label>
                    <Input id="author-tagline" value={form.tagline} onChange={(event) => setForm((current) => ({ ...current, tagline: event.target.value }))} placeholder="Essays on slow living and the sea" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-sm font-medium" htmlFor="author-bio">Biography</label>
                    <textarea id="author-bio" rows={6} value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    <p className="text-xs text-muted-foreground">{form.bio.length} characters · readers see this above your catalogue</p>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">Request verification</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Verified authors get a check mark and priority support.</span>
                    </span>
                    <Switch checked={form.verified} onCheckedChange={(checked) => { setForm((current) => ({ ...current, verified: checked })); success(checked ? 'Verification requested' : 'Verification withdrawn', checked ? 'Admins review new requests in the author queue.' : undefined); }} />
                  </label>
                  <label className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">Apply for a featured slot</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Featured authors appear on the homepage and /authors.</span>
                    </span>
                    <Switch checked={form.featured} onCheckedChange={(checked) => setForm((current) => ({ ...current, featured: checked }))} />
                  </label>
                </div>
              </div>
            )}

            {tab === 'social' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="social-website">Website</label>
                  <Input id="social-website" value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} placeholder="https://" />
                </div>
                {(['twitter', 'instagram', 'goodreads', 'linkedin'] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-sm font-medium capitalize" htmlFor={`social-${key}`}>{key}</label>
                    <Input
                      id={`social-${key}`}
                      value={form.social[key] ?? ''}
                      onChange={(event) => setForm((current) => ({ ...current, social: { ...current.social, [key]: event.target.value } }))}
                      placeholder={key === 'twitter' ? '@handle' : 'https://'}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground sm:col-span-2">Links appear as icons on your public profile. Leave any field empty to hide it.</p>
              </div>
            )}

            {tab === 'genres' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Pick the genres you write in — used for the /authors directory filters.</p>
                <div className="flex flex-wrap gap-2">
                  {GENRES.map((genre) => {
                    const selected = form.genres.includes(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, genres: selected ? current.genres.filter((entry) => entry !== genre) : [...current.genres, genre] }))}
                        className={cn('rounded-full border px-3 py-1.5 text-xs transition-colors', selected ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground hover:border-primary/40 hover:text-foreground')}
                        aria-pressed={selected}
                      >
                        {genre}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{form.genres.length} selected</p>
              </div>
            )}

            <Separator />
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
              </Button>
              <Button variant="ghost" onClick={() => navigate('/dashboard/settings')}>More account settings</Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profile preview</CardTitle>
              <CardDescription>How the header of your public page looks.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-muted">
                    {form.avatarUrl ? <img src={form.avatarUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-brand-gradient text-lg font-semibold text-white">{form.name.slice(0, 1)}</div>}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      {form.name || 'Your name'}
                      {form.verified && <BadgeCheck className="h-4 w-4 text-sky-500" />}
                    </p>
                    <p className="text-xs text-muted-foreground">@{user.username}</p>
                    {form.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {form.location}</p>}
                  </div>
                </div>
                {form.tagline && <p className="mt-3 text-sm italic text-muted-foreground">{form.tagline}</p>}
                {form.bio && <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">{form.bio}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {form.genres.slice(0, 4).map((genre) => <Badge key={genre} variant="secondary" className="text-2xs">{genre}</Badge>)}
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" /> {stats.published} books</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {formatNumber(stats.followers)}</span>
                  <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {formatNumber(stats.sales)} sales</span>
                </div>
                {form.social.website && <p className="mt-2 flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400"><Link2 className="h-3 w-3" /> {form.social.website}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your catalogue</CardTitle>
              <CardDescription>{published.length} published titles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {published.length === 0 && (
                <p className="text-sm text-muted-foreground">Publish a book to see it on your profile.</p>
              )}
              {published.slice(0, 4).map((book) => <BookCard key={book.id} book={book} />)}
              {published.length > 0 && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/dashboard/books?status=published')}>
                  Manage published books
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profile completeness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                { label: 'Avatar', done: Boolean(form.avatarUrl) },
                { label: 'Tagline', done: form.tagline.length > 8 },
                { label: 'Bio (120+ chars)', done: form.bio.length >= 120 },
                { label: 'Location', done: Boolean(form.location) },
                { label: 'At least one genre', done: form.genres.length > 0 },
                { label: 'A published book', done: published.length > 0 },
                { label: 'Website or social link', done: Boolean(form.website || form.social.twitter || form.social.instagram) },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', row.done ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                  <span className={row.done ? 'text-muted-foreground line-through' : ''}>{row.label}</span>
                </div>
              ))}
              {reviews && reviews.length > 0 && (
                <p className="pt-1 text-muted-foreground">{reviews.length} reviews across your published titles.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Account activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>Joined {timeAgo(user.createdAt)}</p>
              <p>Last active {timeAgo(user.lastActiveAt)}</p>
              <p className="flex items-center gap-1"><Globe className="h-3 w-3" /> Profile is {user.settings.privacy.profilePublic ? 'public' : 'private'}</p>
              <Button variant="ghost" size="xs" onClick={() => navigate('/dashboard/settings')}><Palette className="h-3 w-3" /> Privacy settings</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
