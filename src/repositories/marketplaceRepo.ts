import type {
  Book,
  BookViewEvent,
  ID,
  LibraryItem,
  MarketplaceFilters,
  Order,
  Review,
  WishlistItem,
} from '@/types/domain';
import { getDatabase, mutateDatabase } from '@/store/db';

export const marketplaceRepo = {
  /** Books that are publicly listed in the marketplace. */
  listed(): Book[] {
    return getDatabase().books.filter((book) => book.marketplace.listed && book.visibility === 'marketplace' && book.status !== 'trashed');
  },
  filter(filters: MarketplaceFilters): Book[] {
    let books = marketplaceRepo.listed();

    if (filters.query) {
      const query = filters.query.toLowerCase();
      books = books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) ||
          book.subtitle.toLowerCase().includes(query) ||
          book.authorName.toLowerCase().includes(query) ||
          book.description.toLowerCase().includes(query) ||
          book.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
    if (filters.categoryIds?.length) {
      books = books.filter((book) => book.categoryIds.some((id) => filters.categoryIds.includes(id)));
    }
    if (filters.kind && filters.kind !== 'all') books = books.filter((book) => book.kind === filters.kind);
    switch (filters.priceFilter) {
      case 'free':
        books = books.filter((book) => book.marketplace.price === 0);
        break;
      case 'paid':
        books = books.filter((book) => book.marketplace.price > 0);
        break;
      case 'under5':
        books = books.filter((book) => book.marketplace.price > 0 && book.marketplace.price < 5);
        break;
      case 'under10':
        books = books.filter((book) => book.marketplace.price > 0 && book.marketplace.price < 10);
        break;
      default:
        break;
    }
    if (filters.minRating > 0) books = books.filter((book) => book.marketplace.rating >= filters.minRating);

    const priceOf = (book: Book) =>
      book.marketplace.discountPercent
        ? book.marketplace.price * (1 - book.marketplace.discountPercent / 100)
        : book.marketplace.price;

    switch (filters.sort) {
      case 'newest':
        books.sort((a, b) => ((a.publishedAt ?? a.createdAt) < (b.publishedAt ?? b.createdAt) ? 1 : -1));
        break;
      case 'bestselling':
        books.sort((a, b) => b.marketplace.sales - a.marketplace.sales);
        break;
      case 'price-asc':
        books.sort((a, b) => priceOf(a) - priceOf(b));
        break;
      case 'price-desc':
        books.sort((a, b) => priceOf(b) - priceOf(a));
        break;
      case 'rating':
        books.sort((a, b) => b.marketplace.rating - a.marketplace.rating);
        break;
      case 'trending':
        books.sort((a, b) => b.marketplace.views / 30 + b.marketplace.sales - (a.marketplace.views / 30 + a.marketplace.sales));
        break;
      default:
        books.sort((a, b) => {
          const featuredDiff = Number(b.marketplace.featured) - Number(a.marketplace.featured);
          if (featuredDiff !== 0) return featuredDiff;
          return b.marketplace.popularityScore - a.marketplace.popularityScore;
        });
    }
    return books;
  },
  reviews(bookId: ID): Review[] {
    return getDatabase()
      .reviews.filter((review) => review.bookId === bookId && review.status === 'published')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  allReviews(): Review[] {
    return getDatabase()
      .reviews.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  reviewsByUser(userId: ID): Review[] {
    return getDatabase().reviews.filter((review) => review.userId === userId);
  },
  findReview(id: ID): Review | undefined {
    return getDatabase().reviews.find((review) => review.id === id);
  },
  addReview(review: Review): Review {
    return mutateDatabase((db) => {
      db.reviews = [review, ...db.reviews];
      marketplaceRepo.recomputeRatingIn(db, review.bookId);
      return review;
    });
  },
  updateReview(id: ID, patch: Partial<Review>): Review | undefined {
    return mutateDatabase((db) => {
      const index = db.reviews.findIndex((review) => review.id === id);
      if (index === -1) return undefined;
      db.reviews[index] = { ...db.reviews[index], ...patch, updatedAt: new Date().toISOString() };
      marketplaceRepo.recomputeRatingIn(db, db.reviews[index].bookId);
      return db.reviews[index];
    });
  },
  removeReview(id: ID) {
    return mutateDatabase((db) => {
      const review = db.reviews.find((entry) => entry.id === id);
      db.reviews = db.reviews.filter((entry) => entry.id !== id);
      if (review) marketplaceRepo.recomputeRatingIn(db, review.bookId);
    });
  },
  /** Ratings shown on book pages come from the moderation-visible review set. */
  recomputeRatingIn(db: { books: Book[]; reviews: Review[] }, bookId: ID) {
    const book = db.books.find((entry) => entry.id === bookId);
    if (!book) return;
    const published = db.reviews.filter((review) => review.bookId === bookId && review.status === 'published');
    const total = published.reduce((sum, review) => sum + review.rating, 0);
    const seededCount = Math.max(book.marketplace.reviewCount - published.length, 0);
    const seededRating = book.marketplace.rating;
    const combinedCount = published.length + seededCount;
    book.marketplace.rating = combinedCount
      ? Number(((total + seededRating * seededCount) / combinedCount).toFixed(2))
      : 0;
  },
  // ---------------------------------------------------------------- orders
  orders(): Order[] {
    return getDatabase()
      .orders.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  ordersByAuthor(authorId: ID): Order[] {
    return marketplaceRepo.orders().filter((order) => order.authorId === authorId);
  },
  ordersByBuyer(buyerId: ID): Order[] {
    return marketplaceRepo.orders().filter((order) => order.buyerId === buyerId);
  },
  addOrder(order: Order): Order {
    return mutateDatabase((db) => {
      db.orders = [order, ...db.orders];
      const book = db.books.find((entry) => entry.id === order.bookId);
      if (book && order.status === 'completed') {
        book.marketplace.sales += 1;
        book.marketplace.downloads += 1;
        book.marketplace.popularityScore += 6;
      }
      return order;
    });
  },
  updateOrder(id: ID, patch: Partial<Order>): Order | undefined {
    return mutateDatabase((db) => {
      const index = db.orders.findIndex((order) => order.id === id);
      if (index === -1) return undefined;
      db.orders[index] = { ...db.orders[index], ...patch };
      return db.orders[index];
    });
  },
  // -------------------------------------------------------------- wishlist
  wishlist(userId: ID): WishlistItem[] {
    return getDatabase()
      .wishlist.filter((item) => item.userId === userId)
      .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  },
  inWishlist(userId: ID, bookId: ID): boolean {
    return getDatabase().wishlist.some((item) => item.userId === userId && item.bookId === bookId);
  },
  addWishlist(item: WishlistItem): WishlistItem {
    return mutateDatabase((db) => {
      if (db.wishlist.some((entry) => entry.userId === item.userId && entry.bookId === item.bookId)) return item;
      db.wishlist = [item, ...db.wishlist];
      const book = db.books.find((entry) => entry.id === item.bookId);
      if (book) book.marketplace.favorites += 1;
      return item;
    });
  },
  removeWishlist(userId: ID, bookId: ID) {
    return mutateDatabase((db) => {
      const exists = db.wishlist.some((entry) => entry.userId === userId && entry.bookId === bookId);
      db.wishlist = db.wishlist.filter((entry) => !(entry.userId === userId && entry.bookId === bookId));
      const book = db.books.find((entry) => entry.id === bookId);
      if (book && exists) book.marketplace.favorites = Math.max(0, book.marketplace.favorites - 1);
    });
  },
  // --------------------------------------------------------------- library
  library(userId: ID): LibraryItem[] {
    return getDatabase()
      .library.filter((item) => item.userId === userId)
      .sort((a, b) => (a.acquiredAt < b.acquiredAt ? 1 : -1));
  },
  libraryItem(userId: ID, bookId: ID): LibraryItem | undefined {
    return getDatabase().library.find((item) => item.userId === userId && item.bookId === bookId);
  },
  addLibraryItem(item: LibraryItem): LibraryItem {
    return mutateDatabase((db) => {
      db.library = [item, ...db.library];
      return item;
    });
  },
  updateLibraryItem(id: ID, patch: Partial<LibraryItem>): LibraryItem | undefined {
    return mutateDatabase((db) => {
      const index = db.library.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      db.library[index] = { ...db.library[index], ...patch };
      return db.library[index];
    });
  },
  removeLibraryItem(id: ID) {
    return mutateDatabase((db) => {
      db.library = db.library.filter((item) => item.id !== id);
    });
  },
  // ----------------------------------------------------------- view events
  viewEvents(bookId?: ID): BookViewEvent[] {
    const events = getDatabase().viewEvents;
    return bookId ? events.filter((event) => event.bookId === bookId) : events;
  },
  trackView(event: BookViewEvent) {
    return mutateDatabase((db) => {
      db.viewEvents = [event, ...db.viewEvents].slice(0, 4000);
      const book = db.books.find((entry) => entry.id === event.bookId);
      if (book) book.marketplace.views += 1;
      return event;
    });
  },
};
