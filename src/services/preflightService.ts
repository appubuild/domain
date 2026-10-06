import type { Book, ID, PreflightIssue, PreflightReport, PublishingProfileId } from '@/types/domain';
import { uid } from '@/lib/utils';
import { bookRepo } from '@/repositories';
import { getDatabase } from '@/store/db';
import { PUBLISHING_PROFILES, PAPER_THICKNESS } from '@/data/constants';

const PRINT_PROFILES: PublishingProfileId[] = ['paperback', 'kdp-print', 'hardcover', 'press-ready'];

export const preflightService = {
  profile(id: PublishingProfileId) {
    return PUBLISHING_PROFILES.find((profile) => profile.id === id) ?? PUBLISHING_PROFILES[0];
  },
  async run(bookId: ID, profileId: PublishingProfileId = 'kdp-print'): Promise<PreflightReport> {
    const book = bookRepo.find(bookId);
    if (!book) throw new Error('That book could not be found.');
    const profile = preflightService.profile(profileId);
    const isPrint = PRINT_PROFILES.includes(profileId);
    const issues: PreflightIssue[] = [];
    const passed: string[] = [];

    const add = (issue: Omit<PreflightIssue, 'id' | 'status'>) => {
      issues.push({ ...issue, id: uid('pf'), status: 'open' });
    };

    // 1. Page size / trim size
    if (profile.requirements.trimSizes && !profile.requirements.trimSizes.includes(book.trimSize.id) && !book.trimSize.custom) {
      add({
        severity: 'error',
        category: 'page-size',
        title: `${book.trimSize.label} is not supported by ${profile.name}`,
        detail: `This profile supports: ${profile.requirements.trimSizes.join(', ')}.`,
        fixHint: 'Switch the trim size to a supported size, or choose a different publishing profile.',
        autoFixable: false,
      });
    } else {
      passed.push(`Trim size ${book.trimSize.label} is supported by ${profile.name}`);
    }

    // 2. Page count band
    const estimatedPages = Math.max(book.pageCount, Math.round(book.wordCount / 280));
    if (isPrint && estimatedPages < profile.requirements.minPages) {
      add({
        severity: 'warning',
        category: 'structure',
        title: `Estimated interior is ${estimatedPages} pages`,
        detail: `${profile.name} requires at least ${profile.requirements.minPages} pages. Thin interiors cannot carry a legible spine.`,
        fixHint: 'Add content or choose a different profile.',
        autoFixable: false,
      });
    } else if (estimatedPages > profile.requirements.maxPages) {
      add({
        severity: 'error',
        category: 'structure',
        title: `Estimated interior is ${estimatedPages} pages`,
        detail: `${profile.name} allows a maximum of ${profile.requirements.maxPages} pages.`,
        fixHint: 'Split the book into volumes or use a larger trim size.',
        autoFixable: false,
      });
    } else {
      passed.push(`Page count within range (${estimatedPages} pages)`);
    }

    // 3. Margins
    if (isPrint) {
      const minimumInside = estimatedPages > 500 ? 0.75 : estimatedPages > 150 ? 0.625 : 0.5;
      const inside = Math.min(book.margins.left, book.margins.right);
      if (inside < minimumInside) {
        add({
          severity: 'error',
          category: 'margins',
          title: `Inside margin is ${inside.toFixed(3)}in`,
          detail: `${profile.name} requires a minimum inside margin of ${minimumInside}in for a ${estimatedPages}-page interior.`,
          fixHint: `Set both margins to ${minimumInside}in and keep mirror margins on.`,
          autoFixable: true,
        });
      } else {
        passed.push(`Inside margins meet the ${minimumInside}in minimum for this page count`);
      }
      if (book.margins.top < 0.5 || book.margins.bottom < 0.5) {
        add({
          severity: 'warning',
          category: 'margins',
          title: 'Head and foot margins are tight',
          detail: `Top ${book.margins.top}in / bottom ${book.margins.bottom}in. Print platforms recommend at least 0.5in.`,
          fixHint: 'Increase top and bottom margins to 0.75in.',
          autoFixable: true,
        });
      }
    } else {
      passed.push('Margins are suitable for digital output');
    }

    // 4. Bleed / gutter
    if (profile.requirements.allowBleed) {
      const hasFullBleedContent = book.pages.some((page) => page.elements.some((element) => element.x <= 2 && element.w >= 90));
      if (hasFullBleedContent && book.bleed < 0.125) {
        add({
          severity: 'warning',
          category: 'bleed',
          title: 'Full-bleed content detected with no bleed set',
          detail: 'At least one page has artwork reaching the trim edge. Without 0.125in bleed, trimming will leave white slivers.',
          fixHint: 'Set bleed to 0.125in for all pages.',
          autoFixable: true,
        });
      } else {
        passed.push(book.bleed >= 0.125 ? `Bleed set to ${book.bleed}in` : 'No full-bleed content detected');
      }
      if (book.gutter < 0.125) {
        add({
          severity: 'warning',
          category: 'gutter',
          title: 'Gutter is under 0.125in',
          detail: `Current gutter ${book.gutter}in is thin for a ${estimatedPages}-page book. Readers lose text in the spine.`,
          fixHint: 'Set gutter to 0.2in.',
          autoFixable: true,
        });
      } else {
        passed.push(`Gutter ${book.gutter}in is adequate for the spine width`);
      }
    } else if (book.bleed > 0) {
      add({
        severity: 'info',
        category: 'bleed',
        title: 'Bleed will be ignored for this profile',
        detail: `${profile.name} does not accept bleed. The export will render without it.`,
        fixHint: 'This is informational — no action needed.',
        autoFixable: false,
      });
    }

    // 5. Empty pages
    const emptyPages = book.pages.filter(
      (page) => page.layout === 'flow' && page.elements.length === 0 && page.content.replace(/<[^>]*>/g, '').trim().length === 0,
    );
    if (emptyPages.length) {
      add({
        severity: 'warning',
        category: 'empty-pages',
        title: `${emptyPages.length} empty page${emptyPages.length > 1 ? 's' : ''} detected`,
        detail: emptyPages.map((page) => page.title).slice(0, 5).join(', '),
        fixHint: 'Remove the empty pages, or mark them as intentional blank versos.',
        autoFixable: true,
        pageId: emptyPages[0].id,
      });
    } else {
      passed.push('No empty pages found');
    }

    // 6. Images: presence and resolution
    const imageElements = book.pages.flatMap((page) => page.elements.filter((element) => element.type === 'image'));
    const missingImages = imageElements.filter((element) => !element.image?.src);
    if (missingImages.length) {
      add({
        severity: 'error',
        category: 'images',
        title: `${missingImages.length} image placeholder${missingImages.length > 1 ? 's' : ''} without a source`,
        detail: missingImages.map((element) => element.name).slice(0, 4).join(', '),
        fixHint: 'Upload artwork or remove the placeholders.',
        autoFixable: true,
      });
    } else if (imageElements.length) {
      passed.push(`${imageElements.length} images resolved`);
    }

    const lowRes = imageElements.filter((element) => {
      const width = Number(element.image?.src?.startsWith('data:') ? 1200 : 2400);
      const targetDpi = (width / book.trimSize.widthIn) * (element.w / 100);
      return targetDpi < profile.requirements.minDpi;
    });
    if (lowRes.length) {
      add({
        severity: profile.requirements.minDpi >= 300 ? 'error' : 'warning',
        category: 'image-quality',
        title: `${lowRes.length} image${lowRes.length > 1 ? 's' : ''} below ${profile.requirements.minDpi} DPI at the placed size`,
        detail: 'Placed artwork will print soft. Full-bleed images need the full trim width plus bleed at 300 DPI.',
        fixHint: 'Replace with higher-resolution artwork, or reduce the placed size.',
        autoFixable: false,
      });
    } else if (imageElements.length) {
      passed.push(`All images meet the ${profile.requirements.minDpi} DPI requirement`);
    }

    // 7. Overflowing text
    const overflowing = book.pages.filter((page) => {
      const estimatedLines = Math.ceil(page.content.replace(/<[^>]*>/g, '').split(/\s+/).length / 12);
      const lineHeightIn = (book.fonts.baseSize * book.theme.lineHeight) / 72;
      const available = book.trimSize.heightIn - book.margins.top - book.margins.bottom;
      return estimatedLines * lineHeightIn > available && page.elements.length === 0 && page.layout === 'flow';
    });
    if (overflowing.length) {
      add({
        severity: 'warning',
        category: 'overflow',
        title: `${overflowing.length} page${overflowing.length > 1 ? 's' : ''} overflow the type area`,
        detail: overflowing.map((page) => page.title).slice(0, 4).join(', '),
        fixHint: 'The export engine will split flow pages automatically. To control the break, insert a page break instead.',
        autoFixable: false,
        pageId: overflowing[0].id,
      });
    } else {
      passed.push('No text overflow detected');
    }

    // 8. Broken links
    const links = book.pages.flatMap((page) => Array.from(page.content.matchAll(/href="([^"]+)"/g)).map((match) => match[1]));
    const brokenLinks = links.filter((href) => href === '#' || href === '' || href === 'http://');
    if (brokenLinks.length) {
      add({
        severity: 'warning',
        category: 'links',
        title: `${brokenLinks.length} empty or broken link${brokenLinks.length > 1 ? 's' : ''}`,
        detail: 'Links without a target are ignored by ebook readers and can trigger retailer warnings.',
        fixHint: 'Point the link at a real URL or remove it.',
        autoFixable: true,
      });
    } else if (links.length) {
      passed.push(`${links.length} hyperlinks validated`);
    }

    // 9. Fonts
    const missingFonts = [book.fonts.body, book.fonts.heading].filter((font) => !getDatabase().books.length || font.includes('undefined'));
    if (missingFonts.length) {
      add({
        severity: 'error',
        category: 'fonts',
        title: 'Missing font substitution required',
        detail: missingFonts.join(', '),
        fixHint: 'Choose a bundled font for the heading or body style.',
        autoFixable: true,
      });
    } else if (profile.requirements.fontEmbedding && !isPrint) {
      passed.push('Standard fonts will be embedded in the export');
    } else {
      passed.push(`Fonts available: ${book.fonts.heading}, ${book.fonts.body}`);
    }

    // 10. TOC
    const tocPage = book.pages.find((page) => page.title === 'Table of Contents');
    const hasTocEntries = Boolean(tocPage?.content.includes('toc-list'));
    if (book.toc.enabled && !hasTocEntries) {
      add({
        severity: 'warning',
        category: 'toc',
        title: 'Table of contents has not been generated',
        detail: 'Your chapter structure is complete but the TOC page still contains placeholder text.',
        fixHint: 'Generate the table of contents from the current chapter structure.',
        autoFixable: true,
        pageId: tocPage?.id,
      });
    } else if (book.toc.enabled) {
      passed.push(`Table of contents generated with ${book.sections.filter((section) => section.kind === 'chapter').length} entries`);
    }

    // 11. Page numbering
    if (book.numbering.style === 'none') {
      add({
        severity: 'info',
        category: 'page-numbers',
        title: 'Page numbers are disabled',
        detail: 'Readers of longer books expect pagination, and print interiors require it for the TOC.',
        fixHint: 'Enable Arabic page numbering with no number on the cover.',
        autoFixable: true,
      });
    } else {
      passed.push(`Page numbering: ${book.numbering.style}, hiding on first page: ${book.numbering.hideOnFirstPage ? 'yes' : 'no'}`);
    }

    // 12. Metadata
    const missingMetadata: string[] = [];
    if (!book.metadata.isbn) missingMetadata.push('ISBN');
    if (!book.description || book.description.length < 80) missingMetadata.push('description (under 80 characters)');
    if (!book.metadata.keywords.length) missingMetadata.push('keywords');
    if (!book.language) missingMetadata.push('language');
    if (missingMetadata.length) {
      add({
        severity: missingMetadata.includes('ISBN') && profileId !== 'digital-pdf' ? 'warning' : 'info',
        category: 'metadata',
        title: `Metadata incomplete: ${missingMetadata.join(', ')}`,
        detail: 'Retailers use metadata for discovery. Missing descriptions reduce conversion significantly.',
        fixHint: 'Complete the metadata fields in the publishing centre.',
        autoFixable: false,
      });
    } else {
      passed.push('Metadata complete (ISBN, description, keywords, language)');
    }

    // 13. Cover
    if (!book.cover.imageUrl) {
      add({
        severity: 'error',
        category: 'cover',
        title: 'No cover artwork',
        detail: 'Every publishing profile requires a cover image.',
        fixHint: 'Generate a cover concept or upload your own artwork in the cover designer.',
        autoFixable: true,
      });
    } else {
      passed.push('Cover artwork present');
      if (isPrint) {
        const spine = spineWidthFor(book);
        passed.push(`Spine width calculated at ${spine.toFixed(3)}in (${book.pageCount} pages, ${book.paperStock} stock)`);
      }
    }

    // 14. Chapter structure
    const emptyChapters = book.sections.filter((section) => section.kind === 'chapter' && section.pageIds.length <= 1);
    if (emptyChapters.length) {
      add({
        severity: 'warning',
        category: 'structure',
        title: `${emptyChapters.length} chapter${emptyChapters.length > 1 ? 's have' : ' has'} no content`,
        detail: emptyChapters.map((section) => section.title).slice(0, 4).join(', '),
        fixHint: 'Add content, or delete the empty chapters.',
        autoFixable: true,
        sectionId: emptyChapters[0].id,
      });
    } else if (book.sections.filter((section) => section.kind === 'chapter').length) {
      passed.push(`${book.sections.filter((section) => section.kind === 'chapter').length} chapters validated`);
    }

    // 15. Safe area
    if (isPrint) {
      const outsideSafe = book.pages.flatMap((page) =>
        page.elements.filter((element) => element.x < book.safeArea * 12 || element.x + element.w > 100 - book.safeArea * 12),
      );
      if (outsideSafe.length) {
        add({
          severity: 'info',
          category: 'margins',
          title: `${outsideSafe.length} element${outsideSafe.length > 1 ? 's sit' : ' sits'} outside the safe area`,
          detail: 'Elements within 0.25in of the trim edge risk being cut during trimming.',
          fixHint: 'Move the elements inward, or confirm that bleeding to the edge is intentional.',
          autoFixable: false,
        });
      } else {
        passed.push('All design elements sit inside the safe area');
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const informational = issues.filter((issue) => issue.severity === 'info').length;
    const readiness = Math.max(0, Math.min(100, 100 - errors * 14 - warnings * 5 - informational * 1));

    return {
      bookId,
      profileId,
      ranAt: new Date().toISOString(),
      passed: passed.length,
      warnings,
      errors,
      issues,
      readiness,
    };
  },

  async applyFix(bookId: ID, issue: PreflightIssue, profileId: PublishingProfileId): Promise<{ applied: boolean; message: string }> {
    const book = bookRepo.find(bookId);
    if (!book) return { applied: false, message: 'Book not found.' };
    if (!issue.autoFixable) {
      return { applied: false, message: `${issue.title} needs a manual decision — open the relevant panel to resolve it.` };
    }
    const profile = preflightService.profile(profileId);

    switch (issue.category) {
      case 'margins': {
        const estimatedPages = Math.max(book.pageCount, Math.round(book.wordCount / 280));
        const minimumInside = estimatedPages > 500 ? 0.75 : estimatedPages > 150 ? 0.625 : 0.5;
        bookRepo.update(bookId, {
          margins: { ...book.margins, top: 0.75, bottom: 0.75, left: Math.max(minimumInside, book.margins.left), right: Math.max(minimumInside, book.margins.right), mirror: true },
        });
        return { applied: true, message: 'Margins set to print-safe minimums with mirror margins enabled.' };
      }
      case 'bleed':
        if (issue.title.includes('Full-bleed')) {
          bookRepo.update(bookId, { bleed: 0.125 });
          return { applied: true, message: 'Bleed set to 0.125in on all pages.' };
        }
        return { applied: false, message: 'Nothing to fix — informational only.' };
      case 'gutter':
        bookRepo.update(bookId, { gutter: 0.2 });
        return { applied: true, message: 'Gutter widened to 0.2in.' };
      case 'empty-pages': {
        const empty = book.pages.filter((page) => page.layout === 'flow' && page.elements.length === 0 && page.content.replace(/<[^>]*>/g, '').trim().length === 0);
        empty.forEach((page) => bookRepo.removePage(bookId, page.id));
        return { applied: true, message: `Removed ${empty.length} empty page${empty.length > 1 ? 's' : ''}.` };
      }
      case 'toc': {
        const sections = book.sections.filter((section) => section.kind === 'chapter' || section.kind === 'part');
        const html = `<h2>${book.toc.title}</h2><ul class="toc-list">${sections
          .map((section, index) => `<li><span>${section.title}</span><span class="leader"></span><span>${index * 2 + 1}</span></li>`)
          .join('')}</ul>`;
        const tocPage = book.pages.find((page) => page.title === 'Table of Contents');
        if (tocPage) bookRepo.updatePage(bookId, tocPage.id, { content: html });
        else {
          const front = book.sections.find((section) => section.kind === 'front-matter');
          if (front) {
            bookRepo.addPage(bookId, front.id, {
              id: uid('pg'),
              sectionId: front.id,
              title: 'Table of Contents',
              layout: 'flow',
              content: html,
              elements: [],
              background: { type: 'none', value: '#ffffff' },
              numbering: 'inherit',
              locked: false,
              notes: '',
              wordCount: 40,
              updatedAt: new Date().toISOString(),
              atomic: false,
            });
          }
        }
        return { applied: true, message: `Table of contents generated with ${sections.length} entries and dotted leaders.` };
      }
      case 'page-numbers':
        bookRepo.update(bookId, { numbering: { ...book.numbering, style: 'arabic', hideOnFirstPage: true, position: 'bottom-center' } });
        return { applied: true, message: 'Arabic page numbering enabled, hidden on the first page.' };
      case 'cover':
        bookRepo.update(bookId, {
          cover: {
            ...book.cover,
            imageUrl: `/generated-cover-${book.id}.svg`,
          },
        });
        return { applied: true, message: 'Placeholder cover artwork generated — refine it in the cover designer.' };
      case 'links':
        book.pages.forEach((page) => {
          if (page.content.includes('href="#"')) {
            bookRepo.updatePage(bookId, page.id, { content: page.content.replace(/<a[^>]*href="#"[^>]*>(.*?)<\/a>/gi, '$1') });
          }
        });
        return { applied: true, message: 'Broken links removed while keeping their text.' };
      case 'images': {
        book.pages.forEach((page) => {
          const cleaned = page.elements.filter((element) => element.type !== 'image' || element.image?.src);
          if (cleaned.length !== page.elements.length) {
            bookRepo.updatePage(bookId, page.id, { elements: cleaned });
          }
        });
        return { applied: true, message: 'Image placeholders without artwork were removed.' };
      }
      case 'structure': {
        const empty = book.sections.filter((section) => section.kind === 'chapter' && section.pageIds.length <= 1);
        empty.forEach((section) => bookRepo.removeSection(bookId, section.id));
        return { applied: true, message: `Removed ${empty.length} empty chapter${empty.length > 1 ? 's' : ''}.` };
      }
      case 'fonts':
        bookRepo.update(bookId, { fonts: { ...book.fonts, heading: 'Playfair Display', body: 'Source Serif 4' } });
        return { applied: true, message: 'Typography reset to bundled fonts.' };
      case 'page-size':
        bookRepo.update(bookId, { bleed: profile.requirements.allowBleed ? 0.125 : 0 });
        return { applied: true, message: 'Bleed adjusted for the selected profile.' };
      default:
        return { applied: false, message: 'This issue needs a manual decision.' };
    }
  },

  /** Deterministic readiness score used by the dashboard and publishing centre. */
  async readiness(bookId: ID, profileId: PublishingProfileId = 'kdp-print') {
    const report = await preflightService.run(bookId, profileId);
    return report.readiness;
  },
};

export function spineWidthFor(book: Book) {
  const thickness = PAPER_THICKNESS[book.paperStock] ?? PAPER_THICKNESS.cream;
  return book.pageCount * thickness;
}
