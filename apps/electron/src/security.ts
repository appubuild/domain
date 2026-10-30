import { isIP } from 'node:net';

export function isApprovedDevelopmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port === '4173'
      && url.pathname === '/'
      && !url.username && !url.password
      && !url.search && !url.hash;
  } catch { return false; }
}

export function isTrustedAppNavigation(candidateValue: string, trustedValue: string): boolean {
  try {
    const candidate = new URL(candidateValue);
    const trusted = new URL(trustedValue);
    if (candidate.protocol !== trusted.protocol || candidate.username || candidate.password) return false;
    if (candidate.protocol === 'file:') {
      return candidate.host === '' && trusted.host === '' && candidate.pathname === trusted.pathname;
    }
    if (candidate.protocol === 'landexpert:') {
      return candidate.host === trusted.host && candidate.pathname === trusted.pathname;
    }
    return candidate.origin === trusted.origin && candidate.pathname === trusted.pathname;
  } catch { return false; }
}

export function isTrustedAppOrigin(candidateValue: string, trustedValue: string): boolean {
  try {
    const candidate = new URL(candidateValue);
    const trusted = new URL(trustedValue);
    if (candidate.username || candidate.password || candidate.protocol !== trusted.protocol) return false;
    if (candidate.protocol === 'landexpert:') return candidate.host === trusted.host;
    return candidate.origin === trusted.origin;
  } catch { return false; }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase();
    return url.protocol === 'https:'
      && !url.username && !url.password
      && (!url.port || url.port === '443')
      && host.includes('.')
      && host !== 'localhost'
      && !host.endsWith('.localhost')
      && !host.endsWith('.local')
      && isIP(host) === 0;
  } catch { return false; }
}
