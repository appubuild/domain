import type { Book, Category, ID, Template, User } from '@/types/domain';
import { delay } from '@/lib/utils';
import { getDatabase } from '@/store/db';
import { marketplaceRepo, templateRepo, userRepo } from '@/repositories';

export interface SearchResults {
  query: string;
  books: Book[];
  templates: Template[];
  authors: User[];
  categories: Category[];
  total: number;
  suggestions: string[];
}

const RECENT_KEY = 'scriptora.recent-searches.v1';

export const searchService = {
  async search(query: string, limit = 6): Promise<SearchResults> {
    await delay(220);
    const trimmed = query.trim();
    if (!trimmed) {
      return { query: '', books: [], templates: [], authors: [], categories: [], total: 0, suggestions: searchService.suggestions() };
    }
    const lower = trimmed.toLowerCase();
    const db = getDatabase();

    const books = marketplaceRepo
      .listed()
      .filter(
        (book) =>
          book.title.toLowerCase().includes(lower) ||
          book.authorName.toLowerCase().includes(lower) ||
          book.tags.some((tag) => tag.includes(lower)) ||
          book.description.toLowerCase().includes(lower),
      )
      .slice(0, limit);

    const templates = templateRepo
      .filter({})
      .filter(
        (template) =>
          template.name.toLowerCase().includes(lower) ||
          template.style.toLowerCase().includes(lower) ||
          template.tags.some((tag) => tag.includes(lower)),
      )
      .slice(0, limit);

    const authors = db.users
      .filter((user) => user.isAuthor && (user.name.toLowerCase().includes(lower) || user.username.toLowerCase().includes(lower) || user.tagline.toLowerCase().includes(lower)))
      .slice(0, limit);

    const categories = db.categories.filter((category) => category.name.toLowerCase().includes(lower)).slice(0, limit);

    return {
      query: trimmed,
      books,
      templates,
      authors,
      categories,
      total: books.length + templates.length + authors.length + categories.length,
      suggestions: searchService.suggestions(lower),
    };
  },
  suggestions(prefix = ''): string[] {
    const db = getDatabase();
    const pool = [
      'slow living',
      'literary fiction',
      'cookbook templates',
      'children\u2019s picture book',
      'print ready pdf',
      'epub 3',
      'planner templates',
      'graphic novel',
      'business playbook',
      'poetry collection',
    ];
    const authorNames = db.users.filter((user) => user.isAuthor).map((user) => user.name);
    const all = [...pool, ...authorNames];
    return all.filter((entry) => entry.toLowerCase().includes(prefix.toLowerCase())).slice(0, 6);
  },
  recent(): string[] {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  },
  pushRecent(query: string) {
    if (!query.trim()) return;
    try {
      const existing = searchService.recent().filter((entry) => entry !== query);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify([query, ...existing].slice(0, 6)));
    } catch {
      // storage unavailable
    }
  },
  clearRecent() {
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
  },
  authorProfile(userId: ID) {
    const profile = getDatabase().authorProfiles.find((entry) => entry.userId === userId);
    const user = userRepo.find(userId);
    return profile ? { ...profile, user } : user ? {
      userId: user.id,
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl,
      tagline: user.tagline,
      bio: user.bio,
      social: user.social,
      location: user.country,
      followers: user.followers,
      rating: 0,
      totalBooks: 0,
      totalSales: 0,
      joinedAt: user.createdAt,
      verified: false,
      featured: false,
      genres: [],
      user,
    } : undefined;
  },
  authors() {
    const db = getDatabase();
    return db.authorProfiles
      .map((profile) => ({ profile, user: userRepo.find(profile.userId) }))
      .filter((entry) => entry.user && entry.user.status === 'active');
  },
  categories() {
    return templateRepo.categories();
  },
};
