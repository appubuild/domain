import type { Category, ID, Tag, Template } from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export interface TemplateFilters {
  query?: string;
  categoryIds?: ID[];
  premium?: boolean | 'all';
  kind?: Template['kind'] | 'all';
  sort?: 'popular' | 'newest' | 'rating' | 'name' | 'pages';
  featuredOnly?: boolean;
  published?: boolean;
}

export const templateRepo = {
  all(): Template[] {
    return getDatabase().templates;
  },
  find(id: ID | undefined): Template | undefined {
    if (!id) return undefined;
    return getDatabase().templates.find((template) => template.id === id);
  },
  filter(filters: TemplateFilters = {}): Template[] {
    let templates = getDatabase().templates.filter((template) =>
      filters.published === false ? true : template.published,
    );
    if (filters.featuredOnly) templates = templates.filter((template) => template.featured);
    if (filters.query) {
      const query = filters.query.toLowerCase();
      templates = templates.filter(
        (template) =>
          template.name.toLowerCase().includes(query) ||
          template.description.toLowerCase().includes(query) ||
          template.tags.some((tag) => tag.includes(query)) ||
          template.style.toLowerCase().includes(query),
      );
    }
    if (filters.categoryIds?.length) templates = templates.filter((template) => filters.categoryIds?.includes(template.categoryId));
    if (filters.premium !== undefined && filters.premium !== 'all') {
      templates = templates.filter((template) => template.premium === filters.premium);
    }
    if (filters.kind && filters.kind !== 'all') templates = templates.filter((template) => template.kind === filters.kind);

    switch (filters.sort) {
      case 'newest':
        templates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        break;
      case 'rating':
        templates.sort((a, b) => b.rating - a.rating);
        break;
      case 'name':
        templates.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'pages':
        templates.sort((a, b) => b.pageCount - a.pageCount);
        break;
      default:
        templates.sort((a, b) => b.uses - a.uses);
    }
    return templates;
  },
  create(template: Template): Template {
    return mutateDatabase((db) => {
      db.templates = [template, ...db.templates];
      return template;
    });
  },
  update(id: ID, patch: Partial<Template>): Template | undefined {
    return mutateDatabase((db) => {
      const index = db.templates.findIndex((template) => template.id === id);
      if (index === -1) return undefined;
      db.templates[index] = { ...db.templates[index], ...patch };
      return db.templates[index];
    });
  },
  remove(id: ID) {
    return mutateDatabase((db) => {
      db.templates = db.templates.filter((template) => template.id !== id);
    });
  },
  incrementUses(id: ID) {
    return mutateDatabase((db) => {
      const template = db.templates.find((entry) => entry.id === id);
      if (template) template.uses += 1;
    });
  },
  // ------------------------------------------------------------ categories
  categories(kind?: Category['kind']): Category[] {
    const categories = getDatabase().categories;
    const books = getDatabase().books;
    const filtered = kind ? categories.filter((category) => category.kind === kind || category.kind === 'book') : categories;
    return filtered
      .map((category) => ({
        ...category,
        bookCount: books.filter((book) => book.categoryIds.includes(category.id) && book.marketplace.listed).length,
      }))
      .sort((a, b) => a.order - b.order);
  },
  findCategory(id: ID | undefined): Category | undefined {
    return getDatabase().categories.find((category) => category.id === id);
  },
  findCategoryBySlug(slug: string): Category | undefined {
    return getDatabase().categories.find((category) => category.slug === slug);
  },
  createCategory(category: Category): Category {
    return mutateDatabase((db) => {
      db.categories = [...db.categories, category];
      return category;
    });
  },
  updateCategory(id: ID, patch: Partial<Category>): Category | undefined {
    return mutateDatabase((db) => {
      const index = db.categories.findIndex((category) => category.id === id);
      if (index === -1) return undefined;
      db.categories[index] = { ...db.categories[index], ...patch };
      return db.categories[index];
    });
  },
  removeCategory(id: ID) {
    return mutateDatabase((db) => {
      db.categories = db.categories.filter((category) => category.id !== id);
    });
  },
  tags(type?: Tag['type']): Tag[] {
    const tags = getDatabase().tags;
    return (type ? tags.filter((tag) => tag.type === type) : tags).slice().sort((a, b) => b.usageCount - a.usageCount);
  },
  createTag(tag: Tag): Tag {
    return mutateDatabase((db) => {
      db.tags = [tag, ...db.tags];
      return tag;
    });
  },
  removeTag(id: ID) {
    return mutateDatabase((db) => {
      db.tags = db.tags.filter((tag) => tag.id !== id);
    });
  },
};
