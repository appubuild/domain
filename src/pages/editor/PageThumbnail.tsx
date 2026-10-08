import * as React from 'react';
import { pagePixelSize } from './PageCanvas';
import type { Book, BookPage } from '@/types/domain';

/**
 * Cheap, real thumbnail of a page: the same document model the canvas renders,
 * drawn small. Flow pages show their prose; design pages show their object boxes.
 * No layout engine needed, so this stays fast for hundreds of pages.
 */
export function PageThumbnail({
  book,
  page,
  width = 56,
  className,
}: {
  book: Book;
  page: BookPage;
  width?: number;
  className?: string;
}) {
  const natural = pagePixelSize(book.trimSize, book.orientation, 1);
  const height = Math.round((width * natural.height) / natural.width);
  const scale = width / natural.width;
  const text = (page.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const background =
    page.background?.type === 'color' ? page.background.value
    : page.background?.type === 'gradient' ? `linear-gradient(${page.background.value})`
    : page.background?.type === 'image' && page.background.imageUrl ? `url(${page.background.imageUrl}) center/cover`
    : '#fff';

  return (
    <div
      className={className}
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        background,
        border: '1px solid hsl(var(--border))',
        borderRadius: 2,
        flexShrink: 0,
      }}
      aria-hidden
    >
      {/* margins */}
      <div
        style={{
          position: 'absolute',
          inset: `${book.margins.top * 96 * scale}px ${book.margins.right * 96 * scale}px ${book.margins.bottom * 96 * scale}px ${book.margins.left * 96 * scale}px`,
          overflow: 'hidden',
        }}
      >
        {page.layout !== 'canvas' && page.layout !== 'blank' && (
          <p style={{ margin: 0, fontFamily: book.fonts.body, fontSize: Math.max(2, book.fonts.baseSize * 1.33 * scale * 0.62), lineHeight: 1.25, color: '#1f2937' }}>
            {text.slice(0, 220) || '—'}
          </p>
        )}
        {page.elements.filter((element) => element.visible).slice(0, 14).map((element) => (
          <span
            key={element.id}
            style={{
              position: 'absolute',
              left: `${element.x}%`,
              top: `${element.y}%`,
              width: `${element.w}%`,
              height: `${element.h}%`,
              background: element.image?.src
                ? undefined
                : element.type === 'image'
                  ? 'hsl(var(--muted))'
                  : element.shape?.fill ?? 'hsl(var(--primary) / 0.25)',
              backgroundImage: element.image?.src ? `url(${element.image.src})` : undefined,
              backgroundSize: 'cover',
              borderRadius: element.type === 'shape' ? '50%' : 1,
              opacity: element.locked ? 0.55 : 1,
            }}
          />
        ))}
      </div>
      {page.locked && <span style={{ position: 'absolute', right: 1, top: 1, fontSize: 7, color: 'hsl(var(--muted-foreground))' }}>🔒</span>}
      {page.continuationOf && <span style={{ position: 'absolute', left: 2, bottom: 1, fontSize: 7, color: 'hsl(var(--muted-foreground))' }}>…</span>}
    </div>
  );
}
