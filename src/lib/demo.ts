import { useSyncExternalStore } from 'react';

export type DemoRunKey = 'first-run' | 'admin';

export interface DemoStep {
  id: string;
  title: string;
  description: string;
  to: string;
  tip?: string;
}

export interface DemoState {
  done: string[];
  active: boolean;
  startedAt?: string;
  currentIndex: number;
}

const RUN_KEY = (run: DemoRunKey) => `scriptora.demo.${run}.v1`;
const POINTER_KEY = 'scriptora.demo.active.v1';
const EMPTY: DemoState = { done: [], active: false, currentIndex: 0 };

const cache = new Map<DemoRunKey, DemoState>();
const listeners = new Set<() => void>();
let pointer: DemoRunKey | null | undefined;

function canStore() {
  try {
    window.localStorage.getItem('scriptora.demo.probe');
    return true;
  } catch {
    return false;
  }
}

function read(run: DemoRunKey): DemoState {
  const cached = cache.get(run);
  if (cached) return cached;
  let next = EMPTY;
  if (canStore()) {
    try {
      const raw = window.localStorage.getItem(RUN_KEY(run));
      if (raw) next = { ...EMPTY, ...(JSON.parse(raw) as Partial<DemoState>) };
    } catch {
      next = EMPTY;
    }
  }
  cache.set(run, next);
  return next;
}

function write(run: DemoRunKey, next: DemoState) {
  cache.set(run, next);
  if (canStore()) {
    try {
      window.localStorage.setItem(RUN_KEY(run), JSON.stringify(next));
    } catch {
      /* storage disabled — session-only demo state */
    }
  }
  listeners.forEach((listener) => listener());
}

function readPointer(): DemoRunKey | null {
  if (pointer !== undefined) return pointer;
  pointer = null;
  if (canStore()) {
    try {
      const raw = window.localStorage.getItem(POINTER_KEY);
      if (raw === 'first-run' || raw === 'admin') pointer = raw;
    } catch {
      pointer = null;
    }
  }
  return pointer;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export const demoStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getRun: () => readPointer(),
  getState: (run: DemoRunKey) => read(run),
  setRun(run: DemoRunKey | null) {
    pointer = run;
    if (canStore()) {
      try {
        if (run) window.localStorage.setItem(POINTER_KEY, run);
        else window.localStorage.removeItem(POINTER_KEY);
      } catch {
        /* ignore */
      }
    }
    if (run) {
      const state = read(run);
      write(run, { ...state, active: true, startedAt: state.startedAt ?? new Date().toISOString() });
    }
    notify();
  },
  start(run: DemoRunKey) {
    const state = read(run);
    demoStore.setRun(run);
    write(run, { ...state, active: true, startedAt: state.startedAt ?? new Date().toISOString() });
  },
  stop(run: DemoRunKey) {
    const state = read(run);
    write(run, { ...state, active: false });
    if (readPointer() === run) demoStore.setRun(null);
  },
  markDone(run: DemoRunKey, stepId: string) {
    const state = read(run);
    if (state.done.includes(stepId)) return;
    write(run, { ...state, done: [...state.done, stepId] });
  },
  markUndone(run: DemoRunKey, stepId: string) {
    const state = read(run);
    write(run, { ...state, done: state.done.filter((id) => id !== stepId) });
  },
  toggleDone(run: DemoRunKey, stepId: string) {
    if (read(run).done.includes(stepId)) demoStore.markUndone(run, stepId);
    else demoStore.markDone(run, stepId);
  },
  setIndex(run: DemoRunKey, index: number) {
    const state = read(run);
    write(run, { ...state, currentIndex: Math.max(0, index) });
  },
  reset(run: DemoRunKey) {
    write(run, { ...EMPTY, active: read(run).active });
  },
};

export function useDemoRun() {
  const run = useSyncExternalStore(demoStore.subscribe, demoStore.getRun, () => null);
  return run;
}

export function useDemoState(run: DemoRunKey) {
  return useSyncExternalStore(demoStore.subscribe, () => read(run), () => EMPTY);
}

export function normalizePath(path: string) {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

export const FIRST_RUN_STEPS: DemoStep[] = [
  {
    id: 'landing',
    title: 'Land on the marketing site',
    description: 'Fifteen hand-built sections: hero, trusted-by, how it works, editor showcase, AI writing, design tools, templates, publishing, marketplace, earnings, comparison, testimonials, FAQ and the closing CTA.',
    to: '/',
    tip: 'Scroll to the FAQ — every answer expands. Announcement bar and footer links come from the CMS.',
  },
  {
    id: 'features',
    title: 'Read the feature tour',
    description: 'Five grouped columns — Writing, Design, AI, Publishing, Marketplace — each with the full capability list.',
    to: '/features',
    tip: 'Use the in-page section links; they filter the groups without a reload.',
  },
  {
    id: 'templates',
    title: 'Browse 20 template categories',
    description: 'Search, category, price and kind filters, sort, favourite, share and a full detail view with size, page count, style and "Use template".',
    to: '/templates',
    tip: 'Open any template → Use template clones it into your library.',
  },
  {
    id: 'pricing',
    title: 'Compare FREE / PRO / BUSINESS',
    description: 'Plan cards read from the same mock plan records the admin app edits, and switch the entitlement checks the whole product uses.',
    to: '/pricing',
    tip: 'The comparison table and the FAQ underneath are both live data.',
  },
  {
    id: 'ai-writing',
    title: 'See what the AI co-writer does',
    description: 'Outline generation, chapter drafting, rewriting in ten tones, proofreading, translation and cover concepts.',
    to: '/ai-writing',
    tip: 'Try the demo prompt box — it runs the same mock provider the editor uses.',
  },
  {
    id: 'signin',
    title: 'Sign in as the demo author',
    description: 'One click signs you in as Maya Chen (PRO plan) so the whole private flow is clickable.',
    to: '/login',
    tip: 'demo@scriptora.app / password123 — or use the "Sign in as demo author" button on this page.',
  },
  {
    id: 'onboarding',
    title: 'Complete the onboarding survey',
    description: 'Five skippable questions that shape the dashboard recommendations.',
    to: '/onboarding',
    tip: 'Skip works too — the survey records that you skipped instead of blocking you.',
  },
  {
    id: 'dashboard',
    title: 'Open your dashboard',
    description: 'Metric cards, sales sparkline, recent activity, five quick actions and a checklist of what to do next.',
    to: '/dashboard',
    tip: 'Every metric card links to the page that explains it.',
  },
  {
    id: 'create',
    title: 'Create a book — four ways',
    description: 'Blank, template, AI generation or import (DOCX / HTML / EPUB / TXT), then trim size, orientation, margins, gutter, bleed, fonts and theme.',
    to: '/dashboard/books/new',
    tip: 'Try "Import" and paste text — it creates real pages, not a stub.',
  },
  {
    id: 'books',
    title: 'Manage the book list',
    description: 'All / Drafts / Published / Private / Archived / Trash views with search, filters, sort, grid and list layouts and per-book actions.',
    to: '/dashboard/books',
    tip: 'Duplicate, rename, archive, trash, restore and export all mutate real state.',
  },
  {
    id: 'overview',
    title: 'Book overview & checklist',
    description: 'Chapter progress, preflight readiness, publishing checklist and every action for one title.',
    to: '/dashboard/books/book_keeper_ledger',
    tip: 'The readiness meter is computed by the preflight service, not hardcoded.',
  },
  {
    id: 'editor-write',
    title: 'Write in the editor',
    description: 'Toolbar save state, undo/redo, pages, chapters, autosave, versions, comments, find & replace, focus mode and the properties panel.',
    to: '/dashboard/books/book_keeper_ledger/editor',
    tip: 'Press Ctrl/⌘+S to force a save and Ctrl/⌘+K for the command palette.',
  },
  {
    id: 'editor-design',
    title: 'Design pages and the cover',
    description: 'Switch to Design for drag/resize/rotate elements and layers, then to Cover for front, spine and back with barcode and simulated spine width.',
    to: '/dashboard/books/book_keeper_ledger/editor?mode=design',
    tip: 'The Trim & print panel drives page numbering, headers, footers and bleed.',
  },
  {
    id: 'ai-studio',
    title: 'Use the AI studio and book memory',
    description: 'Generate an outline or chapter, then store characters, places, timeline, glossary and style rules the AI reuses.',
    to: '/dashboard/ai',
    tip: 'Credits are decremented per run and the usage bar reflects your plan.',
  },
  {
    id: 'assets',
    title: 'Manage assets and illustrations',
    description: 'Upload, generate, tag, favourite, replace and delete images, covers, exports and book files.',
    to: '/dashboard/assets',
    tip: 'Storage usage is calculated from the same records the admin storage screen shows.',
  },
  {
    id: 'exports',
    title: 'Export with preflight',
    description: 'PDF, print PDF, EPUB, EPUB 3, DOCX, HTML and TXT across digital, KDP and press-ready profiles — with passed / warnings / errors and Fix, Ignore, View issue.',
    to: '/dashboard/exports',
    tip: 'Watch the progress bar; a failed run can be retried without losing the book.',
  },
  {
    id: 'publishing',
    title: 'Publish through the 10-step centre',
    description: 'Metadata, categories, pricing, territories, ISBN, visibility and review — with per-step validation blocking the next step.',
    to: '/dashboard/publishing',
    tip: 'Choosing "marketplace" visibility unlocks the selling steps.',
  },
  {
    id: 'selling',
    title: 'Sell on the marketplace',
    description: 'Set price, run promos, watch sales, revenue, buyers and analytics for each listing.',
    to: '/dashboard/marketplace',
    tip: 'The earnings page adds payouts, invoices and revenue by title.',
  },
  {
    id: 'buy-read',
    title: 'Buy a book and read it in the browser',
    description: 'Public marketplace detail pages with reviews and ratings, then the internal reader: page and scroll modes, TOC, bookmarks, progress, font size, light/dark and fullscreen.',
    to: '/marketplace',
    tip: 'Open any title → "Read sample" to see the reader without buying.',
  },
  {
    id: 'account',
    title: 'Tune your account',
    description: 'Subscription and invoices, nine-section settings, profile, notifications with preferences, activity log, wishlist, library and global search.',
    to: '/dashboard/settings',
    tip: 'Theme follows light / dark / system — and the admin can re-theme the whole app live.',
  },
];

export const ADMIN_FLOW_STEPS: DemoStep[] = [
  {
    id: 'admin-dashboard',
    title: 'Command centre',
    description: 'Revenue, signups, publishing throughput and marketplace health with charts, alerts and the moderation queue.',
    to: '/admin',
    tip: 'Alert cards link straight to the record that needs attention.',
  },
  {
    id: 'admin-analytics',
    title: 'Analytics',
    description: 'Growth, retention, conversion, funnel and content metrics across selectable periods.',
    to: '/admin/analytics',
    tip: 'Changing the period re-queries the service — no static images anywhere.',
  },
  {
    id: 'admin-users',
    title: 'Manage users',
    description: 'Search, role and status filters, plan changes, suspend/restore, reset usage and impersonate — each behind a confirmation.',
    to: '/admin/users',
    tip: 'Bulk selection applies actions to many accounts at once.',
  },
  {
    id: 'admin-user-detail',
    title: 'Inspect one account',
    description: 'Activity trail, library, entitlements, sessions and support actions for a single user.',
    to: '/admin/users/user_demo',
    tip: 'Reset usage and plan overrides take effect in the user app immediately.',
  },
  {
    id: 'admin-books',
    title: 'Moderate books',
    description: 'Review submissions, inspect preflight reports, approve, request changes, unpublish or delete.',
    to: '/admin/books',
    tip: 'The moderation decision is written to the audit log.',
  },
  {
    id: 'admin-templates',
    title: 'Templates and categories',
    description: 'Feature, publish, price and retire templates; curate the category tree and tags.',
    to: '/admin/templates',
    tip: 'Featuring a template promotes it on the public gallery instantly.',
  },
  {
    id: 'admin-marketplace',
    title: 'Marketplace controls',
    description: 'Listing moderation, promotion/pause, commissions and suspicious-activity review.',
    to: '/admin/marketplace',
    tip: 'Commission changes flow into every seller payout calculation.',
  },
  {
    id: 'admin-orders',
    title: 'Orders and refunds',
    description: 'Filter orders, open one for full detail, issue a refund and watch revenue adjust.',
    to: '/admin/orders',
    tip: 'Refunds are reversible records, not deletions.',
  },
  {
    id: 'admin-revenue',
    title: 'Revenue and payouts',
    description: 'Revenue by stream, refund rate, payouts due and a payout queue you can mark as paid.',
    to: '/admin/revenue',
    tip: 'Export the payout run as CSV for accounting.',
  },
  {
    id: 'admin-plans',
    title: 'Plans drive entitlements',
    description: 'Edit limits, features and pricing — these records are exactly what the frontend entitlement checks read.',
    to: '/admin/plans',
    tip: 'Lower a FREE limit and watch the user app show the upgrade prompt.',
  },
  {
    id: 'admin-reviews',
    title: 'Moderate reviews',
    description: 'Approve, hide, restore, flag or delete a review, with a note for the record.',
    to: '/admin/reviews',
    tip: 'Average rating for the book recalculates immediately.',
  },
  {
    id: 'admin-reports',
    title: 'Work the report queue',
    description: 'Triage abuse and copyright reports, assign status, add an admin note and resolve.',
    to: '/admin/reports',
    tip: 'Resolving a report notifies the reporter.',
  },
  {
    id: 'admin-cms',
    title: 'Edit the public site live',
    description: 'Sections, SEO, navigation, pages and blog — the marketing site re-renders from the same records with no rebuild.',
    to: '/admin/cms',
    tip: 'Homepage and Pages have their own builders; Blog publishes posts with tags.',
  },
  {
    id: 'admin-flags',
    title: 'Feature flags',
    description: 'Toggle capabilities by scope and rollout percentage; the frontend reacts through the flag map.',
    to: '/admin/flags',
    tip: 'Set a rollout below 100% and refresh a user page to see the gated state.',
  },
  {
    id: 'admin-audit',
    title: 'Audit log',
    description: 'Every privileged write with actor, IP, before/after diff, filters, CSV export and a clear action that leaves its own trace.',
    to: '/admin/audit-logs',
    tip: 'This is the last stop — everything you just did is listed here.',
  },
];

export const ADMIN_DEEP_CUTS: { label: string; to: string }[] = [
  { label: 'Authors', to: '/admin/authors' },
  { label: 'Subscriptions', to: '/admin/subscriptions' },
  { label: 'Categories & tags', to: '/admin/categories' },
  { label: 'Homepage builder', to: '/admin/cms/homepage' },
  { label: 'CMS pages', to: '/admin/cms/pages' },
  { label: 'Blog', to: '/admin/blog' },
  { label: 'Promotions', to: '/admin/promotions' },
  { label: 'Notifications', to: '/admin/notifications' },
  { label: 'AI controls', to: '/admin/ai' },
  { label: 'Storage', to: '/admin/storage' },
  { label: 'Email', to: '/admin/email' },
  { label: 'Settings', to: '/admin/settings' },
];

export const FIRST_RUN_DEEP_CUTS: { label: string; to: string }[] = [
  { label: 'How it works', to: '/how-it-works' },
  { label: 'Public book catalogue', to: '/books' },
  { label: 'Authors', to: '/authors' },
  { label: 'Blog', to: '/blog' },
  { label: 'Library', to: '/dashboard/library' },
  { label: 'Wishlist', to: '/dashboard/wishlist' },
  { label: 'Reviews', to: '/dashboard/reviews' },
  { label: 'Analytics', to: '/dashboard/analytics' },
  { label: 'Notifications', to: '/dashboard/notifications' },
  { label: 'Activity', to: '/dashboard/activity' },
  { label: 'Global search', to: '/dashboard/search' },
  { label: 'Author profile', to: '/dashboard/profile' },
];
