// @vitest-environment jsdom
/** The preview panel, against a client double and a measured stage.
 *
 *  The tests are about what the panel *says*, which is the half of a preview
 *  that is easy to leave out:
 *
 *  * **An empty project says so** rather than showing a black rectangle and
 *    leaving the user to wonder whether the service is up.
 *  * **A frame drawn without a clip says so**, because a preview that silently
 *    omitted one is a preview that lies about the edit.
 *  * **A frame that failed says what failed** and keeps the last picture.
 *
 *  jsdom has no layout, so the stage is measured by stubbing
 *  `getBoundingClientRect` — without a size the panel asks for nothing, which is
 *  the behaviour the first test pins.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { ApiClient } from '../../core/api/client';
import { ApiContext } from '../../core/api/context';
import type { TimelineResponse, TimelineSummary } from '../../core/api/contract';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { err, ok } from '../../core/result';
import { createPlaybackStore, PlaybackStoreContext } from '../../stores/playback';
import { createTimelineStore, TimelineStoreContext } from '../../stores/timeline';
import { PreviewPane } from './PreviewPane';

function edit(over: Partial<TimelineSummary> = {}): TimelineSummary {
  return {
    timebase: { num: 30, den: 1, fps: 30 },
    tracks: [],
    track_count: 0,
    clip_count: 0,
    duration_frames: 300,
    ...over,
  };
}

function timelineResponse(durationFrames: number): TimelineResponse {
  return {
    project_id: 'p1',
    timeline: edit({ duration_frames: durationFrames }),
    history: {
      can_undo: false,
      can_redo: false,
      undo_label: '',
      redo_label: '',
      undo_depth: 0,
      redo_depth: 0,
      recent: [],
    },
    journal_sequence: 1,
    pending_commands: 0,
    dirty: false,
  };
}

interface Script {
  readonly durationFrames?: number;
  readonly gaps?: string;
  readonly frameError?: boolean;
}

function client(script: Script = {}): { client: ApiClient; frameCalls: () => number } {
  let frameCalls = 0;
  const api = {
    run: (id: string) => {
      if (id === 'getTimeline') {
        return Promise.resolve(ok(timelineResponse(script.durationFrames ?? 300)));
      }
      return Promise.resolve(err({ kind: 'api', status: 500, code: 'NS-TEST-0000', detail: '' }));
    },
    runBlob: () => {
      frameCalls += 1;
      if (script.frameError === true) {
        return Promise.resolve(
          err({ kind: 'api', status: 500, code: 'NS-RENDER-5030', detail: '' }),
        );
      }
      return Promise.resolve(
        ok({
          blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
          headers: new Headers({
            'content-type': 'image/jpeg',
            'X-Nova-Preview-Size': '960x540',
            'X-Nova-Preview-Scale': '1.000000',
            ...(script.gaps === undefined ? {} : { 'X-Nova-Preview-Gaps': script.gaps }),
          }),
          status: 200,
        }),
      );
    },
    url: () => '',
  } as unknown as ApiClient;
  return { client: api, frameCalls: () => frameCalls };
}

/** Give the stage a size, so the panel has a viewport to ask for. */
function measure(width = 960, height = 540): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

function renderPane(script: Script = {}): { frameCalls: () => number } {
  const { client: api, frameCalls } = client(script);
  const playback = createPlaybackStore();
  const timeline = createTimelineStore(api);

  function Wrapper({ children }: { readonly children: ReactNode }): React.JSX.Element {
    return (
      <I18nProvider>
        <ApiContext.Provider value={api}>
          <TimelineStoreContext.Provider value={timeline}>
            <PlaybackStoreContext.Provider value={playback}>
              {children}
            </PlaybackStoreContext.Provider>
          </TimelineStoreContext.Provider>
        </ApiContext.Provider>
      </I18nProvider>
    );
  }

  render(<PreviewPane projectId="p1" />, { wrapper: Wrapper });
  // The pane reads the timeline slice; in the window it is the workspace that
  // says which project the slice is describing, so a pane tested alone has to
  // say it itself.
  void timeline.getState().load('p1');
  return { frameCalls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wait until the project has been read.
 *
 *  Before the edit is in hand the timeline is empty, so the transport is clamped
 *  to a project with no frames and every button is disabled — which is correct,
 *  and which a test that clicked immediately would mistake for a broken pane. */
async function ready(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Next frame' })).toHaveProperty('disabled', false);
  });
}

describe('a pane that has not been measured', () => {
  it('asks for nothing, because there is no viewport to ask about', async () => {
    const { frameCalls } = renderPane();
    await waitFor(() => {
      expect(screen.getByTestId('preview-stage')).toBeTruthy();
    });
    expect(frameCalls()).toBe(0);
  });
});

describe('a pane with a project', () => {
  it('asks for the frame the playhead is on, at the size it can fill', async () => {
    measure();
    const { frameCalls } = renderPane();

    await waitFor(() => {
      expect(frameCalls()).toBeGreaterThan(0);
    });
  });

  it('says an empty project has nothing to show rather than showing a black hole', async () => {
    measure();
    renderPane({ durationFrames: 0 });

    expect(await screen.findByText('Nothing to show yet — the timeline is empty.')).toBeTruthy();
  });

  it('shows the length and the rate beside the playhead, because a timecode alone is not readable', async () => {
    measure();
    renderPane();

    await ready();
    // 300 frames at 30 fps is ten seconds, and the rate is what makes the
    // timecode readable at all.
    expect(screen.getByTestId('preview-length').textContent).toContain('00:00:10:00');
    expect(screen.getByTestId('preview-length').textContent).toContain('30 fps');
  });
});

describe('a frame that is missing something', () => {
  it('says which assets could not be decoded', async () => {
    measure();
    renderPane({ gaps: 'asset-1,asset-2' });

    expect(
      await screen.findByText('2 assets could not be decoded; the frame was drawn without them.'),
    ).toBeTruthy();
  });

  it('says so in the singular for one', async () => {
    measure();
    renderPane({ gaps: 'asset-1' });

    expect(
      await screen.findByText('1 asset could not be decoded; the frame was drawn without it.'),
    ).toBeTruthy();
  });

  it('says what went wrong when the frame itself failed', async () => {
    measure();
    renderPane({ frameError: true });

    expect(await screen.findByText('This frame could not be drawn (NS-RENDER-5030).')).toBeTruthy();
  });
});

describe('the transport', () => {
  it('moves a frame at a time, and says where it is', async () => {
    const user = userEvent.setup();
    measure();
    renderPane();

    await ready();
    await user.click(screen.getByRole('button', { name: 'Next frame' }));
    await user.click(screen.getByRole('button', { name: 'Next frame' }));

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Playhead').value).toBe('00:00:00:02');
    });
  });

  it('goes to the last frame, and stops there', async () => {
    const user = userEvent.setup();
    measure();
    renderPane();

    await ready();
    await user.click(screen.getByRole('button', { name: 'Go to end' }));

    // 299 and not 300: a 300-frame project has no frame 300.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Playhead').value).toBe('00:00:09:29');
    });
    expect(screen.getByRole('button', { name: 'Next frame' })).toHaveProperty('disabled', true);
  });

  it('plays and pauses', async () => {
    const user = userEvent.setup();
    measure();
    renderPane();

    await ready();
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
  });
});

describe('the zoom', () => {
  it('is fit by default, and can be set to a percentage', async () => {
    const user = userEvent.setup();
    measure();
    renderPane();

    const trigger = await screen.findByRole('button', { name: /Fit/ });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: '200%' }));

    expect(screen.getByRole('button', { name: /200%/ })).toBeTruthy();
  });
});
