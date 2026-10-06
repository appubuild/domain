import { Link } from 'react-router-dom';
import type { Book } from '@/types/domain';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import { Badge, Button, Rating } from '@/components/ui/primitives';

export function BookCover({
  book,
  className,
  showSpine = true,
}: {
  book: Pick<Book, 'cover' | 'title' | 'authorName' | 'pageCount'>;
  className?: string;
  showSpine?: boolean;
}) {
  return (
    <div className={cn('group/cover relative', className)}>
      <div className="relative overflow-hidden rounded-r-md rounded-l-sm shadow-page transition-transform duration-300 group-hover/cover:-translate-y-0.5">
        {showSpine && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 z-10 w-[6%] bg-gradient-to-r from-black/35 via-black/10 to-transparent"
          />
        )}
        {book.cover.imageUrl ? (
          <img src={book.cover.imageUrl} alt={`${book.title} cover`} loading="lazy" decoding="async" className="aspect-[2/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[2/3] w-full flex-col justify-between p-4" style={{ background: book.cover.gradient || book.cover.backgroundColor }}>
            <p className="font-display text-lg font-bold leading-tight text-white">{book.title}</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80">{book.authorName}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function BookCard({
  book,
  onPreview,
  onWishlist,
  inWishlist,
  className,
  showAuthor = true,
  badge,
}: {
  book: Book;
  onPreview?: (book: Book) => void;
  onWishlist?: (book: Book) => void;
  inWishlist?: boolean;
  className?: string;
  showAuthor?: boolean;
  badge?: string;
}) {
  const price = book.marketplace.discountPercent
    ? book.marketplace.price * (1 - book.marketplace.discountPercent / 100)
    : book.marketplace.price;
  const isFree = book.marketplace.price === 0;

  return (
    <div className={cn('group flex flex-col', className)}>
      <Link to={`/marketplace/${book.id}`} className="block">
        <div className="relative">
          <BookCover book={book} />
          {(badge || book.marketplace.staffPick) && (
            <Badge variant="accent" className="absolute left-2 top-2 z-20 shadow-soft">
              {badge ?? 'Staff pick'}
            </Badge>
          )}
          {book.marketplace.discountPercent > 0 && (
            <Badge variant="danger" className="absolute right-2 top-2 z-20 shadow-soft">
              −{book.marketplace.discountPercent}%
            </Badge>
          )}
        </div>
      </Link>
      <div className="mt-3 flex flex-1 flex-col">
        <Link to={`/marketplace/${book.id}`} className="line-clamp-2 text-sm font-semibold leading-snug text-foreground hover:text-primary">
          {book.title}
        </Link>
        {showAuthor && (
          <Link to={`/authors/${book.ownerId}`} className="mt-0.5 text-xs text-muted-foreground hover:text-primary">
            {book.authorName}
          </Link>
        )}
        <div className="mt-1.5">
          <Rating value={book.marketplace.rating} count={book.marketplace.reviewCount} size={12} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            {isFree ? (
              <span className="text-success">Free</span>
            ) : (
              <>
                {formatCurrency(price)}
                {book.marketplace.discountPercent > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground line-through">{formatCurrency(book.marketplace.price)}</span>
                )}
              </>
            )}
          </span>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {onPreview && (
              <Button size="xs" variant="outline" onClick={() => onPreview(book)}>
                Preview
              </Button>
            )}
            {onWishlist && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
                className="h-7 w-7"
                onClick={() => onWishlist(book)}
              >
                <span className={cn('text-sm', inWishlist ? 'text-destructive' : 'text-muted-foreground')}>{inWishlist ? '♥' : '♡'}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplateCard({
  template,
  onUse,
  onPreview,
  onFavorite,
  favorite,
  className,
}: {
  template: import('@/types/domain').Template;
  onUse?: (template: import('@/types/domain').Template) => void;
  onPreview?: (template: import('@/types/domain').Template) => void;
  onFavorite?: (template: import('@/types/domain').Template) => void;
  favorite?: boolean;
  className?: string;
}) {
  const cover = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><rect width="300" height="420" fill="${template.accentColor}22"/><rect x="0" y="0" width="300" height="420" fill="none" stroke="${template.accentColor}" stroke-width="2" opacity="0.4"/><text x="24" y="70" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#111827">${template.name.slice(0, 22)}</text><text x="24" y="100" font-family="Inter, sans-serif" font-size="11" fill="#4b5563">${template.style} · ${template.trimSize.label}</text>${Array.from(
      { length: 8 },
    )
      .map((_, i) => `<rect x="24" y="${150 + i * 26}" width="${200 - (i % 3) * 40}" height="6" rx="3" fill="#9ca3af" opacity="0.5"/>`)
      .join('')}</svg>`,
  )}`;
  return (
    <div className={cn('group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-shadow hover:shadow-card', className)}>
      <div className="relative overflow-hidden bg-muted">
        <img src={cover} alt={`${template.name} template preview`} loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        {template.premium && <Badge variant="accent" className="absolute right-2 top-2">Premium</Badge>}
        {onFavorite && (
          <button
            type="button"
            aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => onFavorite(template)}
            className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-1 text-xs shadow-soft backdrop-blur transition-colors hover:bg-card"
          >
            {favorite ? '♥' : '♡'}
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
        <dl className="mt-3 grid grid-cols-2 gap-1.5 text-2xs text-muted-foreground">
          <div>
            <dt className="uppercase tracking-wide opacity-70">Size</dt>
            <dd className="font-medium text-foreground">{template.trimSize.label}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide opacity-70">Pages</dt>
            <dd className="font-medium text-foreground">{template.pageCount}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide opacity-70">Style</dt>
            <dd className="font-medium text-foreground">{template.style}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide opacity-70">Uses</dt>
            <dd className="font-medium text-foreground">{template.uses.toLocaleString()}</dd>
          </div>
        </dl>
        <div className="mt-3.5 flex items-center gap-1.5">
          {onPreview && (
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onPreview(template)}>
              Preview
            </Button>
          )}
          {onUse && (
            <Button size="sm" className="flex-1" onClick={() => onUse(template)}>
              Use template
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
