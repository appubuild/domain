import type {
  AiUsageRecord,
  ActivityItem,
  AppNotification,
  BookViewEvent,
  Collaborator,
  Comment,
  EmailEvent,
  ExportJob,
  Invoice,
  MemoryEntry,
  NotificationType,
  PublishingSubmission,
  StorageObject,
  StorageUsage,
  Subscription,
} from '@/types/domain';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
const daysAgo = (days: number, hour = 10) => new Date(Date.now() - days * 86400000 + hour * 3600 * 1000).toISOString();

export const seedSubscription: Subscription = {
  id: 'sub_demo',
  userId: 'user_demo',
  planId: 'plan_pro',
  status: 'active',
  interval: 'yearly',
  startedAt: daysAgo(288),
  renewsAt: new Date(Date.now() + 77 * 86400000).toISOString(),
  seats: 1,
};

export const seedInvoices: Invoice[] = [
  { id: 'inv_1', userId: 'user_demo', subscriptionId: 'sub_demo', number: 'SC-2026-0184', planName: 'Pro (annual)', amount: 180, currency: 'USD', status: 'paid', interval: 'yearly', createdAt: daysAgo(288), periodStart: daysAgo(288), periodEnd: new Date(Date.now() + 77 * 86400000).toISOString(), method: 'Visa •••• 4242' },
  { id: 'inv_2', userId: 'user_demo', subscriptionId: 'sub_demo', number: 'SC-2025-0071', planName: 'Pro (annual)', amount: 180, currency: 'USD', status: 'paid', interval: 'yearly', createdAt: daysAgo(653), periodStart: daysAgo(653), periodEnd: daysAgo(288), method: 'Visa •••• 4242' },
  { id: 'inv_3', userId: 'user_demo', subscriptionId: 'sub_demo', number: 'SC-2024-3320', planName: 'Free', amount: 0, currency: 'USD', status: 'paid', interval: 'monthly', createdAt: daysAgo(681), periodStart: daysAgo(681), periodEnd: daysAgo(653), method: '—' },
  { id: 'inv_4', userId: 'user_harriet', subscriptionId: 'sub_harriet', number: 'SC-2026-0211', planName: 'Business (annual)', amount: 564, currency: 'USD', status: 'paid', interval: 'yearly', createdAt: daysAgo(140), periodStart: daysAgo(140), periodEnd: new Date(Date.now() + 225 * 86400000).toISOString(), method: 'Mastercard •••• 8811' },
  { id: 'inv_5', userId: 'user_theo', subscriptionId: 'sub_theo', number: 'SC-2026-0244', planName: 'Pro (monthly)', amount: 19, currency: 'USD', status: 'failed', interval: 'monthly', createdAt: daysAgo(6), periodStart: daysAgo(6), periodEnd: new Date(Date.now() + 24 * 86400000).toISOString(), method: 'Visa •••• 1102' },
  { id: 'inv_6', userId: 'user_gracet', subscriptionId: 'sub_grace', number: 'SC-2026-0198', planName: 'Pro (monthly)', amount: 19, currency: 'USD', status: 'paid', interval: 'monthly', createdAt: daysAgo(19), periodStart: daysAgo(19), periodEnd: new Date(Date.now() + 11 * 86400000).toISOString(), method: 'PayPal' },
];

const notifTemplates: { type: NotificationType; title: string; body: string; link?: string; priority: AppNotification['priority'] }[] = [
  { type: 'sale', title: 'New sale — Harbour of Small Lights', body: 'Yuki Tanaka purchased your book for $9.99. You earned $8.49 after commission.', link: '/dashboard/earnings', priority: 'normal' },
  { type: 'sale', title: 'New sale — The Keeper & The Ledger', body: 'Amara Okonkwo purchased the preorder for $4.99. You earned $4.24.', link: '/dashboard/earnings', priority: 'normal' },
  { type: 'review', title: 'New 5★ review on Harbour of Small Lights', body: '“Stayed with me for weeks. The fog chapters are extraordinary.”', link: '/marketplace/mbook_harbour', priority: 'normal' },
  { type: 'export', title: 'Print PDF export completed', body: 'Harbour of Small Lights — 284 pages, 6 × 9 in, 300 DPI images verified.', link: '/dashboard/exports', priority: 'low' },
  { type: 'export', title: 'EPUB 3 export completed', body: 'The Keeper & The Ledger is ready to upload to any ebook retailer.', link: '/dashboard/exports', priority: 'low' },
  { type: 'publishing', title: 'Your book passed preflight', body: 'The Keeper & The Ledger has 0 errors and 2 warnings. Ready to submit.', link: '/dashboard/books/book_keeper_ledger/preflight', priority: 'high' },
  { type: 'publishing', title: 'Marketplace submission approved', body: 'Harbour of Small Lights is live in the marketplace and indexed in Literary Fiction.', link: '/marketplace/mbook_harbour', priority: 'high' },
  { type: 'ai', title: 'AI chapter generation finished', body: 'Chapter 3 of The Cartographer’s Apprentice is ready for review in the editor.', link: '/dashboard/books/book_cartographers/editor', priority: 'normal' },
  { type: 'ai', title: 'Monthly AI credit usage at 27%', body: 'You have used 412 of 1,500 credits this period. Image credits: 38 of 150.', link: '/dashboard/subscription', priority: 'low' },
  { type: 'comment', title: 'New comment from Elena Vasquez', body: '“Chapter three lands better if you move the ledger reveal a page earlier.”', link: '/dashboard/books/mbook_harbour/editor', priority: 'normal' },
  { type: 'collaboration', title: 'Elena Vasquez joined as Editor', body: 'She now has edit access to Harbour of Small Lights.', link: '/dashboard/books/mbook_harbour/share', priority: 'normal' },
  { type: 'subscription', title: 'Your Pro plan renews in 77 days', body: 'Annual Pro renews at $180. Manage your plan any time from billing.', link: '/dashboard/subscription', priority: 'low' },
  { type: 'storage', title: 'Storage at 17% of your plan', body: '8.4 GB of 50 GB used across book files, images and exports.', link: '/dashboard/settings/storage', priority: 'low' },
  { type: 'system', title: 'New: AI cover generation', body: 'Generate cover concepts in three styles and refine them in the cover designer.', link: '/features#ai', priority: 'low' },
  { type: 'comment', title: 'Comment thread resolved', body: 'Daniel Osei resolved “check the harbour name spelling” on page 42.', link: '/dashboard/books/mbook_harbour/editor', priority: 'low' },
  { type: 'review', title: 'Review needs attention', body: 'A 2★ review was left on The Keeper & The Ledger. Consider responding.', link: '/dashboard/reviews', priority: 'normal' },
];

export const seedNotifications: AppNotification[] = notifTemplates.map((template, index) => ({
  id: `notif_${index + 1}`,
  userId: 'user_demo',
  type: template.type,
  title: template.title,
  body: template.body,
  read: index > 5,
  createdAt: hoursAgo(index * 7 + 2),
  link: template.link,
  priority: template.priority,
}));

export const seedEmailEvents: EmailEvent[] = [
  { id: 'email_1', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'welcome', subject: 'Welcome to Scriptora — your first book starts here', body: 'Your account is ready. Create your first project, or import a manuscript you have already started.', status: 'sent', createdAt: daysAgo(320, 9), opened: true },
  { id: 'email_2', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'book-published', subject: 'Harbour of Small Lights is live in the marketplace', body: 'Your book passed moderation and is now visible to readers. Share your author page to start earning.', status: 'sent', createdAt: daysAgo(214, 14), opened: true },
  { id: 'email_3', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'book-sale', subject: 'You made a sale — Harbour of Small Lights', body: 'Yuki Tanaka purchased your book. $8.49 has been added to your available balance.', status: 'sent', createdAt: hoursAgo(3), opened: false },
  { id: 'email_4', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'export-completed', subject: 'Your print PDF is ready', body: 'Harbour of Small Lights — 284 pages, 6 × 9 in. Download from the export centre.', status: 'sent', createdAt: hoursAgo(28), opened: true },
  { id: 'email_5', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'subscription', subject: 'Pro renews on ' + new Date(Date.now() + 77 * 86400000).toDateString(), body: 'Your annual Pro plan renews soon. No action needed unless you want to change plans.', status: 'queued', createdAt: hoursAgo(50), opened: false },
  { id: 'email_6', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'revenue', subject: 'Your January earnings summary', body: '$612.40 in sales, $91.86 in platform fees, $520.54 net. Full breakdown in your earnings dashboard.', status: 'sent', createdAt: daysAgo(9, 8), opened: true },
  { id: 'email_7', to: 'demo@scriptora.app', toName: 'Maya Chen', template: 'comment', subject: 'Elena Vasquez commented on Harbour of Small Lights', body: '“Chapter three lands better if you move the ledger reveal a page earlier.”', status: 'sent', createdAt: hoursAgo(20), opened: true },
  { id: 'email_8', to: 'theo@marchetti.co', toName: 'Theo Marchetti', template: 'subscription', subject: 'Payment failed for your Pro plan', body: 'We could not charge your card ending 1102. Update your payment method to keep print exports enabled.', status: 'failed', createdAt: daysAgo(6, 7), opened: false },
];

export const seedExports: ExportJob[] = [
  { id: 'exp_1', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', userId: 'user_demo', format: 'print-pdf', profileId: 'paperback', status: 'completed', progress: 100, fileName: 'harbour-of-small-lights-interior-6x9.pdf', fileSizeBytes: 18.4 * 1024 * 1024, pages: 284, createdAt: daysAgo(1, 14), completedAt: daysAgo(1, 14), storageKey: 'users/user_demo/exports/harbour-interior-6x9.pdf', step: 'Finished', options: { includeToc: true, includeCover: false, highResImages: true, embedFonts: true, cropMarks: false } },
  { id: 'exp_2', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', userId: 'user_demo', format: 'epub3', profileId: 'epub-reflowable', status: 'completed', progress: 100, fileName: 'harbour-of-small-lights.epub', fileSizeBytes: 3.1 * 1024 * 1024, pages: 284, createdAt: daysAgo(1, 14), completedAt: daysAgo(1, 14), storageKey: 'users/user_demo/exports/harbour.epub', step: 'Finished', options: { includeToc: true, includeCover: true, highResImages: false, embedFonts: false, cropMarks: false } },
  { id: 'exp_3', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', userId: 'user_demo', format: 'pdf', profileId: 'digital-pdf', status: 'completed', progress: 100, fileName: 'harbour-of-small-lights-digital.pdf', fileSizeBytes: 6.8 * 1024 * 1024, pages: 284, createdAt: daysAgo(6, 11), completedAt: daysAgo(6, 11), storageKey: 'users/user_demo/exports/harbour-digital.pdf', step: 'Finished', options: { includeToc: true, includeCover: true, highResImages: false, embedFonts: true, cropMarks: false } },
  { id: 'exp_4', bookId: 'book_keeper_ledger', bookTitle: 'The Keeper & The Ledger', userId: 'user_demo', format: 'docx', profileId: 'digital-pdf', status: 'completed', progress: 100, fileName: 'keeper-and-ledger-manuscript.docx', fileSizeBytes: 1.2 * 1024 * 1024, pages: 96, createdAt: daysAgo(4, 16), completedAt: daysAgo(4, 16), storageKey: 'users/user_demo/exports/keeper.docx', step: 'Finished', options: { includeToc: true, includeCover: false, highResImages: false, embedFonts: false, cropMarks: false } },
  { id: 'exp_5', bookId: 'book_keeper_ledger', bookTitle: 'The Keeper & The Ledger', userId: 'user_demo', format: 'print-pdf', profileId: 'kdp-print', status: 'failed', progress: 62, fileName: 'keeper-and-ledger-interior-5x8.pdf', fileSizeBytes: 0, pages: 96, createdAt: hoursAgo(30), storageKey: 'users/user_demo/exports/keeper-interior.pdf', step: 'Rendering page 58 of 96', error: 'Two images on page 58 are below 300 DPI for the selected print profile. Lower the DPI requirement or replace the images.', options: { includeToc: true, includeCover: false, highResImages: true, embedFonts: true, cropMarks: true } },
  { id: 'exp_6', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', userId: 'user_demo', format: 'html', profileId: 'digital-pdf', status: 'completed', progress: 100, fileName: 'harbour-of-small-lights.html', fileSizeBytes: 890 * 1024, pages: 284, createdAt: daysAgo(12, 9), completedAt: daysAgo(12, 9), storageKey: 'users/user_demo/exports/harbour.html', step: 'Finished', options: { includeToc: true, includeCover: true, highResImages: false, embedFonts: false, cropMarks: false } },
  { id: 'exp_7', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', userId: 'user_demo', format: 'txt', profileId: 'digital-pdf', status: 'completed', progress: 100, fileName: 'harbour-of-small-lights.txt', fileSizeBytes: 740 * 1024, pages: 284, createdAt: daysAgo(20, 13), completedAt: daysAgo(20, 13), storageKey: 'users/user_demo/exports/harbour.txt', step: 'Finished', options: { includeToc: false, includeCover: false, highResImages: false, embedFonts: false, cropMarks: false } },
];

export const seedSubmissions: PublishingSubmission[] = [
  {
    id: 'sub_1', bookId: 'mbook_harbour', bookTitle: 'Harbour of Small Lights', authorId: 'user_demo', authorName: 'Maya Chen',
    visibility: 'marketplace', status: 'published', price: 9.99, currency: 'USD',
    submittedAt: daysAgo(220, 10), reviewedAt: daysAgo(215, 15), publishedAt: daysAgo(214, 14),
    reviewerNote: 'Approved. Interior renders correctly at 5.5 × 8.5 in.',
    checklist: [
      { id: 'c1', label: 'Book information complete', done: true },
      { id: 'c2', label: 'Content finished and spellchecked', done: true },
      { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: true },
      { id: 'c4', label: 'Metadata, categories and keywords set', done: true },
      { id: 'c5', label: 'Pricing set and refund policy accepted', done: true },
      { id: 'c6', label: 'Preflight passed with no errors', done: true },
    ],
  },
  {
    id: 'sub_2', bookId: 'book_keeper_ledger', bookTitle: 'The Keeper & The Ledger', authorId: 'user_demo', authorName: 'Maya Chen',
    visibility: 'marketplace', status: 'ready', price: 4.99, currency: 'USD',
    checklist: [
      { id: 'c1', label: 'Book information complete', done: true },
      { id: 'c2', label: 'Content finished and spellchecked', done: true },
      { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: true },
      { id: 'c4', label: 'Metadata, categories and keywords set', done: true },
      { id: 'c5', label: 'Pricing set and refund policy accepted', done: false },
      { id: 'c6', label: 'Preflight passed with no errors', done: false },
    ],
  },
  {
    id: 'sub_3', bookId: 'mbook_fermentation', bookTitle: 'Fermentation for Impatient People', authorId: 'user_harriet', authorName: 'Harriet Lindqvist',
    visibility: 'marketplace', status: 'in_review', price: 13.99, currency: 'USD',
    submittedAt: daysAgo(2, 9),
    checklist: [
      { id: 'c1', label: 'Book information complete', done: true },
      { id: 'c2', label: 'Content finished and spellchecked', done: true },
      { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: true },
      { id: 'c4', label: 'Metadata, categories and keywords set', done: true },
      { id: 'c5', label: 'Pricing set and refund policy accepted', done: true },
      { id: 'c6', label: 'Preflight passed with no errors', done: true },
    ],
  },
  {
    id: 'sub_4', bookId: 'mbook_fourteen_ways', bookTitle: 'Fourteen Ways to Miss a Train', authorId: 'user_theo', authorName: 'Theo Marchetti',
    visibility: 'marketplace', status: 'returned', price: 7.99, currency: 'USD',
    submittedAt: daysAgo(9, 12), reviewedAt: daysAgo(8, 10), reviewerNote: 'Cover art resolution is below the marketplace minimum at this trim size. Please re-export at 1600 × 2560 and resubmit.',
    checklist: [
      { id: 'c1', label: 'Book information complete', done: true },
      { id: 'c2', label: 'Content finished and spellchecked', done: true },
      { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: false },
      { id: 'c4', label: 'Metadata, categories and keywords set', done: true },
      { id: 'c5', label: 'Pricing set and refund policy accepted', done: true },
      { id: 'c6', label: 'Preflight passed with no errors', done: true },
    ],
  },
];

export const seedSubmissionOrder: PublishingSubmission = {
  id: 'sub_5',
  bookId: 'mbook_quietcode',
  bookTitle: 'The Quiet Code',
  authorId: 'user_daniel',
  authorName: 'Daniel Osei',
  visibility: 'marketplace',
  status: 'approved',
  price: 24,
  currency: 'USD',
  submittedAt: daysAgo(151, 11),
  reviewedAt: daysAgo(151, 16),
  checklist: [
    { id: 'c1', label: 'Book information complete', done: true },
    { id: 'c2', label: 'Content finished and spellchecked', done: true },
    { id: 'c3', label: 'Cover uploaded at 1600 × 2560 minimum', done: true },
    { id: 'c4', label: 'Metadata, categories and keywords set', done: true },
    { id: 'c5', label: 'Pricing set and refund policy accepted', done: true },
    { id: 'c6', label: 'Preflight passed with no errors', done: true },
  ],
};

export const seedComments: Comment[] = [
  { id: 'cmt_1', bookId: 'mbook_harbour', pageId: '', sectionId: '', userId: 'user_elenav', userName: 'Elena Vasquez', userAvatar: '', body: 'Chapter three lands better if you move the ledger reveal a page earlier — the boy’s question currently arrives after the answer.', mentions: ['user_demo'], resolved: false, createdAt: hoursAgo(20), replies: [{ id: 'cmt_1_r1', userId: 'user_demo', userName: 'Maya Chen', body: 'Agreed. I will try moving it into the second beat of the fog scene and see how it reads.', createdAt: hoursAgo(18) }] },
  { id: 'cmt_2', bookId: 'mbook_harbour', sectionId: '', userId: 'user_daniel', userName: 'Daniel Osei', userAvatar: '', body: 'Harbour name spelling is inconsistent between chapter two and the back matter — “Ellsworth” vs “Elsworth”.', mentions: [], resolved: true, createdAt: daysAgo(3, 11), replies: [] },
  { id: 'cmt_3', bookId: 'book_keeper_ledger', userId: 'user_elenav', userName: 'Elena Vasquez', userAvatar: '', body: 'The novella reads beautifully as a companion piece. Consider moving it after Harbour in the series page.', mentions: ['user_demo'], resolved: false, createdAt: hoursAgo(9), replies: [] },
  { id: 'cmt_4', bookId: 'book_cartographers', userId: 'user_demo', userName: 'Maya Chen', userAvatar: '', body: 'Note to self: the surveyor scene needs the theodolite detail from the research folder.', mentions: [], resolved: false, createdAt: daysAgo(2, 21), replies: [] },
];

export const seedCollaborators: Collaborator[] = [
  { id: 'col_1', bookId: 'mbook_harbour', userId: 'user_demo', name: 'Maya Chen', email: 'demo@scriptora.app', avatarUrl: '', role: 'owner', invitedAt: daysAgo(300), status: 'active' },
  { id: 'col_2', bookId: 'mbook_harbour', userId: 'user_elenav', name: 'Elena Vasquez', email: 'elena@vasquezfiction.com', avatarUrl: '', role: 'editor', invitedAt: daysAgo(84), status: 'active' },
  { id: 'col_3', bookId: 'mbook_harbour', userId: 'user_sofia', name: 'Sofia Lindgren', email: 'sofia.l@example.com', avatarUrl: '', role: 'viewer', invitedAt: daysAgo(40), status: 'active' },
  { id: 'col_4', bookId: 'mbook_harbour', userId: 'user_pedro', name: 'Pedro Alvarez', email: 'pedro.a@example.com', avatarUrl: '', role: 'viewer', invitedAt: daysAgo(6), status: 'pending' },
  { id: 'col_5', bookId: 'book_keeper_ledger', userId: 'user_demo', name: 'Maya Chen', email: 'demo@scriptora.app', avatarUrl: '', role: 'owner', invitedAt: daysAgo(58), status: 'active' },
  { id: 'col_6', bookId: 'book_keeper_ledger', userId: 'user_elenav', name: 'Elena Vasquez', email: 'elena@vasquezfiction.com', avatarUrl: '', role: 'editor', invitedAt: daysAgo(20), status: 'active' },
];

export const seedBookNotes = [
  { id: 'note_1', bookId: 'book_cartographers', sectionId: '', title: 'Surveying details to verify', body: 'Theodolite model, chain measurements, how a flooded culvert would actually be surveyed in 1974. Research folder has two pages from the county archive.', createdAt: daysAgo(9), color: 'amber' },
  { id: 'note_2', bookId: 'book_cartographers', sectionId: '', title: 'Middle section problem', body: 'The apprentice arrives in the wrong town deliberately — but the reason is not yet on the page. Decide before drafting chapter four.', createdAt: daysAgo(4), color: 'rose' },
  { id: 'note_3', bookId: 'mbook_harbour', sectionId: '', title: 'Series bible', body: 'Ellsworth is a fishing town of 1,400. The fog behaves politely. The bell is heard only twice in the series and both times matter.', createdAt: daysAgo(120), color: 'violet' },
];

export const seedMemory: MemoryEntry[] = [
  { id: 'mem_1', bookId: 'mbook_harbour', type: 'character', name: 'Mara Ellsworth', detail: 'Protagonist. 34. Left Ellsworth at 28 after the harbour froze. Learns to distrust anything that leans toward her. Speaks in short sentences when frightened.', tags: ['protagonist', 'pov'], updatedAt: daysAgo(8) },
  { id: 'mem_2', bookId: 'mbook_harbour', type: 'character', name: 'The Boy on the Seawall', detail: 'Age ~12. Arrives without footprints. Never named in book one. Knows about the ledger before Mara does. Likely the keeper’s grandson — reveal held to book two.', tags: ['mystery', 'series'], updatedAt: daysAgo(11) },
  { id: 'mem_3', bookId: 'mbook_harbour', type: 'character', name: 'Thomas Ellsworth', detail: 'Mara’s brother. Practical, stays in town, keeps the boatyard. Resents being the one who stayed but will not say so.', tags: ['supporting'], updatedAt: daysAgo(30) },
  { id: 'mem_4', bookId: 'mbook_harbour', type: 'location', name: 'Ellsworth Harbour', detail: 'Population 1,400. Fishing and light industry. One jetty, one seawall, a lighthouse decommissioned in the novel’s past. The fog arrives with manners.', tags: ['setting'], updatedAt: daysAgo(40) },
  { id: 'mem_5', bookId: 'mbook_harbour', type: 'timeline', name: 'The frozen winter', detail: 'Six winters before chapter one. The harbour froze solid, the light went out, and the PERSISTENCE burned. Never described directly — only referenced.', tags: ['backstory'], updatedAt: daysAgo(40) },
  { id: 'mem_6', bookId: 'mbook_harbour', type: 'fact', name: 'The lantern', detail: 'Brass, keeper’s cottage shelf, still burning in chapter one. Flame leans east. Must not be explained before chapter nine.', tags: ['plot', 'constraint'], updatedAt: daysAgo(6) },
  { id: 'mem_7', bookId: 'mbook_harbour', type: 'style', name: 'Prose rules', detail: 'No dialogue tags other than said. No adverbs in action beats. Coastal vocabulary only where a harbour worker would use it. Chapter opens on sensory detail, never on dialogue.', tags: ['style', 'instructions'], updatedAt: daysAgo(14) },
  { id: 'mem_8', bookId: 'mbook_harbour', type: 'glossary', name: 'Ellsworth terms', detail: 'Gribble — the small local boat. Sluice — the channel behind the seawall. Light-keeper’s round — the walk taken at dusk.', tags: ['glossary'], updatedAt: daysAgo(50) },
  { id: 'mem_9', bookId: 'mbook_harbour', type: 'instruction', name: 'Standing author instructions', detail: 'Never resolve a chapter on a question the reader asked and the character ignored. Keep chapters under 4,000 words. Do not use the word “suddenly”.', tags: ['instructions'], updatedAt: daysAgo(5) },
  { id: 'mem_10', bookId: 'book_cartographers', type: 'character', name: 'Ines Marchetti', detail: 'The apprentice. 22. Draws inaccuracies on purpose as a moral position. Terrible at small talk.', tags: ['protagonist'], updatedAt: daysAgo(12) },
];

export const seedAiUsage: AiUsageRecord[] = Array.from({ length: 48 }).map((_, index) => {
  const features = ['Continue writing', 'Rewrite — simplify', 'Expand passage', 'Generate outline', 'Chapter generation', 'Proofread chapter', 'Generate title', 'Illustrate scene', 'Cover concept', 'Translate passage', 'Character generation', 'Summarise chapter'];
  const users = [
    ['user_demo', 'Maya Chen'], ['user_elenav', 'Elena Vasquez'], ['user_harriet', 'Harriet Lindqvist'], ['user_daniel', 'Daniel Osei'],
    ['user_gracet', 'Grace Tan'], ['user_marcus', 'Marcus Bell'], ['user_sara', 'Sara Delgado'], ['user_theo', 'Theo Marchetti'],
  ];
  const user = users[index % users.length];
  return {
    id: `aiuse_${index + 1}`,
    userId: user[0],
    userName: user[1],
    feature: features[index % features.length],
    credits: [1, 2, 4, 6, 12, 16][index % 6],
    model: ['Quill Large', 'Quill Fast', 'Atelier Vision 2', 'Proof Standard', 'Lingua Translate'][index % 5],
    createdAt: hoursAgo(index * 5 + 1),
    tokens: 400 + ((index * 337) % 2600),
  };
});

const storageUsers: [string, string, string, number, number, number, number][] = [
  ['user_demo', 'Maya Chen', 'Pro', 8.4, 5, 612, 24],
  ['user_harriet', 'Harriet Lindqvist', 'Business', 68.2, 9, 4820, 96],
  ['user_elenav', 'Elena Vasquez', 'Pro', 41.6, 14, 2940, 112],
  ['user_priya', 'Priya Raman', 'Pro', 33.1, 8, 3410, 64],
  ['user_marcus', 'Marcus Bell', 'Business', 26.4, 4, 1120, 38],
  ['user_annika', 'Annika Solveig', 'Pro', 19.2, 7, 1880, 42],
  ['user_daniel', 'Daniel Osei', 'Pro', 12.1, 6, 940, 28],
  ['user_gracet', 'Grace Tan', 'Pro', 7.1, 8, 1260, 31],
  ['user_sara', 'Sara Delgado', 'Free', 0.96, 12, 2140, 19],
  ['user_theo', 'Theo Marchetti', 'Free', 0.42, 3, 210, 6],
];

export const seedStorageUsage: StorageUsage[] = storageUsers.map(([userId, userName, planName, gb, bookFiles, imageAssets, exportFiles]) => ({
  userId,
  userName,
  planName,
  usedBytes: gb * 1024 * 1024 * 1024,
  quotaBytes: (planName === 'Free' ? 1 : planName === 'Pro' ? 50 : 500) * 1024 * 1024 * 1024,
  bookFiles,
  imageAssets,
  exportFiles,
}));

export const seedStorageObjects: StorageObject[] = [
  { id: 'obj_1', key: 'users/user_demo/exports/harbour-interior-6x9.pdf', bucket: 'scriptora-exports', ownerId: 'user_demo', kind: 'export', sizeBytes: 18.4 * 1024 * 1024, mimeType: 'application/pdf', createdAt: daysAgo(1, 14), url: '', label: 'Harbour interior (print PDF)' },
  { id: 'obj_2', key: 'users/user_demo/exports/harbour.epub', bucket: 'scriptora-exports', ownerId: 'user_demo', kind: 'export', sizeBytes: 3.1 * 1024 * 1024, mimeType: 'application/epub+zip', createdAt: daysAgo(1, 14), url: '', label: 'Harbour (EPUB 3)' },
  { id: 'obj_3', key: 'users/user_demo/covers/harbour-cover.png', bucket: 'scriptora-assets', ownerId: 'user_demo', kind: 'cover', sizeBytes: 4.2 * 1024 * 1024, mimeType: 'image/png', createdAt: daysAgo(60), url: '', label: 'Harbour cover art' },
  { id: 'obj_4', key: 'users/user_demo/assets/ellsworth-jetty.jpg', bucket: 'scriptora-assets', ownerId: 'user_demo', kind: 'image', sizeBytes: 2.8 * 1024 * 1024, mimeType: 'image/jpeg', createdAt: daysAgo(90), url: '', label: 'Ellsworth jetty reference' },
  { id: 'obj_5', key: 'users/user_demo/ai/fog-study-01.png', bucket: 'scriptora-assets', ownerId: 'user_demo', kind: 'ai-asset', sizeBytes: 1.9 * 1024 * 1024, mimeType: 'image/png', createdAt: daysAgo(12), url: '', label: 'AI fog study 01' },
  { id: 'obj_6', key: 'users/user_harriet/assets/recipe-pages/cover-spread.tif', bucket: 'scriptora-assets', ownerId: 'user_harriet', kind: 'image', sizeBytes: 96.4 * 1024 * 1024, mimeType: 'image/tiff', createdAt: daysAgo(48), url: '', label: 'Salt & Stone cover spread' },
  { id: 'obj_7', key: 'users/user_harriet/exports/salt-stone-print-8x10.pdf', bucket: 'scriptora-exports', ownerId: 'user_harriet', kind: 'export', sizeBytes: 142.7 * 1024 * 1024, mimeType: 'application/pdf', createdAt: daysAgo(20), url: '', label: 'Salt & Stone print interior' },
  { id: 'obj_8', key: 'users/user_priya/assets/paperfox/spread-07.png', bucket: 'scriptora-assets', ownerId: 'user_priya', kind: 'illustration', sizeBytes: 12.4 * 1024 * 1024, mimeType: 'image/png', createdAt: daysAgo(70), url: '', label: 'Paper Fox spread 07' },
  { id: 'obj_9', key: 'users/user_elenav/books/ledger-source.docx', bucket: 'scriptora-books', ownerId: 'user_elenav', kind: 'book-file', sizeBytes: 8.8 * 1024 * 1024, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdAt: daysAgo(300), url: '', label: 'Ledger of Small Things source' },
  { id: 'obj_10', key: 'users/user_demo/books/harbour-import.docx', bucket: 'scriptora-books', ownerId: 'user_demo', kind: 'book-file', sizeBytes: 6.1 * 1024 * 1024, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdAt: daysAgo(300), url: '', label: 'Harbour of Small Lights source manuscript' },
];

export const seedActivity: ActivityItem[] = [
  { id: 'act_1', userId: 'user_demo', type: 'book', message: 'Edited “The Keeper & The Ledger”', meta: 'Chapter 3 · 412 words added', createdAt: hoursAgo(4), link: '/dashboard/books/book_keeper_ledger/editor' },
  { id: 'act_2', userId: 'user_demo', type: 'sale', message: 'Sale: Harbour of Small Lights', meta: '$8.49 · Yuki Tanaka', createdAt: hoursAgo(3), link: '/dashboard/earnings' },
  { id: 'act_3', userId: 'user_demo', type: 'ai', message: 'AI: expanded chapter 3 opening', meta: '2 credits · Quill Large', createdAt: hoursAgo(6), link: '/dashboard/books/book_cartographers/editor' },
  { id: 'act_4', userId: 'user_demo', type: 'export', message: 'Print PDF export completed', meta: 'Harbour of Small Lights · 284 pages', createdAt: hoursAgo(28), link: '/dashboard/exports' },
  { id: 'act_5', userId: 'user_demo', type: 'comment', message: 'Elena Vasquez commented on chapter 3', meta: 'Harbour of Small Lights', createdAt: hoursAgo(20), link: '/dashboard/books/mbook_harbour/editor' },
  { id: 'act_6', userId: 'user_demo', type: 'publish', message: 'Preflight passed with 2 warnings', meta: 'The Keeper & The Ledger', createdAt: hoursAgo(30), link: '/dashboard/books/book_keeper_ledger/preflight' },
  { id: 'act_7', userId: 'user_demo', type: 'review', message: 'New 5★ review on Harbour of Small Lights', meta: 'Yuki Tanaka', createdAt: hoursAgo(34), link: '/marketplace/mbook_harbour' },
  { id: 'act_8', userId: 'user_demo', type: 'auth', message: 'Signed in from Bristol, United Kingdom', meta: 'Chrome · macOS', createdAt: hoursAgo(9), link: '/dashboard/settings/security' },
  { id: 'act_9', userId: 'user_demo', type: 'book', message: 'Created “The Cartographer’s Apprentice”', meta: 'From template: Harbour Novel', createdAt: daysAgo(96, 8), link: '/dashboard/books/book_cartographers' },
  { id: 'act_10', userId: 'user_demo', type: 'sale', message: '4 sales this week', meta: '$33.96 gross · $28.87 net', createdAt: daysAgo(1, 23), link: '/dashboard/earnings' },
];

export function buildViewEvents(): BookViewEvent[] {
  const events: BookViewEvent[] = [];
  const sources: BookViewEvent['source'][] = ['marketplace', 'search', 'author-page', 'external', 'internal'];
  const countries = ['US', 'GB', 'DE', 'CA', 'AU', 'IN', 'BR', 'SE', 'JP', 'FR', 'NL', 'NG'];
  const bookIds = ['mbook_harbour', 'book_keeper_ledger', 'mbook_saltstone', 'mbook_quietcode', 'mbook_slowmornings', 'mbook_ledger_small'];
  bookIds.forEach((bookId, bookIndex) => {
    const count = 40 + bookIndex * 12;
    for (let i = 0; i < count; i += 1) {
      events.push({
        id: `view_${bookIndex}_${i}`,
        bookId,
        userId: i % 3 === 0 ? 'user_emma' : undefined,
        createdAt: new Date(Date.now() - ((i * 7 + bookIndex * 13) % 180) * 86400000 - (i % 24) * 3600000).toISOString(),
        country: countries[(i + bookIndex) % countries.length],
        source: sources[(i + bookIndex) % sources.length],
      });
    }
  });
  return events;
}
