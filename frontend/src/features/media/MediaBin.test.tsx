// @vitest-environment jsdom
/** The media bin, against a client double.
 *
 *  What is pinned is how it reports the three things a bin has to be honest
 *  about: that it is still asking, that it has nothing, and — the one that
 *  matters — that a file the bin is holding no longer exists. A bin that shows
 *  twelve thumbnails when two of the files have been moved is a bin that lets
 *  someone start an edit they cannot finish.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../core/api/client';
import { ApiContext } from '../../core/api/context';
import type { ImportResponse, MediaAssetSummary } from '../../core/api/contract';
import type { ApiProblem } from '../../core/api/problem';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { err, ok } from '../../core/result';
import { createMediaStore, MediaStoreContext } from '../../stores/media';
import { ToastProvider } from '../../ui/ToastProvider';
import { formatDuration } from './duration';
import { MediaBin } from './MediaBin';

function asset(id: string, over: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    asset_id: id,
    name: `clip ${id}.mp4`,
    path: `/videos/clip ${id}.mp4`,
    kind: 'video',
    duration_seconds: 12.5,
    linked: true,
    probed: true,
    warnings: [],
    video: [],
    audio: [],
    ...over,
  };
}

function problem(code: string): ApiProblem {
  return { kind: 'server', code, status: 500, remedy: '', detail: '' } as unknown as ApiProblem;
}

interface Script {
  readonly assets?: readonly MediaAssetSummary[];
  readonly missing?: number;
  readonly listError?: ApiProblem;
  readonly import?: ImportResponse | { error: ApiProblem };
}

function client(script: Script, calls: string[] = []): ApiClient {
  return {
    run: (id: string) => {
      calls.push(id);
      switch (id) {
        case 'listMedia': {
          if (script.listError) return Promise.resolve(err(script.listError));
          const assets = script.assets ?? [];
          return Promise.resolve(
            ok({
              project_id: 'p1',
              assets: [...assets],
              missing: script.missing ?? 0,
              total: assets.length,
            }),
          );
        }
        case 'importMedia': {
          const answer = script.import;
          if (!answer || 'error' in answer) return Promise.resolve(err(problem('NS-TEST-0010')));
          return Promise.resolve(ok(answer));
        }
        default:
          return Promise.resolve(err(problem('NS-TEST-0000')));
      }
    },
    url: () => '',
  } as unknown as ApiClient;
}

function renderBin(script: Script, calls: string[] = []): void {
  const api = client(script, calls);
  render(
    <I18nProvider>
      <ToastProvider>
        <ApiContext.Provider value={api}>
          {/* The bin reads a store now, because the inspector reads the same
              list: two panes, one fetch, and no second copy to keep in step. */}
          <MediaStoreContext.Provider value={createMediaStore(api)}>
            <MediaBin projectId="p1" />
          </MediaStoreContext.Provider>
        </ApiContext.Provider>
      </ToastProvider>
    </I18nProvider>,
  );
}

function imported(over: Partial<ImportResponse> = {}): ImportResponse {
  return {
    assets: [asset('1')],
    duplicates: [],
    failures: [],
    journal_sequence: 1,
    pending_commands: 1,
    project_id: 'p1',
    summary: 'Imported.',
    ...over,
  };
}

describe('a bin with things in it', () => {
  it('asks as soon as it is shown, and says what came back', async () => {
    const calls: string[] = [];
    renderBin(
      { assets: [asset('1'), asset('2', { name: 'interview.wav', kind: 'audio' })] },
      calls,
    );

    expect(await screen.findByText('clip 1.mp4')).toBeTruthy();
    expect(screen.getByText('interview.wav')).toBeTruthy();
    expect(calls).toContain('listMedia');
    // A duration a person can read, not a frame count.
    expect(screen.getAllByText('0:13').length).toBe(2);
  });

  it('marks a file that is no longer where it was', async () => {
    renderBin({ assets: [asset('1', { linked: false })], missing: 1 });

    expect(await screen.findByText('missing')).toBeTruthy();
    // And says how many, at the bottom, where it does not fight the rows.
    expect(screen.getByText('1 file no longer resolves.')).toBeTruthy();
  });

  it('says it is empty rather than showing nothing at all', async () => {
    renderBin({ assets: [] });
    expect(await screen.findByText('Nothing imported yet.')).toBeTruthy();
  });

  it('says what went wrong, and keeps what it already had', async () => {
    // A failed refresh is not the same as an empty bin: the assets are still
    // there, and a panel that showed the second for the first would make people
    // re-import.
    renderBin({ assets: [asset('1')], listError: problem('NS-TEST-0011') });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('NS-TEST-0011')).toBeTruthy();
  });
});

describe('selecting a row', () => {
  it('says which row the inspector is describing', async () => {
    const user = userEvent.setup();
    renderBin({ assets: [asset('1'), asset('2')] });

    const row = await screen.findByRole('button', { name: /clip 2.mp4/ });
    expect(row.getAttribute('aria-pressed')).toBe('false');

    await user.click(row);

    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('deselects the row that is pressed again', async () => {
    const user = userEvent.setup();
    renderBin({ assets: [asset('1')] });

    const row = await screen.findByRole('button', { name: /clip 1.mp4/ });
    await user.click(row);
    await user.click(row);

    expect(row.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('importing', () => {
  it('imports the path it was given and says how many came in', async () => {
    const user = userEvent.setup();
    renderBin({ assets: [], import: imported({ assets: [asset('1'), asset('2')] }) });
    await screen.findByText('Nothing imported yet.');

    await user.type(screen.getByLabelText('File path'), '/videos/clip 1.mp4');
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Imported 2 files.')).toBeTruthy();
  });

  it('says so when the file is already in the project', async () => {
    const user = userEvent.setup();
    renderBin({
      assets: [asset('1')],
      import: imported({ assets: [], duplicates: ['/videos/clip 1.mp4'] }),
    });
    await screen.findByText('clip 1.mp4');

    await user.type(screen.getByLabelText('File path'), '/videos/clip 1.mp4');
    await user.click(screen.getByRole('button', { name: 'Import' }));

    // A warning and not a failure: nothing was lost, and a red tick over a
    // successful import is the worst kind of lie.
    expect(await screen.findByText('/videos/clip 1.mp4 is already in the project.')).toBeTruthy();
  });

  it('says so, loudly, when the file did not come in', async () => {
    const user = userEvent.setup();
    renderBin({ assets: [], import: { error: problem('NS-TEST-0010') } });
    await screen.findByText('Nothing imported yet.');

    await user.type(screen.getByLabelText('File path'), '/videos/nope.mp4');
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Could not import /videos/nope.mp4.')).toBeTruthy();
  });

  it('will not ask for an empty path', async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    renderBin({ assets: [] }, calls);

    const button = await screen.findByRole('button', { name: 'Import' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await user.click(button);
    expect(calls).not.toContain('importMedia');
  });
});

describe('a length in seconds', () => {
  it('reads the way a person reads a clock', () => {
    expect(formatDuration(12.5)).toBe('0:13');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3600)).toBe('60:00');
    // A file that reported no length is not "zero seconds long".
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});
