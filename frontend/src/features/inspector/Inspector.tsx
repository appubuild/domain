/** The inspector: everything about the one thing that is selected.
 *
 *  Every editor has this panel and most of them get two things wrong, so the
 *  panel is built around not getting them wrong:
 *
 *  * **It describes what the service said, in the service's words.** Every field
 *    here is a field of `MediaAssetSummary` — the codec the file declared, the
 *    size the probe decided, whether the path still resolves. A panel that
 *    reformatted those into something friendlier would be a second opinion about
 *    a file, and the second opinion is the one that is wrong after a relink.
 *  * **"Nothing selected" is a state, not a void.** A blank panel next to a bin
 *    full of files reads as a broken panel. So it says what selecting means and
 *    where to do it, which is the difference between an inspector and a hole.
 *
 *  One kind of thing is selectable today — an asset in the bin. A clip on the
 *  timeline is the second, and it arrives with stage 7; the shape is a `switch`
 *  on the selection's kind rather than a component that assumes assets, because
 *  an inspector that assumed would have to be rewritten rather than extended.
 */

import { useI18n } from '../../core/i18n/context';
import type { AudioSummary, VideoSummary } from '../../core/api/contract';
import { formatDuration } from '../media/duration';
import { useMediaStore } from '../../stores/media';
import { useTimebase } from '../../stores/timeline';
import { formatTimecode } from '../../core/timecode/timecode';
import { Panel } from '../../ui/Panel';

export interface InspectorProps {
  readonly projectId: string;
}

export function Inspector({ projectId }: InspectorProps): React.JSX.Element {
  const { t } = useI18n();
  const timebase = useTimebase();
  const selectedId = useMediaStore((state) => state.selectedId);
  const assets = useMediaStore((state) => state.assets);
  const status = useMediaStore((state) => state.status);
  // The bin the store is holding is the bin of one project. Describing another
  // project's file would be describing a file that is not in this edit — which
  // is what you see, for a moment, when you switch projects.
  const loaded = useMediaStore((state) => state.projectId) === projectId;

  const asset = assets.find((candidate) => candidate.asset_id === selectedId) ?? null;

  return (
    <Panel title={t('inspector.heading')} className="h-full">
      {asset === null || !loaded ? (
        <p className="text-sm text-ink-faint">
          {status === 'loading' || !loaded ? t('inspector.loading') : t('inspector.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <header className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-ink">{asset.name}</h3>
            <span className="shrink-0 text-xs uppercase text-ink-faint">{asset.kind}</span>
          </header>

          {asset.linked ? null : (
            <p className="text-xs text-warning" role="status">
              {t('inspector.missing')}
            </p>
          )}

          <dl className="flex flex-col gap-1.5 text-xs">
            <Row label={t('inspector.path')}>
              <span className="break-all font-mono text-ink-dim">{asset.path}</span>
            </Row>
            <Row label={t('inspector.duration')}>
              <span className="font-mono tabular-nums text-ink">
                {formatDuration(asset.duration_seconds)}
              </span>
              {/* The same length in frames, because an editor is cut in frames
                  and not in seconds: 10.4 s is not a length you can cut at. */}
              <span className="pl-1.5 font-mono tabular-nums text-ink-faint">
                {formatTimecode(
                  Math.round(asset.duration_seconds * (timebase.num / timebase.den)),
                  timebase,
                )}
              </span>
            </Row>
          </dl>

          {asset.video.map((stream, index) => (
            <section key={`video-${index}`} className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {asset.video.length === 1
                  ? t('inspector.video')
                  : t('inspector.videoNumber', { number: index + 1 })}
              </h4>
              <VideoRows stream={stream} />
            </section>
          ))}

          {asset.audio.map((stream, index) => (
            <section key={`audio-${index}`} className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {asset.audio.length === 1
                  ? t('inspector.audio')
                  : t('inspector.audioNumber', { number: index + 1 })}
              </h4>
              <AudioRows stream={stream} />
            </section>
          ))}

          {asset.probed ? null : (
            <p className="text-xs text-ink-faint">{t('inspector.notProbed')}</p>
          )}

          {asset.warnings.length === 0 ? null : (
            <ul className="flex flex-col gap-1 text-xs text-warning">
              {asset.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <p className="font-mono text-[0.65rem] text-ink-faint">{asset.asset_id}</p>
        </div>
      )}
    </Panel>
  );
}

/** One property. A definition list rather than a table: the inspector is a list
 *  of names and values, and a table would promise a grid that is not there. */
function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function VideoRows({ stream }: { readonly stream: VideoSummary }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      <Row label={t('inspector.size')}>
        <span className="font-mono tabular-nums text-ink">
          {stream.display_width} × {stream.display_height}
          {stream.rotation === 0
            ? null
            : ` (${t('inspector.rotated', { degrees: stream.rotation })})`}
        </span>
      </Row>
      <Row label={t('inspector.codec')}>
        <span className="font-mono text-ink">
          {stream.codec_name}
          {stream.pixel_format === '' ? null : ` · ${stream.pixel_format}`}
        </span>
      </Row>
      <Row label={t('inspector.rate')}>
        <span className="font-mono tabular-nums text-ink">{stream.frame_rate}</span>
      </Row>
      {stream.frame_count === 0 ? null : (
        <Row label={t('inspector.frames')}>
          <span className="font-mono tabular-nums text-ink">{stream.frame_count}</span>
        </Row>
      )}
    </dl>
  );
}

function AudioRows({ stream }: { readonly stream: AudioSummary }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      <Row label={t('inspector.codec')}>
        <span className="font-mono text-ink">{stream.codec_name}</span>
      </Row>
      <Row label={t('inspector.channels')}>
        <span className="font-mono tabular-nums text-ink">
          {stream.channels}
          {stream.channel_layout === '' ? null : ` · ${stream.channel_layout}`}
        </span>
      </Row>
      <Row label={t('inspector.sampleRate')}>
        <span className="font-mono tabular-nums text-ink">
          {t('inspector.kilohertz', { kilohertz: (stream.sample_rate / 1000).toFixed(1) })}
        </span>
      </Row>
    </dl>
  );
}
