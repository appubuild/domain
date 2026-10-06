import type { ExportFormat, ExportJob, ID, PublishingProfileId } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { bookRepo, exportRepo, notificationRepo, activityRepo } from '@/repositories';
import { getDatabase } from '@/store/db';
import { defaultExportOptions, renderExport, slugifyFileName, type ExportOptions } from '@/lib/exporters';
import { EXPORT_FORMAT_INFO, PUBLISHING_PROFILES } from '@/data/constants';
import { preflightService } from './preflightService';
import { storageService } from './storageService';
import { emailService } from './notificationService';

export interface ExportProgress {
  step: string;
  progress: number;
  log: string[];
}

export const exportService = {
  formats() {
    return Object.entries(EXPORT_FORMAT_INFO).map(([id, info]) => ({ id: id as ExportFormat, ...info }));
  },
  profiles() {
    return PUBLISHING_PROFILES;
  },
  profile(id: PublishingProfileId) {
    return preflightService.profile(id);
  },
  history(userId?: ID, bookId?: ID): ExportJob[] {
    return exportRepo.all(userId, bookId);
  },
  find(id: ID) {
    return exportRepo.find(id);
  },
  optionsFor(bookId: ID, profileId: PublishingProfileId, overrides: Partial<ExportOptions> = {}): ExportOptions {
    const book = bookRepo.find(bookId);
    const profile = preflightService.profile(profileId);
    const print = profile.family === 'print';
    return {
      ...defaultExportOptions,
      includeToc: book?.toc.enabled ?? true,
      includeCover: profile.family !== 'print',
      cropMarks: print ? profile.id !== 'paperback' : false,
      highResImages: profile.requirements.minDpi >= 300,
      embedFonts: profile.requirements.fontEmbedding,
      profileId,
      ...overrides,
    };
  },
  /** Queues an export job, runs the render and resolves with the finished job. */
  async run(
    bookId: ID,
    format: ExportFormat,
    profileId: PublishingProfileId,
    options: Partial<ExportOptions>,
    onProgress?: (event: ExportProgress) => void,
    userId = 'user_demo',
  ): Promise<ExportJob> {
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('That book could not be found.');
    const profile = preflightService.profile(profileId);
    const resolved = exportService.optionsFor(bookId, profileId, options);

    const steps = [
      'Validating publishing profile',
      'Resolving typography and margins',
      'Composing pages',
      printProfileSteps(profile.family === 'print', format),
      'Writing output file',
      'Storing in object storage',
    ].flat().filter(Boolean) as string[];

    const log: string[] = [];
    const job: ExportJob = {
      id: uid('exp'),
      bookId,
      bookTitle: book.title,
      userId,
      format,
      profileId,
      status: 'processing',
      progress: 2,
      fileName: `${slugifyFileName(book.title)}.${format === 'epub3' ? 'epub' : format === 'print-pdf' ? 'pdf' : format}`,
      fileSizeBytes: 0,
      pages: book.pageCount,
      createdAt: new Date().toISOString(),
      storageKey: `users/${userId}/exports/${slugifyFileName(book.title)}-${format}`,
      step: steps[0],
      options: {
        includeToc: resolved.includeToc,
        includeCover: resolved.includeCover,
        highResImages: resolved.highResImages,
        embedFonts: resolved.embedFonts,
        cropMarks: resolved.cropMarks,
      },
    };
    exportRepo.create(job);

    try {
      for (let index = 0; index < steps.length; index += 1) {
        const progress = Math.round(((index + 1) / (steps.length + 1)) * 90);
        job.progress = progress;
        job.step = steps[index];
        log.push(`${new Date().toLocaleTimeString()} · ${steps[index]}`);
        onProgress?.({ step: steps[index], progress, log: [...log] });
        await delay(260 + Math.random() * 240);
      }

      const rendered = renderExport(book, format, resolved);
      log.push(`${new Date().toLocaleTimeString()} · Rendered ${rendered.pages} pages (${(rendered.sizeBytes / 1024).toFixed(0)} KB)`);

      const finished: ExportJob = {
        ...job,
        status: 'completed',
        progress: 100,
        fileName: rendered.fileName,
        fileSizeBytes: rendered.sizeBytes,
        pages: rendered.pages,
        completedAt: new Date().toISOString(),
        step: 'Completed',
      };
      exportRepo.update(job.id, finished);
      storageService.describeObject({
        ownerId: userId,
        key: job.storageKey,
        bucket: storageService.buckets.exports,
        kind: 'export',
        sizeBytes: rendered.sizeBytes,
        mimeType: rendered.mimeType,
        label: rendered.fileName,
      });
      activityRepo.add({
        id: uid('act'),
        userId,
        type: 'export',
        message: `${EXPORT_FORMAT_INFO[format]?.label ?? format} export completed`,
        meta: `${book.title} · ${rendered.pages} pages`,
        createdAt: new Date().toISOString(),
        link: '/dashboard/exports',
      });
      notificationRepo.add({
        id: uid('notif'),
        userId,
        type: 'export',
        title: `${EXPORT_FORMAT_INFO[format]?.label ?? format} export completed`,
        body: `${book.title} — ${rendered.pages} pages, ${(rendered.sizeBytes / 1024 / 1024).toFixed(1)} MB.`,
        read: false,
        createdAt: new Date().toISOString(),
        link: '/dashboard/exports',
        priority: 'low',
      });
      const user = getDatabase().users.find((entry) => entry.id === userId);
      if (user) {
        await emailService.send({ to: user.email, toName: user.name, template: 'export-completed', meta: rendered.fileName });
      }
      onProgress?.({ step: 'Completed', progress: 100, log });
      return finished;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The export could not be completed.';
      const failed = exportRepo.update(job.id, { status: 'failed', error: message, step: 'Failed' });
      onProgress?.({ step: 'Failed', progress: job.progress, log: [...log, message] });
      return failed ?? job;
    }
  },
  /** Re-renders the file for download (blobs are never persisted in local storage). */
  buildBlob(bookId: ID, format: ExportFormat, options: Partial<ExportOptions>) {
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('Book not found.');
    const resolved = exportService.optionsFor(bookId, options.profileId ?? 'digital-pdf', options);
    return renderExport(book, format, resolved);
  },
  download(bookId: ID, format: ExportFormat, options: Partial<ExportOptions>) {
    const result = exportService.buildBlob(bookId, format, options);
    storageService.download({ blob: result.blob, fileName: result.fileName });
    return result;
  },
  remove(id: ID) {
    exportRepo.remove(id);
  },
  estimateSize(bookId: ID, format: ExportFormat, profileId: PublishingProfileId) {
    const book = bookRepo.find(bookId);
    if (!book) return 0;
    const base = book.wordCount * 6;
    const multiplier =
      format === 'pdf' || format === 'print-pdf' ? 4.5 : format === 'epub' || format === 'epub3' ? 1.6 : format === 'docx' ? 3.2 : 1;
    const images = book.pages.reduce((total, page) => total + page.elements.filter((element) => element.type === 'image').length, 0);
    const dpiFactor = preflightService.profile(profileId).requirements.minDpi >= 300 ? 1.8 : 1;
    return Math.round(base * multiplier + images * 1_400_000 * dpiFactor);
  },
};

function printProfileSteps(isPrint: boolean, format: ExportFormat) {
  const steps: string[] = [];
  if (isPrint) steps.push('Placing crop marks and bleed');
  if (format === 'print-pdf') steps.push('Calculating spine and mirror margins');
  return steps;
}
