import type { BlogPost, CmsPage, CmsSection, FaqItem, ID, Promo, SeoMeta, SiteTheme, Testimonial } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { cmsRepo } from '@/repositories';

export interface MarketingContent {
  seo: SeoMeta;
  sections: CmsSection[];
  testimonials: Testimonial[];
  faqs: FaqItem[];
  promo?: Promo;
  theme: SiteTheme;
}

export const cmsService = {
  homepage(): MarketingContent {
    return {
      seo: {
        title: 'Scriptora — Write, design, publish and sell your book',
        description:
          'The complete book studio: a serious writing environment, a visual page designer, a print and ebook engine, and a marketplace where your finished book sells from day one.',
        ogImage: '',
        keywords: ['book writing software', 'self publishing', 'book design', 'ebook creator', 'print ready pdf', 'author marketplace'],
        canonical: '/',
        noIndex: false,
      },
      sections: cmsRepo.visibleSections('home'),
      testimonials: cmsRepo.testimonials(),
      faqs: cmsRepo.faqs(),
      promo: cmsRepo.promoByPlacement('top-bar'),
      theme: cmsRepo.theme(),
    };
  },
  section(key: string, page = 'home') {
    return cmsRepo.sectionByKey(key, page);
  },
  sectionsFor(page: string) {
    return cmsRepo.visibleSections(page);
  },
  updateSection(id: ID, patch: Partial<CmsSection>) {
    return cmsRepo.updateSection(id, patch);
  },
  reorderSections(page: string, ids: ID[]) {
    return cmsRepo.reorderSections(page, ids);
  },
  createSection(section: Omit<CmsSection, 'id'>) {
    return cmsRepo.createSection({ ...section, id: uid('sec') });
  },
  removeSection(id: ID) {
    cmsRepo.removeSection(id);
  },
  testimonials(publishedOnly = true) {
    return cmsRepo.testimonials(publishedOnly);
  },
  createTestimonial(input: Partial<Testimonial>) {
    return cmsRepo.createTestimonial({
      id: uid('tst'),
      name: input.name ?? 'New testimonial',
      role: input.role ?? '',
      avatarUrl: input.avatarUrl ?? '',
      quote: input.quote ?? '',
      rating: input.rating ?? 5,
      bookTitle: input.bookTitle ?? '',
      featured: input.featured ?? false,
      published: input.published ?? true,
    });
  },
  updateTestimonial(id: ID, patch: Partial<Testimonial>) {
    return cmsRepo.updateTestimonial(id, patch);
  },
  removeTestimonial(id: ID) {
    cmsRepo.removeTestimonial(id);
  },
  faqs(publishedOnly = true) {
    return cmsRepo.faqs(publishedOnly);
  },
  createFaq(input: Partial<FaqItem>) {
    return cmsRepo.createFaq({
      id: uid('faq'),
      question: input.question ?? 'New question?',
      answer: input.answer ?? '',
      category: input.category ?? 'General',
      order: input.order ?? cmsRepo.faqs(false).length,
      published: input.published ?? true,
    });
  },
  updateFaq(id: ID, patch: Partial<FaqItem>) {
    return cmsRepo.updateFaq(id, patch);
  },
  removeFaq(id: ID) {
    cmsRepo.removeFaq(id);
  },
  postList(includeDrafts = false) {
    return cmsRepo.posts(includeDrafts);
  },
  post(slug: string) {
    return cmsRepo.postBySlug(slug);
  },
  createPost(input: Partial<BlogPost>) {
    return cmsRepo.createPost({
      id: uid('post'),
      title: input.title ?? 'Untitled post',
      slug: (input.title ?? 'untitled-post').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      excerpt: input.excerpt ?? '',
      body: input.body ?? '',
      author: input.author ?? 'Scriptora team',
      authorAvatar: '',
      category: input.category ?? 'Writing craft',
      coverGradient: input.coverGradient ?? 'from-violet-500 to-indigo-600',
      readMinutes: input.readMinutes ?? 5,
      publishedAt: input.publishedAt ?? new Date().toISOString(),
      status: input.status ?? 'draft',
      featured: input.featured ?? false,
      tags: input.tags ?? [],
    });
  },
  updatePost(id: ID, patch: Partial<BlogPost>) {
    return cmsRepo.updatePost(id, patch);
  },
  removePost(id: ID) {
    cmsRepo.removePost(id);
  },
  pages() {
    return cmsRepo.pages();
  },
  page(slug: string): CmsPage | undefined {
    return cmsRepo.pageBySlug(slug);
  },
  createPage(input: Partial<CmsPage>) {
    return cmsRepo.createPage({
      id: uid('cms'),
      title: input.title ?? 'New page',
      slug: (input.slug ?? input.title ?? 'new-page').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      status: input.status ?? 'draft',
      sections: input.sections ?? [],
      seo: input.seo ?? { title: input.title ?? '', description: '', ogImage: '', keywords: [], canonical: `/${(input.slug ?? '').toLowerCase()}`, noIndex: false },
      updatedAt: new Date().toISOString(),
      showInNav: input.showInNav ?? false,
      navOrder: input.navOrder ?? 0,
    });
  },
  updatePage(id: ID, patch: Partial<CmsPage>) {
    return cmsRepo.updatePage(id, patch);
  },
  removePage(id: ID) {
    cmsRepo.removePage(id);
  },
  promos(activeOnly = false) {
    return cmsRepo.promos(activeOnly);
  },
  promoFor(placement: Promo['placement']) {
    return cmsRepo.promoByPlacement(placement);
  },
  createPromo(input: Partial<Promo>) {
    return cmsRepo.createPromo({
      id: uid('promo'),
      name: input.name ?? 'New promotion',
      type: input.type ?? 'banner',
      message: input.message ?? '',
      placement: input.placement ?? 'top-bar',
      ctaLabel: input.ctaLabel ?? 'Learn more',
      ctaHref: input.ctaHref ?? '/pricing',
      discountPercent: input.discountPercent ?? 0,
      code: input.code ?? '',
      startsAt: input.startsAt ?? new Date().toISOString(),
      endsAt: input.endsAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
      active: input.active ?? true,
      impressions: 0,
      clicks: 0,
    });
  },
  updatePromo(id: ID, patch: Partial<Promo>) {
    return cmsRepo.updatePromo(id, patch);
  },
  removePromo(id: ID) {
    cmsRepo.removePromo(id);
  },
  trackPromoClick(id: ID) {
    const promo = cmsRepo.promos().find((entry) => entry.id === id);
    if (promo) cmsRepo.updatePromo(id, { clicks: promo.clicks + 1 });
  },
  nav(location: 'header' | 'footer-product' | 'footer-resources' | 'footer-company' | 'footer-legal') {
    return cmsRepo.nav(location);
  },
  footer() {
    return cmsRepo.footer();
  },
  updateFooter(patch: Parameters<typeof cmsRepo.updateFooter>[0]) {
    return cmsRepo.updateFooter(patch);
  },
  theme() {
    return cmsRepo.theme();
  },
  async updateTheme(patch: Partial<SiteTheme>) {
    await delay(140);
    return cmsRepo.updateTheme(patch);
  },
  async updateSeo(id: ID, seo: SeoMeta) {
    await delay(320);
    return cmsRepo.updatePage(id, { seo });
  },
  async publishPage(id: ID, status: CmsPage['status']) {
    await delay(320);
    return cmsRepo.updatePage(id, { status });
  },
};
