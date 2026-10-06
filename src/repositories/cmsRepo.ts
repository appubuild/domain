import type { BlogPost, CmsPage, CmsSection, FaqItem, FooterConfig, ID, NavItem, Promo, SiteTheme, Testimonial } from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export const cmsRepo = {
  // -------------------------------------------------------------- sections
  sections(page = 'home'): CmsSection[] {
    return getDatabase()
      .homeSections.filter((section) => section.page === page)
      .sort((a, b) => a.order - b.order);
  },
  visibleSections(page = 'home'): CmsSection[] {
    return cmsRepo.sections(page).filter((section) => section.visible);
  },
  sectionByKey(key: string, page = 'home'): CmsSection | undefined {
    return getDatabase().homeSections.find((section) => section.key === key && section.page === page);
  },
  updateSection(id: ID, patch: Partial<CmsSection>): CmsSection | undefined {
    return mutateDatabase((db) => {
      const index = db.homeSections.findIndex((section) => section.id === id);
      if (index === -1) return undefined;
      db.homeSections[index] = { ...db.homeSections[index], ...patch };
      return db.homeSections[index];
    });
  },
  createSection(section: CmsSection): CmsSection {
    return mutateDatabase((db) => {
      db.homeSections = [...db.homeSections, section];
      return section;
    });
  },
  removeSection(id: ID) {
    return mutateDatabase((db) => {
      db.homeSections = db.homeSections.filter((section) => section.id !== id);
    });
  },
  reorderSections(page: string, orderedIds: ID[]) {
    return mutateDatabase((db) => {
      const lookup = new Map(db.homeSections.map((section) => [section.id, section]));
      orderedIds.forEach((id, index) => {
        const section = lookup.get(id);
        if (section) section.order = index;
      });
      db.homeSections = [...db.homeSections];
    });
  },
  // ---------------------------------------------------------------- pages
  pages(): CmsPage[] {
    return getDatabase().cmsPages;
  },
  pageBySlug(slug: string): CmsPage | undefined {
    return getDatabase().cmsPages.find((page) => page.slug === slug);
  },
  page(id: ID): CmsPage | undefined {
    return getDatabase().cmsPages.find((page) => page.id === id);
  },
  createPage(page: CmsPage): CmsPage {
    return mutateDatabase((db) => {
      db.cmsPages = [page, ...db.cmsPages];
      return page;
    });
  },
  updatePage(id: ID, patch: Partial<CmsPage>): CmsPage | undefined {
    return mutateDatabase((db) => {
      const index = db.cmsPages.findIndex((page) => page.id === id);
      if (index === -1) return undefined;
      db.cmsPages[index] = { ...db.cmsPages[index], ...patch, updatedAt: new Date().toISOString() };
      return db.cmsPages[index];
    });
  },
  removePage(id: ID) {
    return mutateDatabase((db) => {
      db.cmsPages = db.cmsPages.filter((page) => page.id !== id);
    });
  },
  // ---------------------------------------------------------- testimonials
  testimonials(publishedOnly = true): Testimonial[] {
    const list = getDatabase().testimonials;
    return publishedOnly ? list.filter((item) => item.published) : list;
  },
  createTestimonial(testimonial: Testimonial): Testimonial {
    return mutateDatabase((db) => {
      db.testimonials = [testimonial, ...db.testimonials];
      return testimonial;
    });
  },
  updateTestimonial(id: ID, patch: Partial<Testimonial>): Testimonial | undefined {
    return mutateDatabase((db) => {
      const index = db.testimonials.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      db.testimonials[index] = { ...db.testimonials[index], ...patch };
      return db.testimonials[index];
    });
  },
  removeTestimonial(id: ID) {
    return mutateDatabase((db) => {
      db.testimonials = db.testimonials.filter((item) => item.id !== id);
    });
  },
  // ------------------------------------------------------------------ faq
  faqs(publishedOnly = true): FaqItem[] {
    const list = getDatabase().faqs;
    return (publishedOnly ? list.filter((item) => item.published) : list).slice().sort((a, b) => a.order - b.order);
  },
  createFaq(faq: FaqItem): FaqItem {
    return mutateDatabase((db) => {
      db.faqs = [...db.faqs, faq];
      return faq;
    });
  },
  updateFaq(id: ID, patch: Partial<FaqItem>): FaqItem | undefined {
    return mutateDatabase((db) => {
      const index = db.faqs.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      db.faqs[index] = { ...db.faqs[index], ...patch };
      return db.faqs[index];
    });
  },
  removeFaq(id: ID) {
    return mutateDatabase((db) => {
      db.faqs = db.faqs.filter((item) => item.id !== id);
    });
  },
  // --------------------------------------------------------------- promos
  promos(activeOnly = false): Promo[] {
    const promos = getDatabase().promos;
    if (!activeOnly) return promos;
    const now = Date.now();
    return promos.filter((promo) => promo.active && new Date(promo.startsAt).getTime() <= now && new Date(promo.endsAt).getTime() >= now);
  },
  promoByPlacement(placement: Promo['placement']): Promo | undefined {
    return cmsRepo.promos(true).find((promo) => promo.placement === placement);
  },
  createPromo(promo: Promo): Promo {
    return mutateDatabase((db) => {
      db.promos = [promo, ...db.promos];
      return promo;
    });
  },
  updatePromo(id: ID, patch: Partial<Promo>): Promo | undefined {
    return mutateDatabase((db) => {
      const index = db.promos.findIndex((promo) => promo.id === id);
      if (index === -1) return undefined;
      db.promos[index] = { ...db.promos[index], ...patch };
      return db.promos[index];
    });
  },
  removePromo(id: ID) {
    return mutateDatabase((db) => {
      db.promos = db.promos.filter((promo) => promo.id !== id);
    });
  },
  // ----------------------------------------------------------------- blog
  posts(includeDrafts = false): BlogPost[] {
    const posts = getDatabase().blogPosts;
    return (includeDrafts ? posts : posts.filter((post) => post.status === 'published')).slice().sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  },
  postBySlug(slug: string): BlogPost | undefined {
    return getDatabase().blogPosts.find((post) => post.slug === slug);
  },
  createPost(post: BlogPost): BlogPost {
    return mutateDatabase((db) => {
      db.blogPosts = [post, ...db.blogPosts];
      return post;
    });
  },
  updatePost(id: ID, patch: Partial<BlogPost>): BlogPost | undefined {
    return mutateDatabase((db) => {
      const index = db.blogPosts.findIndex((post) => post.id === id);
      if (index === -1) return undefined;
      db.blogPosts[index] = { ...db.blogPosts[index], ...patch };
      return db.blogPosts[index];
    });
  },
  removePost(id: ID) {
    return mutateDatabase((db) => {
      db.blogPosts = db.blogPosts.filter((post) => post.id !== id);
    });
  },
  // ------------------------------------------------------------ navigation
  nav(location: NavItem['location']): NavItem[] {
    return getDatabase()
      .navItems.filter((item) => item.location === location && item.visible)
      .sort((a, b) => a.order - b.order);
  },
  allNav(): NavItem[] {
    return getDatabase().navItems;
  },
  createNavItem(item: NavItem): NavItem {
    return mutateDatabase((db) => {
      db.navItems = [...db.navItems, item];
      return item;
    });
  },
  updateNavItem(id: ID, patch: Partial<NavItem>): NavItem | undefined {
    return mutateDatabase((db) => {
      const index = db.navItems.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      db.navItems[index] = { ...db.navItems[index], ...patch };
      return db.navItems[index];
    });
  },
  removeNavItem(id: ID) {
    return mutateDatabase((db) => {
      db.navItems = db.navItems.filter((item) => item.id !== id);
    });
  },
  footer(): FooterConfig {
    return getDatabase().footer;
  },
  updateFooter(patch: Partial<FooterConfig>): FooterConfig {
    return mutateDatabase((db) => {
      db.footer = { ...db.footer, ...patch };
      return db.footer;
    });
  },
  // --------------------------------------------------------------- theme
  theme(): SiteTheme {
    return getDatabase().theme;
  },
  updateTheme(patch: Partial<SiteTheme>): SiteTheme {
    return mutateDatabase((db) => {
      db.theme = { ...db.theme, ...patch };
      return db.theme;
    });
  },
};
