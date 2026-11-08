// @vitest-environment jsdom
/** Translation as a React resource.
 *
 *  The provider is where the rule "no literal user-facing string in a component"
 *  becomes enforceable, so what is pinned here is the contract a component
 *  relies on: the hook answers in the locale the tree was given, the document
 *  says which language it is in, and a component rendered without a provider
 *  fails loudly instead of quietly rendering English.
 *
 *  The keys below are typed: `AppMessageKey` is derived from the reference
 *  bundle, so a test that names a key that does not exist does not compile —
 *  which is the same guarantee a component gets, and the reason the last test in
 *  this file can pass a key the bundle it supplies does *not* have and watch the
 *  fallback report it.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from './bundles/bn.json';
import en from './bundles/en.json';
import { type AppMessageKey, DEFAULT_LOCALE } from './bundles';
import { useI18n } from './context';
import { I18nProvider } from './I18nProvider';
import { createTranslator } from './translate';
import type { MessageBundle, MessageValues } from './types';

function Message({
  messageKey,
  values,
}: {
  readonly messageKey: AppMessageKey;
  readonly values?: MessageValues;
}): React.JSX.Element {
  const { t } = useI18n();
  return <span data-testid="out">{t(messageKey, values)}</span>;
}

afterEach(() => {
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

describe('a tree with no provider', () => {
  it('fails loudly rather than rendering English by accident', () => {
    // Silenced: React logs the thrown error, which is the point of the test and
    // not its output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Message messageKey="projects.create" />)).toThrow(/no I18n in context/);
    spy.mockRestore();
  });
});

describe('a tree with a provider', () => {
  it('answers in the locale it was given', () => {
    render(
      <I18nProvider locale="en">
        <Message messageKey="projects.closeNamed" values={{ name: 'Holiday' }} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('Close Holiday');
  });

  it('answers in the reference locale when it was given nothing', () => {
    render(
      <I18nProvider>
        <Message messageKey="projects.create" />
      </I18nProvider>,
    );
    expect(DEFAULT_LOCALE).toBe('en');
    expect(screen.getByTestId('out').textContent).toBe('Create');
  });

  it('a locale with a region gets that language’s bundle', () => {
    // `bn-BD` is Bangla in Bangladesh, and answering it with English because
    // nobody wrote a `bn-BD` bundle would be a bug, not a fallback.
    render(
      <I18nProvider locale="bn-BD">
        <Message messageKey="splash.starting" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('এডিটর চালু হচ্ছে…');
  });

  it('an unknown locale falls back to the reference instead of showing keys', () => {
    render(
      <I18nProvider locale="xx">
        <Message messageKey="splash.ready" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('Ready.');
  });

  it('tells the document which language it is in, and which way it reads', () => {
    render(
      <I18nProvider locale="bn" bundles={[en, bn]}>
        <span />
      </I18nProvider>,
    );
    expect(document.documentElement.getAttribute('lang')).toBe('bn');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('mirrors for a right-to-left locale', () => {
    const ar: MessageBundle = { locale: 'ar', label: 'العربية', messages: { plain: 'جاهز' } };
    render(
      <I18nProvider locale="ar" bundles={[ar]}>
        <span />
      </I18nProvider>,
    );
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('gives the document back on unmount, so a test cannot leak a language', () => {
    document.documentElement.setAttribute('lang', 'en');
    const { unmount } = render(
      <I18nProvider locale="bn" bundles={[en, bn]}>
        <span />
      </I18nProvider>,
    );
    expect(document.documentElement.getAttribute('lang')).toBe('bn');
    unmount();
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('learns about a key no bundle could answer, rather than hiding it', () => {
    const missing: string[] = [];
    render(
      <I18nProvider onMissing={(key) => missing.push(key)}>
        {/* Written as if it were a key the reference bundle has, which is
            exactly the situation a component built for a plugin finds itself in
            when the plugin is not loaded: every real key exists in English, so
            the only way to reach this path is one that does not. */}
        <Message messageKey={'plugin.notLoaded' as AppMessageKey} />
      </I18nProvider>,
    );
    // The key is what the user sees, and the callback is what CI sees.
    expect(screen.getByTestId('out').textContent).toBe('plugin.notLoaded');
    expect(missing).toEqual(['plugin.notLoaded']);
  });

  it('says nothing about a key every bundle answered', () => {
    const missing: string[] = [];
    render(
      <I18nProvider bundles={[en, bn]} onMissing={(key) => missing.push(key)}>
        <Message messageKey="splash.ready" />
      </I18nProvider>,
    );
    expect(missing).toEqual([]);
  });

  it('a translator can be injected, which is how a test proves a translation', () => {
    const translator = createTranslator<AppMessageKey>({
      locale: 'test',
      bundle: { locale: 'test', label: 'Test', messages: en.messages },
    });
    render(
      <I18nProvider translator={translator}>
        <Message messageKey="projects.create" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('Create');
  });
});
