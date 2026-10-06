import type { ID, LibraryItem, MarketplaceFilters, Order, Review, WishlistItem } from '@/types/domain';
import { delay, percent, uid } from '@/lib/utils';
import { activityRepo, bookRepo, marketplaceRepo, notificationRepo, userRepo } from '@/repositories';
import { getDatabase } from '@/store/db';
import { emailService } from './notificationService';

export interface CheckoutResult {
  order: Order;
  libraryItem: LibraryItem;
  receipt: { number: string; total: number; platformFee: number; authorEarnings: number; method: string; date: string };
}

export const marketplaceService = {
  browse(filters: MarketplaceFilters) {
    return marketplaceRepo.filter(filters);
  },
  featured(limit = 6) {
    return marketplaceRepo.listed().filter((book) => book.marketplace.featured).slice(0, limit);
  },
  trending(limit = 8) {
    return marketplaceRepo
      .listed()
      .slice()
      .sort((a, b) => b.marketplace.popularityScore - a.marketplace.popularityScore)
      .slice(0, limit);
  },
  newReleases(limit = 8) {
    return marketplaceRepo
      .listed()
      .slice()
      .sort((a, b) => ((a.publishedAt ?? a.createdAt) < (b.publishedAt ?? b.createdAt) ? 1 : -1))
      .slice(0, limit);
  },
  bestSellers(limit = 8) {
    return marketplaceRepo
      .listed()
      .slice()
      .sort((a, b) => b.marketplace.sales - a.marketplace.sales)
      .slice(0, limit);
  },
  staffPicks(limit = 6) {
    return marketplaceRepo.listed().filter((book) => book.marketplace.staffPick).slice(0, limit);
  },
  recommended(userId: ID, limit = 6) {
    const db = getDatabase();
    const user = db.users.find((entry) => entry.id === userId);
    const library = db.library.filter((item) => item.userId === userId);
    const ownedIds = library.map((item) => item.bookId);
    const likedCategories = db.books
      .filter((book) => ownedIds.includes(book.id))
      .flatMap((book) => book.categoryIds);
    return marketplaceRepo
      .listed()
      .filter((book) => !ownedIds.includes(book.id))
      .sort((a, b) => {
        const scoreA = a.categoryIds.filter((id) => likedCategories.includes(id)).length + a.marketplace.rating / 5;
        const scoreB = b.categoryIds.filter((id) => likedCategories.includes(id)).length + b.marketplace.rating / 5;
        return scoreB - scoreA;
      })
      .slice(0, limit)
      .map((book) => ({ book, reason: likedCategories.length ? 'Because of books you have read' : 'Popular with new readers', user: user?.name }));
  },
  free(limit = 8) {
    return marketplaceRepo.listed().filter((book) => book.marketplace.price === 0).slice(0, limit);
  },
  premium(limit = 8) {
    return marketplaceRepo.listed().filter((book) => book.marketplace.price >= 9.99).slice(0, limit);
  },
  get(bookId: ID) {
    return bookRepo.find(bookId);
  },
  effectivePrice(bookId: ID) {
    const book = bookRepo.find(bookId);
    if (!book) return 0;
    return book.marketplace.discountPercent
      ? Number((book.marketplace.price * (1 - book.marketplace.discountPercent / 100)).toFixed(2))
      : book.marketplace.price;
  },
  reviews(bookId: ID): Review[] {
    return marketplaceRepo.reviews(bookId);
  },
  reviewSummary(bookId: ID) {
    const book = bookRepo.find(bookId);
    const reviews = marketplaceRepo.reviews(bookId);
    const counts = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: reviews.filter((review) => review.rating === star).length,
    }));
    const total = reviews.length;
    return {
      rating: book?.marketplace.rating ?? 0,
      count: (book?.marketplace.reviewCount ?? 0) + 0,
      counts,
      breakdown: counts.map((entry) => ({ ...entry, percent: percent(entry.count, Math.max(1, total)) })),
    };
  },
  async addReview(bookId: ID, userId: ID, params: { rating: number; title: string; body: string }): Promise<Review> {
    await delay(420);
    const user = userRepo.find(userId);
    const existing = marketplaceRepo.reviewsByUser(userId).find((review) => review.bookId === bookId);
    const review: Review = {
      id: existing?.id ?? uid('rev'),
      bookId,
      userId,
      userName: user?.name ?? 'Reader',
      userAvatar: user?.avatarUrl ?? '',
      rating: params.rating,
      title: params.title,
      body: params.body,
      status: 'published',
      helpful: existing?.helpful ?? 0,
      flagged: false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: existing ? new Date().toISOString() : undefined,
      verifiedPurchase: Boolean(marketplaceRepo.libraryItem(userId, bookId)),
    };
    if (existing) marketplaceRepo.updateReview(existing.id, review);
    else marketplaceRepo.addReview(review);

    const book = bookRepo.find(bookId);
    if (book && book.ownerId !== userId) {
      notificationRepo.add({
        id: uid('notif'),
        userId: book.ownerId,
        type: 'review',
        title: `New ${params.rating}★ review on ${book.title}`,
        body: params.title,
        read: false,
        createdAt: new Date().toISOString(),
        link: `/marketplace/${book.id}`,
        priority: 'normal',
      });
    }
    return review;
  },
  updateReview(reviewId: ID, patch: Partial<Review>) {
    return marketplaceRepo.updateReview(reviewId, patch);
  },
  removeReview(reviewId: ID) {
    marketplaceRepo.removeReview(reviewId);
  },
  markHelpful(reviewId: ID) {
    const review = marketplaceRepo.findReview(reviewId);
    if (!review) return undefined;
    return marketplaceRepo.updateReview(reviewId, { helpful: review.helpful + 1 });
  },
  async reportReview(reviewId: ID, reporterId: ID, reason: string, details: string) {
    await delay(300);
    const review = marketplaceRepo.findReview(reviewId);
    if (review) marketplaceRepo.updateReview(reviewId, { flagged: true, status: 'pending' });
    const reporter = userRepo.find(reporterId);
    const { adminRepo } = await import('@/repositories');
    adminRepo.createReport({
      id: uid('report'),
      reporterId,
      reporterName: reporter?.name ?? 'Reader',
      targetType: 'review',
      targetId: reviewId,
      targetLabel: review ? `Review on “${bookRepo.find(review.bookId)?.title ?? 'book'}”` : 'Review',
      reason: reason as 'spam' | 'copyright' | 'offensive' | 'misinformation' | 'plagiarism' | 'other',
      details,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
  },
  // ------------------------------------------------------------- wishlist
  wishlist(userId: ID) {
    return marketplaceRepo.wishlist(userId).map((item) => ({ item, book: bookRepo.find(item.bookId) }));
  },
  inWishlist(userId: ID, bookId: ID) {
    return marketplaceRepo.inWishlist(userId, bookId);
  },
  toggleWishlist(userId: ID, bookId: ID): { added: boolean } {
    if (marketplaceRepo.inWishlist(userId, bookId)) {
      marketplaceRepo.removeWishlist(userId, bookId);
      return { added: false };
    }
    marketplaceRepo.addWishlist({ id: uid('wish'), userId, bookId, addedAt: new Date().toISOString() });
    return { added: true };
  },
  removeWishlist(userId: ID, bookId: ID) {
    marketplaceRepo.removeWishlist(userId, bookId);
  },
  // -------------------------------------------------------------- checkout
  async purchase(bookId: ID, buyerId: ID, method: Order['method'] = 'card'): Promise<CheckoutResult> {
    await delay(900);
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('That book is no longer available.');
    const buyer = userRepo.find(buyerId);
    if (!buyer) throw new Error('Please sign in to complete this purchase.');
    if (book.ownerId === buyerId) throw new Error('You already own this book — it is your own project.');

    const price = marketplaceService.effectivePrice(bookId);
    const commission = book.marketplace.commissionRate || getDatabase().adminSettings.marketplace.commissionRate;
    const authorEarnings = Number((price * (1 - commission)).toFixed(2));

    const order: Order = {
      id: uid('order'),
      number: `SC-${Math.floor(10000 + Math.random() * 89999)}`,
      buyerId,
      buyerName: buyer.name,
      bookId,
      bookTitle: book.title,
      authorId: book.ownerId,
      authorName: book.authorName,
      amount: price,
      currency: 'USD',
      platformFee: Number((price - authorEarnings).toFixed(2)),
      authorEarnings,
      status: price === 0 ? 'completed' : 'completed',
      method,
      createdAt: new Date().toISOString(),
      country: buyer.country,
    };
    marketplaceRepo.addOrder(order);

    const libraryItem: LibraryItem = {
      id: uid('lib'),
      userId: buyerId,
      bookId,
      orderId: order.id,
      acquiredAt: new Date().toISOString(),
      progress: 0,
      bookmarkedPages: [],
      downloaded: false,
      source: price === 0 ? 'free' : 'purchase',
      readingMode: 'page',
      fontSize: 18,
      readerTheme: 'light',
    };
    if (!marketplaceRepo.libraryItem(buyerId, bookId)) marketplaceRepo.addLibraryItem(libraryItem);

    if (book.ownerId !== buyerId) {
      notificationRepo.add({
        id: uid('notif'),
        userId: book.ownerId,
        type: 'sale',
        title: `New sale — ${book.title}`,
        body: `${buyer.name} purchased your book for $${order.amount.toFixed(2)}. You earned $${order.authorEarnings.toFixed(2)}.`,
        read: false,
        createdAt: new Date().toISOString(),
        link: '/dashboard/earnings',
        priority: 'high',
      });
      const author = userRepo.find(book.ownerId);
      if (author) await emailService.send({ to: author.email, toName: author.name, template: 'book-sale', meta: book.title });
    }
    activityRepo.add({
      id: uid('act'),
      userId: buyerId,
      type: 'sale',
      message: `Purchased ${book.title}`,
      meta: `$${order.amount.toFixed(2)} · ${order.number}`,
      createdAt: new Date().toISOString(),
      link: `/dashboard/library`,
    });

    return {
      order,
      libraryItem,
      receipt: {
        number: order.number,
        total: order.amount,
        platformFee: order.platformFee,
        authorEarnings: order.authorEarnings,
        method: method === 'card' ? 'Visa •••• 4242' : method === 'paypal' ? 'PayPal balance' : method === 'apple-pay' ? 'Apple Pay' : 'Scriptora credits',
        date: order.createdAt,
      },
    };
  },
  async refund(orderId: ID, reason: string, actorId = 'user_admin') {
    await delay(500);
    const order = marketplaceRepo.orders().find((entry) => entry.id === orderId);
    if (!order) throw new Error('Order not found.');
    const updated = marketplaceRepo.updateOrder(orderId, { status: 'refunded', refundReason: reason });
    if (order.status === 'completed') {
      const book = bookRepo.find(order.bookId);
      if (book) bookRepo.update(book.id, { marketplace: { ...book.marketplace, sales: Math.max(0, book.marketplace.sales - 1) } });
      notificationRepo.add({
        id: uid('notif'),
        userId: order.buyerId,
        type: 'system',
        title: `Refund issued for ${order.bookTitle}`,
        body: `$${order.amount.toFixed(2)} has been refunded to your original payment method.`,
        read: false,
        createdAt: new Date().toISOString(),
        link: '/dashboard/library',
        priority: 'normal',
      });
    }
    void actorId;
    return updated;
  },
  // --------------------------------------------------------------- library
  library(userId: ID) {
    return marketplaceRepo.library(userId).map((item) => ({ item, book: bookRepo.find(item.bookId) }));
  },
  libraryItem(userId: ID, bookId: ID) {
    return marketplaceRepo.libraryItem(userId, bookId);
  },
  owns(userId: ID, bookId: ID) {
    const book = bookRepo.find(bookId);
    return Boolean(book && book.ownerId === userId) || Boolean(marketplaceRepo.libraryItem(userId, bookId));
  },
  updateProgress(userId: ID, bookId: ID, progress: number, pageIndex?: number) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return undefined;
    const bookmarkedPages = pageIndex !== undefined && !item.bookmarkedPages.includes(pageIndex)
      ? item.bookmarkedPages
      : item.bookmarkedPages;
    return marketplaceRepo.updateLibraryItem(item.id, {
      progress: Math.max(0, Math.min(100, Math.round(progress))),
      lastReadAt: new Date().toISOString(),
      bookmarkedPages,
    });
  },
  setBookmark(userId: ID, bookId: ID, pageIndex: number) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return undefined;
    const exists = item.bookmarkedPages.includes(pageIndex);
    return marketplaceRepo.updateLibraryItem(item.id, {
      bookmarkedPages: exists ? item.bookmarkedPages.filter((entry) => entry !== pageIndex) : [...item.bookmarkedPages, pageIndex],
    });
  },
  updateReaderSettings(userId: ID, bookId: ID, patch: Partial<LibraryItem>) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return undefined;
    return marketplaceRepo.updateLibraryItem(item.id, patch);
  },
  markDownloaded(userId: ID, bookId: ID) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return undefined;
    return marketplaceRepo.updateLibraryItem(item.id, { downloaded: true });
  },
  /** Removes a title from the reader's library. Ownership records (orders) are kept for receipts. */
  removeFromLibrary(userId: ID, bookId: ID) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return false;
    marketplaceRepo.removeLibraryItem(item.id);
    return true;
  },
  /** Clears reading progress without removing the title. */
  resetProgress(userId: ID, bookId: ID) {
    const item = marketplaceRepo.libraryItem(userId, bookId);
    if (!item) return undefined;
    return marketplaceRepo.updateLibraryItem(item.id, { progress: 0, bookmarkedPages: [] });
  },
  orders(userId?: ID) {
    const db = getDatabase();
    if (!userId) return db.orders.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return db.orders
      .filter((order) => order.buyerId === userId || order.authorId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  trackView(bookId: ID, userId?: ID, source: 'marketplace' | 'author-page' | 'search' | 'external' | 'internal' = 'marketplace') {
    marketplaceRepo.trackView({
      id: uid('view'),
      bookId,
      userId,
      createdAt: new Date().toISOString(),
      country: 'US',
      source,
    });
  },
};
