import type {
  Category,
  Tag, ID, Template } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { templateRepo, type TemplateFilters } from '@/repositories';
import { bookService } from './bookService';

export interface TemplatePreviewPage {
  id: string;
  label: string;
  kind: string;
  lines: string[];
}

export const templateService = {
  list(filters: TemplateFilters): Template[] {
    return templateRepo.filter(filters);
  },
  get(id: ID | undefined): Template | undefined {
    return templateRepo.find(id);
  },
  featured(limit = 6): Template[] {
    return templateRepo.filter({ featuredOnly: true, sort: 'popular' }).slice(0, limit);
  },
  categories() {
    return templateRepo.categories('template');
  },
  categoryCounts() {
    const templates = templateRepo.filter({});
    return templateRepo.categories('template').map((category) => ({
      category,
      count: templates.filter((template) => template.categoryId === category.id).length,
    }));
  },
  preview(templateId: ID): TemplatePreviewPage[] {
    const template = templateRepo.find(templateId);
    if (!template) return [];
    const pages: TemplatePreviewPage[] = [
      { id: 'cover', label: 'Cover', kind: 'Cover', lines: [template.name, template.style, 'author name'] },
    ];
    template.structure.forEach((row, index) => {
      pages.push({
        id: `struct_${index}`,
        label: row.title,
        kind: row.kind.replace('-', ' '),
        lines: Array.from({ length: 6 }).map((_, lineIndex) =>
          lineIndex === 0 ? row.title : lineIndex === 1 ? '·'.repeat(12) : 'sample text line for layout preview',
        ),
      });
    });
    return pages;
  },
  async use(templateId: ID, userId: ID, userName: string, title?: string) {
    const template = templateRepo.find(templateId);
    if (!template) throw new Error('That template is no longer available.');
    const result = await bookService.createFromTemplate(templateId, userId, userName, title);
    templateRepo.incrementUses(templateId);
    return result;
  },
  async toggleFavorite(id: ID) {
    const template = templateRepo.find(id);
    if (!template) return undefined;
    await delay(120);
    return templateRepo.update(id, { featured: !template.featured });
  },
  async create(input: Partial<Template>): Promise<Template> {
    await delay(400);
    const template: Template = {
      id: uid('tpl'),
      name: input.name ?? 'Untitled template',
      slug: (input.name ?? 'template').toLowerCase().replace(/\s+/g, '-'),
      description: input.description ?? '',
      categoryId: input.categoryId ?? 'cat_fiction',
      style: input.style ?? 'Neutral',
      kind: input.kind ?? 'fiction',
      trimSize: input.trimSize ?? { id: '6x9', label: '6 × 9 in', widthIn: 6, heightIn: 9 },
      pageCount: input.pageCount ?? 96,
      language: input.language ?? 'en',
      premium: input.premium ?? false,
      featured: input.featured ?? false,
      published: input.published ?? true,
      uses: 0,
      rating: input.rating ?? 0,
      coverArtSeed: Math.floor(Math.random() * 9999),
      palette: input.palette ?? 'ink',
      accentColor: input.accentColor ?? '#7c3aed',
      headingFont: input.headingFont ?? 'Playfair Display',
      bodyFont: input.bodyFont ?? 'Source Serif 4',
      tags: input.tags ?? [],
      structure: input.structure ?? [
        { kind: 'front-matter', title: 'Front matter', pages: 3 },
        { kind: 'chapter', title: 'Chapters', pages: 10 },
        { kind: 'back-matter', title: 'Back matter', pages: 2 },
      ],
      tagsLine: (input.tags ?? []).join(' · '),
      createdAt: new Date().toISOString(),
    };
    return templateRepo.create(template);
  },
  update(id: ID, patch: Partial<Template>) {
    return templateRepo.update(id, patch);
  },
  remove(id: ID) {
    templateRepo.remove(id);
  },
  categoriesAll() {
    return templateRepo.categories();
  },

  // ------------------------------------------------- admin: categories & tags
  createCategory(input: { name: string; slug: string; kind: Category['kind']; description: string; color: string; featured?: boolean }): Category {
    const existing = templateRepo.categories();
    const category: Category = {
      id: uid('cat'),
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      description: input.description,
      color: input.color,
      parentId: null,
      featured: input.featured ?? false,
      order: existing.length + 1,
      active: true,
    };
    return templateRepo.createCategory(category);
  },
  updateCategory(id: ID, patch: Partial<Category>) {
    return templateRepo.updateCategory(id, patch);
  },
  removeCategory(id: ID) {
    templateRepo.removeCategory(id);
  },
  reorderCategories(orderedIds: ID[]) {
    orderedIds.forEach((id, index) => templateRepo.updateCategory(id, { order: index + 1 }));
  },
  tags(type?: Tag['type']) {
    return templateRepo.tags(type);
  },
  createTag(input: { name: string; slug: string; type: Tag['type'] }) {
    const tag: Tag = { id: uid('tag'), name: input.name, slug: input.slug, type: input.type, usageCount: 0 };
    return templateRepo.createTag(tag);
  },
  removeTag(id: ID) {
    templateRepo.removeTag(id);
  },
};
