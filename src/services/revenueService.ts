import type { AnalyticsSummary, Book, ID, ISODate, Order, RevenueByBook, TimeSeriesPoint } from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';
import { uid, delay } from '@/lib/utils';
import { activityRepo } from '@/repositories';
import { marketplaceRepo, bookRepo } from '@/repositories';

export type PeriodKey = '7d' | '30d' | '90d' | '1y' | 'all';

export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: 3650 },
];

function periodDays(period: PeriodKey) {
  return PERIODS.find((entry) => entry.key === period)?.days ?? 30;
}

function inPeriod(date: string, days: number, offsetDays = 0) {
  const target = new Date(date).getTime();
  const now = Date.now();
  const start = now - (offsetDays + days) * 86400000;
  const end = now - offsetDays * 86400000;
  return target >= start && target <= end;
}

export const revenueService = {
  periods: PERIODS,
  ordersForAuthor(authorId: ID): Order[] {
    return marketplaceRepo.ordersByAuthor(authorId);
  },
  summary(authorId: ID, period: PeriodKey = '30d'): AnalyticsSummary {
    const days = periodDays(period);
    const orders = marketplaceRepo.ordersByAuthor(authorId);
    const periodOrders = period === 'all' ? orders : orders.filter((order) => inPeriod(order.createdAt, days));
    const completed = periodOrders.filter((order) => order.status === 'completed');
    const refunded = periodOrders.filter((order) => order.status === 'refunded');
    const pending = periodOrders.filter((order) => order.status === 'pending');

    const gross = completed.reduce((total, order) => total + order.amount, 0);
    const fees = completed.reduce((total, order) => total + order.platformFee, 0);
    const net = completed.reduce((total, order) => total + order.authorEarnings, 0);
    const previous = orders.filter((order) => inPeriod(order.createdAt, days, days) && order.status === 'completed');
    const previousNet = previous.reduce((total, order) => total + order.authorEarnings, 0);

    const books = bookRepo.list({ ownerId: authorId, status: 'all' });
    const views = books.reduce((total, book) => total + book.marketplace.views, 0);
    const reviews = books.reduce((total, book) => total + book.marketplace.reviewCount, 0);
    const rated = books.filter((book) => book.marketplace.rating > 0);
    const avgRating = rated.length ? rated.reduce((total, book) => total + book.marketplace.rating, 0) / rated.length : 0;
    const favoriteCount = books.reduce((total, book) => total + book.marketplace.favorites, 0);

    return {
      totalRevenue: Number(net.toFixed(2)),
      availableBalance: Number((net * 0.72).toFixed(2)),
      pendingBalance: Number((net * 0.28 + pending.reduce((total, order) => total + order.authorEarnings, 0)).toFixed(2)),
      lifetimeRevenue: Number(orders.filter((order) => order.status === 'completed').reduce((total, order) => total + order.authorEarnings, 0).toFixed(2)),
      totalSales: completed.length,
      refunds: refunded.length,
      platformFees: Number(fees.toFixed(2)),
      netEarnings: Number(net.toFixed(2)),
      views,
      conversionRate: views ? Number(((completed.length / views) * 100).toFixed(2)) : 0,
      downloads: books.reduce((total, book) => total + book.marketplace.downloads, 0),
      favorites: favoriteCount,
      reviews,
      avgRating: Number(avgRating.toFixed(2)),
      changePct: {
        revenue: previousNet ? Number((((net - previousNet) / previousNet) * 100).toFixed(1)) : net > 0 ? 100 : 0,
        sales: previous.length ? Number((((completed.length - previous.length) / previous.length) * 100).toFixed(1)) : completed.length ? 100 : 0,
        views: 12.4,
        conversion: 0.8,
      },
      grossRevenue: Number(gross.toFixed(2)),
    } as AnalyticsSummary & { grossRevenue: number };
  },
  timeseries(authorId: ID, period: PeriodKey = '30d', metric: 'revenue' | 'sales' | 'views' = 'revenue'): TimeSeriesPoint[] {
    const days = Math.min(periodDays(period), 365);
    const orders = marketplaceRepo.ordersByAuthor(authorId).filter((order) => order.status === 'completed');
    const books = bookRepo.list({ ownerId: authorId, status: 'all' });
    const events = getDatabase().viewEvents.filter((event) => books.some((book) => book.id === event.bookId));

    const bucketSize = days <= 30 ? 1 : days <= 90 ? 3 : 14;
    const buckets = Math.ceil(days / bucketSize);
    const points: TimeSeriesPoint[] = [];

    for (let index = buckets - 1; index >= 0; index -= 1) {
      const bucketEnd = index * bucketSize;
      const bucketStart = bucketEnd + bucketSize;
      const date = new Date(Date.now() - bucketEnd * 86400000);
      const label = `${date.getMonth() + 1}/${date.getDate()}`;
      const inBucket = (iso: string) => {
        const age = (Date.now() - new Date(iso).getTime()) / 86400000;
        return age >= bucketEnd && age < bucketStart;
      };
      if (metric === 'revenue') {
        const value = orders.filter((order) => inBucket(order.createdAt)).reduce((total, order) => total + order.authorEarnings, 0);
        points.push({ date: date.toISOString(), value: Number(value.toFixed(2)), label });
      } else if (metric === 'sales') {
        const value = orders.filter((order) => inBucket(order.createdAt)).length;
        points.push({ date: date.toISOString(), value, label });
      } else {
        const value = events.filter((event) => inBucket(event.createdAt)).length * 3 + Math.round(8 + Math.random() * 14);
        points.push({ date: date.toISOString(), value, label });
      }
    }
    return points;
  },
  revenueByBook(authorId: ID, period: PeriodKey = '30d'): RevenueByBook[] {
    const days = periodDays(period);
    const books = bookRepo.list({ ownerId: authorId, status: 'all' });
    const orders = marketplaceRepo.ordersByAuthor(authorId).filter((order) => order.status === 'completed');
    return books
      .map((book) => {
        const bookOrders = orders.filter(
          (order) => order.bookId === book.id && (period === 'all' || inPeriod(order.createdAt, days)),
        );
        return {
          bookId: book.id,
          title: book.title,
          cover: book.cover.imageUrl,
          sales: bookOrders.length,
          revenue: Number(bookOrders.reduce((total, order) => total + order.authorEarnings, 0).toFixed(2)),
          rating: book.marketplace.rating,
          status: book.status,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  },
  topBuyers(authorId: ID, limit = 8) {
    const orders = marketplaceRepo.ordersByAuthor(authorId).filter((order) => order.status === 'completed');
    const byBuyer = new Map<string, { name: string; orders: number; spend: number; lastOrder: string; country: string }>();
    orders.forEach((order) => {
      const existing = byBuyer.get(order.buyerId) ?? { name: order.buyerName, orders: 0, spend: 0, lastOrder: order.createdAt, country: order.country };
      existing.orders += 1;
      existing.spend += order.amount;
      if (order.createdAt > existing.lastOrder) existing.lastOrder = order.createdAt;
      byBuyer.set(order.buyerId, existing);
    });
    return Array.from(byBuyer.entries())
      .map(([userId, data]) => ({ userId, ...data, spend: Number(data.spend.toFixed(2)) }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, limit);
  },
  byCountry(authorId: ID) {
    const orders = marketplaceRepo.ordersByAuthor(authorId).filter((order) => order.status === 'completed');
    const map = new Map<string, { country: string; sales: number; revenue: number }>();
    orders.forEach((order) => {
      const existing = map.get(order.country) ?? { country: order.country, sales: 0, revenue: 0 };
      existing.sales += 1;
      existing.revenue += order.authorEarnings;
      map.set(order.country, existing);
    });
    return Array.from(map.values())
      .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }))
      .sort((a, b) => b.revenue - a.revenue);
  },
  authorBooks(authorId: ID): Book[] {
    return bookRepo.list({ ownerId: authorId, status: 'all' });
  },
  payoutSummary(authorId: ID) {
    const summary = revenueService.summary(authorId, 'all');
    const settings = getDatabase().adminSettings.marketplace;
    const author = getDatabase().users.find((user) => user.id === authorId);
    return {
      available: summary.availableBalance,
      pending: summary.pendingBalance,
      threshold: settings.payoutThreshold,
      schedule: settings.payoutSchedule,
      eligible: summary.availableBalance >= settings.payoutThreshold && author?.payoutMethod?.ready !== false,
      method: author?.payoutMethod,
    };
  },
  /**
   * Requests a payout of the available balance. Payout requests are persisted as
   * activity entries (meta: "payout:<amount>") so history survives a reload without
   * needing a dedicated payouts table in the mock schema.
   */
  async requestPayout(authorId: ID): Promise<{ reference: string; amount: number; method: string; scheduledFor: ISODate }> {
    await delay(650);
    const payout = revenueService.payoutSummary(authorId);
    if (!payout.eligible) {
      throw new Error(
        payout.available < payout.threshold
          ? `You need at least ${payout.threshold.toFixed(2)} available before requesting a payout.`
          : 'Add a verified payout method before requesting a payout.',
      );
    }
    const reference = uid('po');
    const amount = Number(payout.available.toFixed(2));
    activityRepo.add({
      id: uid('act'),
      userId: authorId,
      type: 'sale',
      message: `Payout of ${amount.toFixed(2)} requested`,
      meta: `payout:${amount}`,
      link: '/dashboard/earnings',
      createdAt: new Date().toISOString(),
    });
    const scheduledFor = new Date(Date.now() + 3 * 86400000).toISOString();
    return { reference, amount, method: payout.method?.label ?? 'Bank transfer', scheduledFor };
  },
  /** Payout requests already made, newest first. */
  payoutHistory(authorId: ID): { id: ID; amount: number; createdAt: ISODate }[] {
    return activityRepo
      .forUser(authorId)
      .filter((item) => item.meta?.startsWith('payout:'))
      .map((item) => ({ id: item.id, amount: Number((item.meta ?? '').replace('payout:', '')), createdAt: item.createdAt }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  /** Every order (including refunds and pending) for the author, newest first. */
  orderFeed(authorId: ID): Order[] {
    return marketplaceRepo.ordersByAuthor(authorId).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async refundOrder(orderId: ID, reason: string, actorId = 'user_admin'): Promise<Order | undefined> {
    const order = getDatabase().orders.find((entry) => entry.id === orderId);
    if (!order) throw new Error('Order not found.');
    if (order.status === 'refunded') throw new Error('That order has already been refunded.');
    return mutateDatabase((db) => {
      const index = db.orders.findIndex((entry) => entry.id === orderId);
      db.orders[index] = { ...db.orders[index], status: 'refunded', refundReason: reason };
      return db.orders[index];
    });
  },
  invoices(userId: ID) {
    return getDatabase()
      .invoices.filter((invoice) => invoice.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
};
