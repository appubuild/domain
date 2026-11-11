/** The preview: the picture the project makes, at the frame the playhead is on.
 *
 *  The panel is small, and every line in it is there because of a way previews
 *  usually lie:
 *
 *  * **It asks for the pixels it can fill, and no more.** The panel measures
 *    itself and sends its size in device pixels; the service composites once and
 *    scales down. A panel that asked for a fixed 1920 × 1080 into a 400-pixel
 *    hole would pay for nine times the decode and then throw it away.
 *  * **The picture on screen is the last one that arrived, not the one being
 *    asked for.** A preview that blanked between frames would strobe while you
 *    scrub. So the old frame stays while the new one is fetched, dimmed (and
 *    only dimmed) to say that it is behind.
 *  * **A frame drawn without a clip says so.** `X-Nova-Preview-Gaps` names the
 *    assets that could not be decoded; the frame is drawn *without* them, which
 *    is the right thing for a preview to do and the wrong thing to do silently.
 *  * **Zoom is a request for detail, not a stretch.** The service never scales
 *    up, so `200%` is a bigger window onto the project's own pixels — which is
 *    how you check focus, and why fit is the default.
 *
 *  What it does not do is decode: there is no `<video>` here and no canvas. The
 *  frame is a JPEG the service composited with the same code the export uses, so
 *  what is in this panel is what the export will contain — which is the entire
 *  reason a preview is worth building this way round.
 */

import { useMemo } from 'react';

import { useI18n } from '../../core/i18n/context';
import { formatTimecode } from '../../core/timecode/timecode';
import { useDurationFrames, useTimebase } from '../../stores/timeline';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Panel } from '../../ui/Panel';
import { Spinner } from '../../ui/Spinner';
import { useAnchoredMenu } from '../../ui/useAnchoredMenu';
import { useElementSize } from '../../ui/useElementSize';
import { TransportBar } from './TransportBar';
import { gapCount } from './geometry';
import { usePreviewFrame } from './usePreviewFrame';
import { useTransport } from './useTransport';

/** How many device pixels to ask for per CSS pixel, at most.
 *
 *  Capped at 2: a 3× ratio on a 4K monitor would ask the service for a frame
 *  eight times the size of the one on screen, and the extra pixels are invisible
 *  — the eye stops telling them apart long before the decoder stops paying for
 *  them. */
const MAX_PIXEL_RATIO = 2;

const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4];

export interface PreviewPaneProps {
  readonly projectId: string;
}

export function PreviewPane({ projectId }: PreviewPaneProps): React.JSX.Element {
  const { t } = useI18n();
  // Read, not passed in: a preview handed a rate by its caller would happily
  // draw a timecode at a rate the project is not, which is the one kind of
  // wrong number a user cannot see.
  const timebase = useTimebase();
  const durationFrames = useDurationFrames();
  const transport = useTransport(timebase);
  const stage = useElementSize<HTMLDivElement>();
  const zoomMenu = useAnchoredMenu();

  const ratio = useMemo(
    () =>
      typeof window === 'undefined'
        ? 1
        : Math.min(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, MAX_PIXEL_RATIO),
    [],
  );
  const width = Math.round(stage.size.width * ratio);
  const height = Math.round(stage.size.height * ratio);

  // `fit` is the service's own fit; a number asks for that multiple of it.
  const zoom = transport.zoom === 'fit' ? 1 : transport.zoom;
  const frame = usePreviewFrame({ projectId, frame: transport.frame, width, height, zoom });
  const gaps = gapCount(frame.geometry);

  const zoomLabel =
    transport.zoom === 'fit'
      ? t('preview.zoomFit')
      : t('preview.zoomPercent', { percent: Math.round(transport.zoom * 100) });

  const items: readonly MenuItem[] = [
    {
      id: 'fit',
      label: t('preview.zoomFit'),
      ...(transport.zoom === 'fit' ? { icon: 'check' as const } : {}),
      onSelect: () => {
        transport.setZoom('fit');
      },
    },
    ...ZOOM_STEPS.map((step) => ({
      id: String(step),
      label: t('preview.zoomPercent', { percent: Math.round(step * 100) }),
      ...(transport.zoom === step ? { icon: 'check' as const } : {}),
      onSelect: () => {
        transport.setZoom(step);
      },
    })),
  ];

  return (
    <Panel
      title={t('preview.heading')}
      className="h-full"
      actions={
        <>
          <Button variant="ghost" size="sm" iconEnd="chevron-down" {...zoomMenu.triggerProps}>
            {zoomLabel}
          </Button>
          <Menu
            open={zoomMenu.isOpen}
            align="end"
            anchor={zoomMenu.anchor}
            trigger={zoomMenu.trigger}
            label={t('preview.zoom')}
            items={items}
            onClose={zoomMenu.close}
          />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div
          ref={stage.ref}
          className="relative min-h-0 flex-1 overflow-hidden rounded-control bg-black"
          role="img"
          aria-label={t('preview.stageAt', {
            timecode: formatTimecode(transport.frame, timebase),
          })}
          data-testid="preview-stage"
        >
          {frame.url === null ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-faint">
              {durationFrames === 0 ? t('preview.empty') : t('preview.waiting')}
            </p>
          ) : (
            <img
              src={frame.url}
              alt=""
              // Dimmed while behind, never hidden: a preview that blanked
              // between frames would strobe while the user scrubs.
              className={cxStage(frame.stale)}
            />
          )}

          {frame.status === 'loading' ? (
            <span className="absolute right-2 top-2 rounded-control bg-surface-1/80 p-1.5 text-ink-dim">
              <Spinner size="sm" label={t('preview.loading')} />
            </span>
          ) : null}
        </div>

        {gaps > 0 ? (
          <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
            <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
            {t('preview.gaps', { count: gaps })}
          </p>
        ) : null}

        {frame.error === null ? null : (
          <p className="text-xs text-danger" role="alert">
            {t('preview.frameFailed', { code: frame.error.code })}
          </p>
        )}

        <TransportBar transport={transport} timebase={timebase} />
      </div>
    </Panel>
  );
}

/** Two classes, because the difference between them is one property: a frame
 *  that is behind is dimmed, and nothing else about it changes. */
function cxStage(stale: boolean): string {
  return stale
    ? 'size-full object-contain opacity-60 transition-opacity duration-[var(--duration-fast)]'
    : 'size-full object-contain';
}
