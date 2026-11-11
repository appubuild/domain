import { describe, expect, it } from 'vitest';
import { clamp, formatCost, formatNumber, initials, truncate, relativeTime, cn } from '@/lib/utils';

describe('formatting helpers', () => {
  it('formats numbers with compact suffixes only when useful', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(12_500)).toBe('12.5k');
    expect(formatNumber(2_400_000)).toBe('2.4M');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('formats tiny costs without rounding them to zero', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0004)).toBe('$0.0004');
    expect(formatCost(1.239)).toBe('$1.24');
  });

  it('clamps and truncates', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('derives initials safely', () => {
    expect(initials('Aria Nova')).toBe('AN');
    expect(initials('  ')).toBe('');
  });

  it('merges conflicting tailwind classes with the last winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('renders relative times and rejects invalid dates', () => {
    expect(relativeTime('not-a-date')).toBe('—');
    expect(relativeTime(new Date().toISOString())).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h ago');
  });
});
