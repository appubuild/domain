/** The transport: the row under the picture that every editor has.
 *
 *  Six controls, and a timecode. The order is not decorative — it is the order
 *  every editor has used since a tape deck: **to start, back a frame, play,
 *  forward a frame, to end**, with the position beside them. An editor that
 *  rearranged these would be an editor nobody who has used one can drive
 *  without looking.
 *
 *  Two things it says that a toolbar usually does not:
 *
 *  * **The frame the playhead is on, and the last frame there is.** "Frame 299
 *    of 300" is not the same sentence as "00:00:09:29"; the second is where you
 *    are, and the duration is how much project is left to put something in.
 *  * **The rate.** A timecode is only readable next to the rate it was counted
 *    at: `00:10:00;00` at 29.97 and at 59.94 are different lengths of time, and
 *    a counter that left you to guess is a counter you have to double-check.
 *
 *  The buttons are disabled at the ends rather than hidden: a control that
 *  vanishes when it does not apply teaches the user that the row is unreliable.
 */

import { useI18n } from '../../core/i18n/context';
import { formatFps, type Timebase } from '../../core/timecode/timebase';
import { formatTimecode } from '../../core/timecode/timecode';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import { TimecodeField } from './TimecodeField';
import type { Transport } from './useTransport';

export interface TransportBarProps {
  readonly transport: Transport;
  readonly timebase: Timebase;
}

export function TransportBar({ transport, timebase }: TransportBarProps): React.JSX.Element {
  const { t } = useI18n();
  const atStart = transport.frame <= 0;
  const atEnd = transport.frame >= transport.lastFrame;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Tooltip content={t('preview.toStart')}>
          <IconButton
            icon="chevron-first"
            label={t('preview.toStart')}
            size="sm"
            disabled={transport.frame === 0}
            onClick={transport.toStart}
          />
        </Tooltip>
        <Tooltip content={t('preview.stepBack')}>
          <IconButton
            icon="chevron-left"
            label={t('preview.stepBack')}
            size="sm"
            disabled={atStart}
            onClick={() => {
              transport.step(-1);
            }}
          />
        </Tooltip>
        <Tooltip content={transport.playing ? t('preview.pause') : t('preview.play')}>
          <IconButton
            icon={transport.playing ? 'pause' : 'play'}
            label={transport.playing ? t('preview.pause') : t('preview.play')}
            size="sm"
            variant="soft"
            onClick={transport.togglePlay}
          />
        </Tooltip>
        <Tooltip content={t('preview.stepForward')}>
          <IconButton
            icon="chevron-right"
            label={t('preview.stepForward')}
            size="sm"
            disabled={atEnd}
            onClick={() => {
              transport.step(1);
            }}
          />
        </Tooltip>
        <Tooltip content={t('preview.toEnd')}>
          <IconButton
            icon="chevron-last"
            label={t('preview.toEnd')}
            size="sm"
            disabled={atEnd}
            onClick={transport.toEnd}
          />
        </Tooltip>
      </div>

      <TimecodeField
        label={t('preview.position')}
        frame={transport.frame}
        timebase={timebase}
        hint={t('preview.positionHint')}
        invalidMessage={t('preview.invalidTimecode')}
        onSeek={transport.seek}
      />

      {/* Testable by id, because the sentence is assembled from four parts and
          a text query would have to know how they were joined. */}
      <p className="font-mono text-xs tabular-nums text-ink-faint" data-testid="preview-length">
        <VisuallyHidden>{t('preview.durationLabel')} </VisuallyHidden>
        {formatTimecode(transport.durationFrames, timebase)}
        <span className="px-1.5 text-ink-dim">·</span>
        {formatFps(timebase)} fps
      </p>
    </div>
  );
}
