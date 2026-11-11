// @vitest-environment jsdom
/** The inspector, against a media store holding a bin.
 *
 *  Two things are worth pinning, and both are about the panel saying the truth
 *  about a file:
 *
 *  * **What it shows is what the service decided.** The codec, the size, whether
 *    the path still resolves — a panel that reformatted those into something
 *    friendlier would be a second opinion about someone's file.
 *  * **"Nothing selected" is said, not left blank.** A hole next to a bin full
 *    of files reads as a panel that has failed.
 *
 *  And the one that matters for a window that can hold two projects: a
 *  selection from another project's bin is not described.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import type { MediaAssetSummary } from '../../core/api/contract';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import type { ApiClient } from '../../core/api/client';
import { createMediaStore, MediaStoreContext } from '../../stores/media';
import { createTimelineStore, TimelineStoreContext } from '../../stores/timeline';
import { Inspector } from './Inspector';

function asset(id: string, over: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    asset_id: id,
    name: `clip ${id}.mp4`,
    path: `/videos/clip ${id}.mp4`,
    kind: 'video',
    duration_seconds: 30,
    linked: true,
    probed: true,
    warnings: [],
    video: [],
    audio: [],
    ...over,
  };
}

const NO_CLIENT = { run: () => new Promise(() => {}), url: () => '' } as unknown as ApiClient;

interface Options {
  readonly assets?: readonly MediaAssetSummary[];
  readonly selectedId?: string | null;
  readonly projectId?: string;
  readonly loadedProject?: string;
}

function renderInspector(options: Options = {}): void {
  const store = createMediaStore(NO_CLIENT);
  store.setState({
    projectId: options.loadedProject ?? 'p1',
    assets: options.assets ?? [],
    status: 'ready',
  });
  const timeline = createTimelineStore(NO_CLIENT);

  function Wrapper({ children }: { readonly children: ReactNode }): React.JSX.Element {
    return (
      <I18nProvider>
        <MediaStoreContext.Provider value={store}>
          <TimelineStoreContext.Provider value={timeline}>{children}</TimelineStoreContext.Provider>
        </MediaStoreContext.Provider>
      </I18nProvider>
    );
  }

  render(<Inspector projectId={options.projectId ?? 'p1'} />, { wrapper: Wrapper });
  const selected = options.selectedId ?? null;
  if (options.selectedId !== undefined) {
    // Selected after the first paint, because that is what a click does — and
    // through `act`, because a store write outside it is a render that has not
    // happened when the assertion runs.
    act(() => {
      store.getState().select(selected);
    });
  }
}

describe('nothing selected', () => {
  it('says so, and says where to select', () => {
    renderInspector({ assets: [asset('a')] });

    expect(screen.getByText('Select a file in the media bin to see what it is.')).toBeTruthy();
  });

  it('does not describe a selection from another project', () => {
    renderInspector({
      assets: [asset('a')],
      selectedId: 'a',
      projectId: 'p1',
      loadedProject: 'p2',
    });

    // Half a second of the wrong file is how a user ends up cutting the wrong
    // take.
    expect(screen.queryByText('clip a.mp4')).toBeNull();
  });
});

describe('a file that is selected', () => {
  it('names it, and says what the probe decided it is', () => {
    renderInspector({ assets: [asset('a')], selectedId: 'a' });

    expect(screen.getByRole('heading', { name: 'clip a.mp4', level: 3 })).toBeTruthy();
    expect(screen.getByText('video')).toBeTruthy();
  });

  it('says where the file is, in a face the user can check', () => {
    renderInspector({ assets: [asset('a')], selectedId: 'a' });

    expect(screen.getByText('/videos/clip a.mp4')).toBeTruthy();
  });

  it('says how long it is in seconds and in frames, because an edit is cut in frames', () => {
    renderInspector({ assets: [asset('a')], selectedId: 'a' });

    const row = screen.getByText('Length').parentElement;
    expect(row?.textContent).toContain('0:30');
    expect(row?.textContent).toContain('00:00:30:00');
  });

  it('says a file that has moved is a file that has moved', () => {
    renderInspector({
      assets: [asset('a', { linked: false })],
      selectedId: 'a',
    });

    expect(
      screen.getByText('This file no longer resolves — relink it before rendering.'),
    ).toBeTruthy();
  });

  it('describes each stream the file has', () => {
    renderInspector({
      assets: [
        asset('a', {
          video: [
            {
              codec_name: 'h264',
              display_width: 1920,
              display_height: 1080,
              width: 1920,
              height: 1080,
              frame_rate: '30000/1001',
              frame_count: 900,
              duration_seconds: 30,
              pixel_format: 'yuv420p',
              rotation: 0,
              has_colour_metadata: true,
            },
          ],
          audio: [
            {
              codec_name: 'aac',
              channels: 2,
              channel_layout: 'stereo',
              sample_rate: 48_000,
              duration_seconds: 30,
            },
          ],
        }),
      ],
      selectedId: 'a',
    });

    expect(screen.getByText('1920 × 1080')).toBeTruthy();
    expect(screen.getByText('h264 · yuv420p')).toBeTruthy();
    expect(screen.getByText('30000/1001')).toBeTruthy();
    expect(screen.getByText('2 · stereo')).toBeTruthy();
    expect(screen.getByText('48.0 kHz')).toBeTruthy();
  });

  it('says when it knows nothing about the streams', () => {
    renderInspector({ assets: [asset('a', { probed: false })], selectedId: 'a' });

    expect(
      screen.getByText('This file has not been probed yet, so nothing is known about its streams.'),
    ).toBeTruthy();
  });

  it('passes on a warning the service wrote for the user', () => {
    renderInspector({
      assets: [asset('a', { warnings: ['This file has a variable frame rate.'] })],
      selectedId: 'a',
    });

    expect(screen.getByText('This file has a variable frame rate.')).toBeTruthy();
  });
});
