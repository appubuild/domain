import type { Book, ID, PublishingSubmission } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { activityRepo, adminRepo, bookRepo, emailRepo, notificationRepo, submissionRepo, userRepo } from '@/repositories';
import { getDatabase } from '@/store/db';
import { preflightService } from './preflightService';
import { emailService } from './notificationService';

export const PUBLISHING_STEPS = [
  { id: 'info', label: 'Book information', description: 'Title, subtitle, author name and language.' },
  { id: 'content', label: 'Content', description: 'Chapters, front matter and back matter complete.' },
  { id: 'cover', label: 'Cover', description: 'Front cover artwork at the required resolution.' },
  { id: 'metadata', label: 'Metadata', description: 'ISBN, publisher, publication date and rights.' },
  { id: 'categories', label: 'Categories', description: 'Primary category and up to three secondary.' },
  { id: 'keywords', label: 'Keywords', description: 'Seven discovery keywords for retail search.' },
  { id: 'pricing', label: 'Pricing', description: 'List price, discount and free preview length.' },
  { id: 'preview', label: 'Preview', description: 'Confirm how the sample appears to readers.' },
  { id: 'preflight', label: 'Preflight', description: 'Run the full preflight check for your profile.' },
  { id: 'publish', label: 'Publish', description: 'Choose visibility and submit or publish.' },
] as const;

export const publishingService = {
  steps: PUBLISHING_STEPS,
  submissionFor(bookId: ID): PublishingSubmission | undefined {
    return submissionRepo.forBook(bookId);
  },
  submissionsForAuthor(authorId: ID): PublishingSubmission[] {
    return submissionRepo.byAuthor(authorId);
  },
  allSubmissions(): PublishingSubmission[] {
    return submissionRepo.all();
  },
  checklist(bookId: ID): { id: string; label: string; done: boolean; detail: string }[] {
    const book = bookRepo.find(bookId);
    if (!book) return [];
    const hasToc = book.pages.some((page) => page.title === 'Table of Contents' && page.content.includes('toc-list'));
    const chapters = book.sections.filter((section) => section.kind === 'chapter');
    const chaptersWithContent = chapters.filter((section) => section.wordCount > 60);
    return [
      { id: 'c1', label: 'Book information complete', done: Boolean(book.title && book.authorName && book.language), detail: book.title ? `${book.title} · ${book.language.toUpperCase()}` : 'Add a title and author name.' },
      { id: 'c2', label: 'Content finished and spellchecked', done: book.wordCount > 400 && chaptersWithContent.length === chapters.length, detail: `${book.wordCount.toLocaleString()} words across ${chapters.length} chapters.` },
      { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: Boolean(book.cover.imageUrl), detail: book.cover.imageUrl ? 'Cover artwork present.' : 'Generate or upload cover art.' },
      { id: 'c4', label: 'Metadata, categories and keywords set', done: book.metadata.keywords.length >= 5 && book.categoryIds.length > 0, detail: `${book.categoryIds.length} categories · ${book.metadata.keywords.length} keywords.` },
      { id: 'c5', label: 'Table of contents generated', done: hasToc, detail: hasToc ? 'TOC generated from chapter structure.' : 'Generate the TOC from Book Structure.' },
      { id: 'c6', label: 'Pricing set and refund policy accepted', done: book.marketplace.price >= 0 && book.status !== 'draft', detail: book.marketplace.price === 0 ? 'Free book' : `Listed at $${book.marketplace.price.toFixed(2)}` },
    ];
  },
  completion(bookId: ID) {
    const checklist = publishingService.checklist(bookId);
    const done = checklist.filter((item) => item.done).length;
    return { done, total: checklist.length, percent: Math.round((done / checklist.length) * 100), checklist };
  },
  async saveDraft(bookId: ID, patch: Partial<PublishingSubmission>): Promise<PublishingSubmission> {
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('Book not found.');
    const existing = submissionRepo.forBook(bookId);
    const submission: PublishingSubmission = {
      id: existing?.id ?? uid('sub'),
      bookId,
      bookTitle: book.title,
      authorId: book.ownerId,
      authorName: book.authorName,
      visibility: (patch.visibility ?? existing?.visibility ?? book.visibility) as Book['visibility'],
      status: patch.status ?? existing?.status ?? 'draft',
      price: patch.price ?? existing?.price ?? book.marketplace.price,
      currency: 'USD',
      submittedAt: patch.submittedAt ?? existing?.submittedAt,
      reviewedAt: patch.reviewedAt ?? existing?.reviewedAt,
      publishedAt: patch.publishedAt ?? existing?.publishedAt,
      reviewerNote: patch.reviewerNote ?? existing?.reviewerNote,
      reviewerId: patch.reviewerId ?? existing?.reviewerId,
      checklist: (patch.checklist ?? existing?.checklist ?? publishingService.checklist(bookId).map((item) => ({ id: item.id, label: item.label, done: item.done }))),
    };
    return submissionRepo.upsert(submission);
  },
  async submit(bookId: ID, visibility: Book['visibility'], price: number, actorId = 'user_demo'): Promise<{ submission: PublishingSubmission; report: Awaited<ReturnType<typeof preflightService.run>> }> {
    await delay(700);
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('Book not found.');
    const settings = getDatabase().adminSettings;
    const report = await preflightService.run(bookId, settings.publishing.defaultProfile);
    const marketplaceRequested = visibility === 'marketplace';

    if (settings.publishing.requirePreflight && report.errors > 0 && marketplaceRequested) {
      throw new Error(`Preflight found ${report.errors} error${report.errors > 1 ? 's' : ''}. Fix them before submitting to the marketplace.`);
    }

    const autoApprove = settings.marketplace.autoApprove || !marketplaceRequested;
    const submission = await publishingService.saveDraft(bookId, {
      visibility,
      status: autoApprove ? 'published' : 'submitted',
      price,
      submittedAt: new Date().toISOString(),
      reviewedAt: autoApprove ? new Date().toISOString() : undefined,
      publishedAt: autoApprove ? new Date().toISOString() : undefined,
      checklist: publishingService.checklist(bookId).map((item) => ({ id: item.id, label: item.label, done: item.done })),
    });

    if (autoApprove) {
      bookRepo.update(bookId, {
        visibility,
        status: visibility === 'marketplace' || visibility === 'public' ? 'published' : 'ready',
        publishedAt: new Date().toISOString(),
        marketplace: { ...book.marketplace, listed: visibility === 'marketplace', price, submittedAt: new Date().toISOString(), approvedAt: new Date().toISOString() },
      });
      await emailService.send({ to: userRepo.find(book.ownerId)?.email ?? 'demo@scriptora.app', toName: book.authorName, template: 'book-published', meta: book.title });
      notificationRepo.add({
        id: uid('notif'),
        userId: actorId,
        type: 'publishing',
        title: `${book.title} is published`,
        body: visibility === 'marketplace' ? 'Your book is now listed in the marketplace.' : `Visibility set to ${visibility}.`,
        read: false,
        createdAt: new Date().toISOString(),
        link: visibility === 'marketplace' ? `/marketplace/${book.id}` : `/dashboard/books/${book.id}`,
        priority: 'high',
      });
    } else {
      notificationRepo.add({
        id: uid('notif'),
        userId: actorId,
        type: 'publishing',
        title: 'Submission received',
        body: `${book.title} is in the moderation queue. Reviews usually complete within one business day.`,
        read: false,
        createdAt: new Date().toISOString(),
        link: '/dashboard/publishing',
        priority: 'normal',
      });
    }

    activityRepo.add({
      id: uid('act'),
      userId: actorId,
      type: 'publish',
      message: autoApprove ? `Published ${book.title}` : `Submitted ${book.title} for review`,
      meta: `Visibility: ${visibility}`,
      createdAt: new Date().toISOString(),
      link: '/dashboard/publishing',
    });
    adminRepo.addAuditLog({
      adminId: actorId,
      adminName: book.authorName,
      action: autoApprove ? 'book.published' : 'book.submitted',
      target: book.title,
      targetType: 'book',
      before: `status: ${book.status}`,
      after: `status: ${autoApprove ? 'published' : 'submitted'}`,
      ip: '127.0.0.1',
      createdAt: new Date().toISOString(),
    });
    return { submission, report };
  },
  async unpublish(bookId: ID): Promise<Book | undefined> {
    await delay(400);
    const book = bookRepo.find(bookId);
    if (!book) return undefined;
    const updated = bookRepo.update(bookId, {
      status: 'ready',
      visibility: 'private',
      marketplace: { ...book.marketplace, listed: false },
    });
    const submission = submissionRepo.forBook(bookId);
    if (submission) submissionRepo.update(submission.id, { status: 'unpublished', visibility: 'private' });
    return updated;
  },
  /** Admin moderation actions. */
  async approve(submissionId: ID, reviewerId = 'user_admin', note?: string) {
    await delay(400);
    const submission = submissionRepo.update(submissionId, {
      status: 'published',
      reviewedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      reviewerId,
      reviewerNote: note ?? 'Approved.',
    });
    if (!submission) return undefined;
    const book = bookRepo.find(submission.bookId);
    if (book) {
      bookRepo.update(book.id, {
        status: 'published',
        visibility: 'marketplace',
        publishedAt: new Date().toISOString(),
        marketplace: { ...book.marketplace, listed: true, submittedAt: book.marketplace.submittedAt ?? new Date().toISOString(), approvedAt: new Date().toISOString() },
      });
      notificationRepo.add({
        id: uid('notif'),
        userId: book.ownerId,
        type: 'publishing',
        title: `${book.title} approved`,
        body: 'Your book is live in the marketplace and indexed for search.',
        read: false,
        createdAt: new Date().toISOString(),
        link: `/marketplace/${book.id}`,
        priority: 'high',
      });
      const author = userRepo.find(book.ownerId);
      if (author) await emailService.send({ to: author.email, toName: author.name, template: 'book-published', meta: book.title });
    }
    return submission;
  },
  async reject(submissionId: ID, reviewerId = 'user_admin', note = 'Does not meet marketplace guidelines.') {
    await delay(400);
    const submission = submissionRepo.update(submissionId, {
      status: 'returned',
      reviewedAt: new Date().toISOString(),
      reviewerId,
      reviewerNote: note,
    });
    if (submission) {
      const book = bookRepo.find(submission.bookId);
      if (book) {
        notificationRepo.add({
          id: uid('notif'),
          userId: book.ownerId,
          type: 'publishing',
          title: `${book.title} needs changes`,
          body: note,
          read: false,
          createdAt: new Date().toISOString(),
          link: `/dashboard/publishing/${book.id}`,
          priority: 'high',
        });
      }
    }
    return submission;
  },
  async publishDirect(bookId: ID, visibility: Book['visibility'], price: number) {
    await delay(500);
    return publishingService.submit(bookId, visibility, price);
  },
  recentEmails() {
    return emailRepo.all().slice(0, 12);
  },
};
