// @vitest-environment jsdom
/** The status bar: is the editor there, and is the work safe?
 *
 *  Both questions are answered in a `role="status"` region, because both change
 *  while the user is looking at the timeline — a bar that updates silently is a
 *  bar for people who happen to be reading it at the moment it changed.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ProjectSummary } from '../../core/api/contract';
import type { StreamHealth } from '../../core/events/bridge';
import { I18nProvider } from '../../core/i18n/I18nProvider';
import { StatusBar } from './StatusBar';

function health(over: Partial<StreamHealth> = {}): StreamHealth {
  return { status: 'live', lastSeq: 0, dropped: 0, attempts: 0, ...over };
}

function project(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    project_id: 'p1',
    name: 'Holiday edit',
    path: null,
    dirty: false,
    clip_count: 0,
    duration_frames: 0,
    pending_commands: 0,
    commands_until_checkpoint: 200,
    autosave_due: false,
    journal_sequence: 0,
    checkpoint_sequence: 0,
    ...over,
  };
}

function renderBar(over: Partial<React.ComponentProps<typeof StatusBar>> = {}): void {
  render(
    <I18nProvider>
      <StatusBar health={health()} project={null} {...over} />
    </I18nProvider>,
  );
}

describe('the connection', () => {
  it('says what the stream is doing, and announces it when that changes', () => {
    renderBar({ health: health({ status: 'live' }) });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Live');
  });

  it('says so while it is still trying', () => {
    renderBar({ health: health({ status: 'connecting' }) });
    expect(screen.getByRole('status').textContent).toContain('Connecting');
  });

  it('says so when the socket dropped and is coming back', () => {
    renderBar({ health: health({ status: 'reconnecting', attempts: 2 }) });
    expect(screen.getByRole('status').textContent).toContain('Reconnecting');
  });

  it('counts the events it lost, because a green dot over a gap is a lie', () => {
    const { unmount } = render(
      <I18nProvider>
        <StatusBar health={health({ dropped: 0 })} project={null} />
      </I18nProvider>,
    );
    expect(screen.queryByText(/dropped/)).toBeNull();
    unmount();

    renderBar({ health: health({ dropped: 3 }) });
    expect(screen.getByText('3 events dropped')).toBeTruthy();
  });
});

describe('the work', () => {
  it('says nothing is open when nothing is', () => {
    renderBar({ project: null });
    expect(screen.getByText('No project open')).toBeTruthy();
  });

  it('says which project, plainly, when there are no unsaved edits', () => {
    renderBar({ project: project({ name: 'Holiday edit' }) });
    expect(screen.getByText('Holiday edit')).toBeTruthy();
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });

  it('says the edits are unsaved, and how many a crash would lose', () => {
    renderBar({
      project: project({ name: 'Holiday edit', dirty: true, pending_commands: 4 }),
    });
    // The two things a user who thinks their work is saved needs to hear.
    expect(screen.getByText(/Holiday edit/).textContent).toContain('unsaved');
    expect(screen.getByText(/Holiday edit/).textContent).toContain('4 edits pending');
  });
});
