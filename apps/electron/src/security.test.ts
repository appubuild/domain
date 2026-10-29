// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isApprovedDevelopmentUrl, isSafeExternalUrl, isTrustedAppNavigation, isTrustedAppOrigin } from './security';

describe('Electron URL allowlists', () => {
  it('allows only the fixed loopback Vite development endpoint', () => {
    expect(isApprovedDevelopmentUrl('http://127.0.0.1:4173/')).toBe(true);
    expect(isApprovedDevelopmentUrl('http://localhost:4173/')).toBe(true);
    expect(isApprovedDevelopmentUrl('http://127.0.0.1:4173/settings')).toBe(false);
    expect(isApprovedDevelopmentUrl('http://127.0.0.1:5173/')).toBe(false);
    expect(isApprovedDevelopmentUrl('https://127.0.0.1:4173/')).toBe(false);
    expect(isApprovedDevelopmentUrl('http://user@127.0.0.1:4173/')).toBe(false);
    expect(isApprovedDevelopmentUrl('https://example.com/')).toBe(false);
  });

  it('keeps packaged navigation on the app origin and renderer document', () => {
    const trusted = 'landexpert://app/index.html';
    expect(isTrustedAppNavigation('landexpert://app/index.html#/settings', trusted)).toBe(true);
    expect(isTrustedAppNavigation('landexpert://app/other.html', trusted)).toBe(false);
    expect(isTrustedAppNavigation('https://example.com/index.html', trusted)).toBe(false);
    expect(isTrustedAppNavigation('landexpert://attacker/index.html', trusted)).toBe(false);
    expect(isTrustedAppNavigation('landexpert://app/index.html@evil.example', trusted)).toBe(false);
  });

  it('recognizes only the app origin for narrowly scoped permissions', () => {
    expect(isTrustedAppOrigin('landexpert://app', 'landexpert://app/index.html')).toBe(true);
    expect(isTrustedAppOrigin('landexpert://attacker', 'landexpert://app/index.html')).toBe(false);
    expect(isTrustedAppOrigin('http://127.0.0.1:4173', 'http://127.0.0.1:4173/')).toBe(true);
    expect(isTrustedAppOrigin('http://evil.example:4173', 'http://127.0.0.1:4173/')).toBe(false);
  });

  it('allows ordinary public HTTPS links but blocks local, credentialed and non-web targets', () => {
    expect(isSafeExternalUrl('https://www.openstreetmap.org/copyright')).toBe(true);
    expect(isSafeExternalUrl('https://example.com:443/path')).toBe(true);
    for (const value of [
      'http://example.com', 'javascript:alert(1)', 'file:///etc/passwd',
      'https://localhost', 'https://sub.localhost', 'https://printer.local',
      'https://127.0.0.1', 'https://[::1]', 'https://192.168.1.2',
      'https://user:pass@example.com', 'https://example.com:8443', 'https://intranet',
    ]) expect(isSafeExternalUrl(value), value).toBe(false);
  });
});
