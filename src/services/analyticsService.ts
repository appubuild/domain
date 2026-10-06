import type { AnalyticsSummary, ID, TimeSeriesPoint } from '@/types/domain';
import { getDatabase } from '@/store/db';
import { bookRepo, marketplaceRepo } from '@/repositories';
import { revenueService, type PeriodKey } from './revenueService';

export interface BookAnalytics {
  bookId: ID;
  title: string;
  cover: string;
  views: number;
  sales: number;
  conversion: number;
  favorites: number;
  rating: number;
  reviews: number;
  revenue: number;
  downloads: number;
}

export const analyticsService = {
  /** Author-facing analytics across all of their titles. */
  authorSummary(authorId: ID, period: PeriodKey = '30d'): AnalyticsSummary {
    return revenueService.summary(authorId, period);
  },
  bookBreakdown(authorId: ID, period: PeriodKey = '30d'): BookAnalytics[] {
    const books = bookRepo.list({ ownerId: authorId, status: 'all' });
    return books
      .map((book) => {
        const orders = marketplaceRepo.ordersByAuthor(authorId).filter((order) => order.bookId === book.id && order.status === 'completed');
        return {
          bookId: book.id,
          title: book.title,
          cover: book.cover.imageUrl,
          views: book.marketplace.views,
          sales: orders.length,
          conversion: book.marketplace.views ? Number(((orders.length / book.marketplace.views) * 100).toFixed(2)) : 0,
          favorites: book.marketplace.favorites,
          rating: book.marketplace.rating,
          reviews: book.marketplace.reviewCount,
          revenue: Number(orders.reduce((total, order) => total + order.authorEarnings, 0).toFixed(2)),
          downloads: book.marketplace.downloads,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  },
  trafficSources(authorId: ID) {
    const db = getDatabase();
    const bookIds = bookRepo.list({ ownerId: authorId, status: 'all' }).map((book) => book.id);
    const events = db.viewEvents.filter((event) => bookIds.includes(event.bookId));
    const sources = new Map<string, number>();
    events.forEach((event) => sources.set(event.source, (sources.get(event.source) ?? 0) + 1));
    return Array.from(sources.entries()).map(([source, count]) => ({ source, count, percent: Math.round((count / Math.max(1, events.length)) * 100) }));
  },
  readersByCountry(authorId: ID) {
    return revenueService.byCountry(authorId);
  },
  viewsSeries(authorId: ID, period: PeriodKey = '30d'): TimeSeriesPoint[] {
    return revenueService.timeseries(authorId, period, 'views');
  },
  readingActivity(userId: ID) {
    const db = getDatabase();
    return db.library
      .filter((item) => item.userId === userId)
      .map((item) => ({
        item,
        book: db.books.find((book) => book.id === item.bookId),
      }))
      .sort((a, b) => (a.item.lastReadAt ?? '') < (b.item.lastReadAt ?? '') ? 1 : -1);
  },
  /** Admin-facing platform analytics. */
  platform(period: PeriodKey = '30d') {
    const db = getDatabase();
    const days = revenueService.periods.find((entry) => entry.key === period)?.days ?? 30;
    const within = (iso: string) => Date.now() - new Date(iso).getTime() <= days * 86400000;
    const orders = db.orders.filter((order) => order.status === 'completed' && within(order.createdAt));
    return {
      revenue: Number(orders.reduce((total, order) => total + order.amount, 0).toFixed(2)),
      fees: Number(orders.reduce((total, order) => total + order.platformFee, 0).toFixed(2)),
      orders: orders.length,
      users: db.users.filter((user) => within(user.createdAt)).length,
      books: db.books.filter((book) => within(book.createdAt)).length,
      publishings: db.books.filter((book) => book.publishedAt && within(book.publishedAt)).length,
      aiCredits: db.aiUsage.filter((record) => within(record.createdAt)).reduce((total, record) => total + record.credits, 0),
      storageGrowthGb: 18.4,
    };
  },
};
