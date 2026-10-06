import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

export function toDate(value: string | Date | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : new Date(value);
}

export function formatDate(value: string | Date | undefined, pattern = 'MMM d, yyyy') {
  return format(toDate(value), pattern);
}

export function formatDateTime(value: string | Date | undefined) {
  return format(toDate(value), 'MMM d, yyyy · h:mm a');
}

export function timeAgo(value: string | Date | undefined) {
  return `${formatDistanceToNowStrict(toDate(value))} ago`;
}

export function formatCurrency(amount: number, currency = 'USD', options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    ...options,
  }).format(amount);
}

export function formatNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatCompactCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 1 : 2,
  }).format(value);
}

export function formatPercent(value: number, digits = 1) {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export const BOOK_KIND_LABELS: Record<string, string> = {
  fiction: 'Fiction',
  nonfiction: 'Non-fiction',
  children: "Children's",
  workbook: 'Workbook',
  journal: 'Journal',
  planner: 'Planner',
  cookbook: 'Cookbook',
  textbook: 'Textbook',
  biography: 'Biography',
  poetry: 'Poetry',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  ready: 'Ready',
  published: 'Published',
  archived: 'Archived',
  trashed: 'Trash',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  unpublished: 'Unpublished',
  preflight: 'Preflight',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  active: 'Active',
  suspended: 'Suspended',
  invited: 'Invited',
  paid: 'Paid',
  open: 'Open',
  refunded: 'Refunded',
  pending: 'Pending',
  hidden: 'Hidden',
  published_review: 'Published',
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  'print-pdf': 'Print PDF',
  epub: 'EPUB',
  epub3: 'EPUB 3',
  docx: 'DOCX',
  html: 'HTML',
  txt: 'Plain text',
};
