/** The translator, held as a plain object: no React, no DOM, no network.
 *
 *  Three behaviours are worth more than the rest, and each has a test:
 *
 *  * a missing message returns the **key**, because `splash.starting` on screen
 *    is a one-line bug report and a blank is a mystery;
 *  * a **partial bundle** falls back to the reference rather than to nothing,
 *    which is what makes a plugin that ships six strings work at all;
 *  * **interpolation never throws**, including on a placeholder the message does
 *    not name — a translator that blew up on a bad bundle would take the panel
 *    down with it.
 */

import { describe, expect, it } from 'vitest';

import { createTranslator } from './translate';
import type { MessageBundle } from './types';

function bundle(messages: MessageBundle['messages'], locale = 'en'): MessageBundle {
  return { locale, label: locale, messages };
}

const EN = bundle({
  plain: 'Ready.',
  named: 'Hello {name}.',
  clips: { one: '{count} clip', other: '{count} clips' },
  onlyOther: { other: '{count} things' },
  group: { nested: { deep: 'Deep' } },
});

describe('a plain message', () => {
  it('is itself', () => {
    expect(createTranslator({ locale: 'en', bundle: EN }).t('plain')).toBe('Ready.');
  });
});

describe('a message that is missing', () => {
  it('returns the key, because a key on screen is a bug report', () => {
    expect(createTranslator({ locale: 'en', bundle: EN }).t('nope.not.here')).toBe('nope.not.here');
  });

  it('says so to anyone listening, so a test can fail on it', () => {
    const missing: string[] = [];
    createTranslator({ locale: 'en', bundle: EN, onMissing: (key) => missing.push(key) }).t(
      'splash.starting',
    );
    expect(missing).toEqual(['splash.starting']);
  });

  it('a group is not a message, even when the group exists', () => {
    // `'group.nested'` is an object, not a string: answering with "[object
    // Object]" would be the worst possible failure mode.
    const missing: string[] = [];
    const t = createTranslator({
      locale: 'en',
      bundle: EN,
      onMissing: (key) => missing.push(key),
    }).t;
    expect(t('group.nested')).toBe('group.nested');
    expect(missing).toEqual(['group.nested']);
  });

  it('`has` tells a caller that a key is untranslated before it asks', () => {
    const translator = createTranslator({ locale: 'en', bundle: EN });
    expect(translator.has('plain')).toBe(true);
    expect(translator.has('nothing.here')).toBe(false);
  });
});

describe('interpolation', () => {
  it('substitutes by name', () => {
    expect(createTranslator({ locale: 'en', bundle: EN }).t('named', { name: 'Ada' })).toBe(
      'Hello Ada.',
    );
  });

  it('leaves a placeholder with no value alone rather than blanking it', () => {
    // "Hello {name}." is visibly unfinished; "Hello ." looks finished and wrong.
    expect(createTranslator({ locale: 'en', bundle: EN }).t('named')).toBe('Hello {name}.');
    expect(createTranslator({ locale: 'en', bundle: EN }).t('named', { other: 'x' })).toBe(
      'Hello {name}.',
    );
  });

  it('takes numbers as they come, and does not format them', () => {
    expect(createTranslator({ locale: 'en', bundle: EN }).t('named', { name: 42 })).toBe(
      'Hello 42.',
    );
  });
});

describe('plurals', () => {
  it('one is one and two is other, in English', () => {
    const t = createTranslator({ locale: 'en', bundle: EN }).t;
    expect(t('clips', { count: 1 })).toBe('1 clip');
    expect(t('clips', { count: 2 })).toBe('2 clips');
    expect(t('clips', { count: 0 })).toBe('0 clips');
  });

  it('a form the bundle left out falls back to `other`', () => {
    // `onlyOther` has no `one`, and `1 things` is better than nothing.
    expect(createTranslator({ locale: 'en', bundle: EN }).t('onlyOther', { count: 1 })).toBe(
      '1 things',
    );
  });

  it('a count-sensitive message asked for without a count reads `other`', () => {
    expect(createTranslator({ locale: 'en', bundle: EN }).t('clips')).toBe('{count} clips');
  });

  it('the category comes from the locale, not from a hardcoded rule', () => {
    // Polish has three: 1 film, 2 filmy, 5 filmów. A translator who cannot write
    // that is a translator who stops — which is the reason `plural.ts` exists.
    const pl = bundle(
      {
        films: {
          one: '{count} film',
          few: '{count} filmy',
          many: '{count} filmów',
          other: '{count} filmu',
        },
      },
      'pl',
    );
    const t = createTranslator({ locale: 'pl', bundle: pl }).t;
    expect(t('films', { count: 1 })).toBe('1 film');
    expect(t('films', { count: 2 })).toBe('2 filmy');
    expect(t('films', { count: 5 })).toBe('5 filmów');
    expect(t('films', { count: 22 })).toBe('22 filmy');
  });
});

describe('a partial bundle', () => {
  it('falls back for the keys it does not have', () => {
    const half = bundle({ named: 'Hallo {name}.' }, 'de');
    const t = createTranslator({ locale: 'de', bundle: half, fallback: EN }).t;
    expect(t('named', { name: 'Ada' })).toBe('Hallo Ada.');
    expect(t('plain')).toBe('Ready.');
  });

  it('reports nothing as missing when the fallback answered', () => {
    const missing: string[] = [];
    const t = createTranslator({
      locale: 'de',
      bundle: bundle({}, 'de'),
      fallback: EN,
      onMissing: (key) => missing.push(key),
    }).t;
    expect(t('plain')).toBe('Ready.');
    expect(missing).toEqual([]);
  });
});
