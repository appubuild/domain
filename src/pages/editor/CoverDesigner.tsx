import * as React from 'react';
import { BookOpen, Check, Download, Eye, Image as ImageIcon, Loader2, Palette, RefreshCcw, Save, Sparkles, Wand2 } from 'lucide-react';
import { Badge, Button, Input, Label, Select, Separator, Slider, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Popover, Tabs } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { aiService, bookService, storageService } from '@/services';
import { FONTS, PAGE_PALETTES, PAPER_THICKNESS } from '@/data/constants';
import { cn } from '@/lib/utils';
import type { Book } from '@/types/domain';

const LAYOUTS: Book['cover']['layout'][] = ['classic', 'bold-bottom', 'centered', 'image-top', 'minimal', 'illustrated'];

interface Props {
  book: Book;
  onPatchCover: (patch: Partial<Book['cover']>) => void;
  onRequestUpgrade: (feature: string) => void;
  canGenerateCover: boolean;
}

export function CoverDesigner({ book, onPatchCover, onRequestUpgrade, canGenerateCover }: Props) {
  const { success, error, warning } = useToast();
  const cover = book.cover;
  const spine = bookService.spineWidth(book.id);
  const paper = PAPER_THICKNESS[book.paperStock];
  const trim = book.trimSize;
  const bleed = book.bleed;
  const fullWidth = trim.widthIn * 2 + spine.widthIn + bleed * 2;
  const fullHeight = trim.heightIn + bleed * 2;
  const [side, setSide] = React.useState<'spread' | 'front' | 'spine' | 'back'>('spread');
  const [busy, setBusy] = React.useState(false);
  const [concepts, setConcepts] = React.useState<{ id: string; name: string; paletteId: string; styleIndex: number; rationale: string }[]>([]);
  const [conceptOpen, setConceptOpen] = React.useState(false);

  const ratio = fullWidth / fullHeight;

  const generate = async () => {
    if (!canGenerateCover) {
      warning('Cover generation needs Pro', 'Upgrade to generate cover art from a prompt.');
      onRequestUpgrade('cover');
      return;
    }
    setBusy(true);
    try {
      const paletteIndex = PAGE_PALETTES.findIndex((entry) => entry.id === book.theme.palette);
      const result = await bookService.generateCoverArt(book.id, book.theme.palette, paletteIndex >= 0 ? paletteIndex : 1);
      onPatchCover({ imageUrl: result?.cover.imageUrl ?? cover.imageUrl, style: result?.cover.style ?? cover.style });
      success('Cover art regenerated');
    } catch (e) {
      error('Could not generate cover art', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openConcepts = async () => {
    if (!canGenerateCover) {
      onRequestUpgrade('cover');
      return;
    }
    const list = await aiService.coverConcepts(book.title, book.authorName, book.kind);
    setConcepts(list.map((entry, index) => ({ ...entry, name: entry.label, styleIndex: index, rationale: conceptRationale(index) })));
    setConceptOpen(true);
  };

  const exportCover = async () => {
    const svg = coverSvg(book, spine.widthIn, paper);
    await storageService.download({
      fileName: `${book.id}-cover.svg`,
      blob: new Blob([svg], { type: 'image/svg+xml' }),
    });
    success('Cover exported', 'Front, spine and back panels saved as SVG.');
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          <Tabs
            value={side}
            onValueChange={(value) => setSide(value as typeof side)}
            size="sm"
            tabs={[
              { value: 'spread', label: 'Spread' },
              { value: 'front', label: 'Front' },
              { value: 'spine', label: 'Spine' },
              { value: 'back', label: 'Back' },
            ]}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Popover
              align="end"
              trigger={<Button size="xs" variant="ghost" title="Spine width"><Badge variant="outline" className="text-2xs">Spine {spine.widthIn.toFixed(3)}″ · {spine.pages} pages · {paper}″ paper</Badge></Button>}
              className="w-64 p-3"
            >
              <div className="space-y-2">
                <p className="text-2xs font-medium">Spine width</p>
                <p className="text-2xs text-muted-foreground">
                  Calculated: {spine.calculated?.toFixed(3) ?? '—'}″ for {spine.pages} pages on {paper} paper.{' '}
                  {spine.manual ? 'A manual override is in force.' : 'Automatic.'}
                </p>
                <label className="block space-y-1 text-2xs">
                  <span>Manual override (inches, blank = automatic)</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cover.spineWidthOverride ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      onPatchCover({ spineWidthOverride: value === '' ? undefined : Math.max(0, Number(value)) });
                    }}
                    className="h-8 text-xs"
                    aria-label="Manual spine width in inches"
                  />
                </label>
                <div className="flex gap-1">
                  <Button size="xs" variant="outline" className="flex-1" onClick={() => onPatchCover({ spineWidthOverride: undefined })}>Use automatic</Button>
                  <Button size="xs" variant="outline" className="flex-1" onClick={() => onPatchCover({ spineWidthOverride: Number(spine.calculated?.toFixed(3) ?? 0) })}>Freeze current</Button>
                </div>
              </div>
            </Popover>
            <Button size="xs" variant="outline" onClick={exportCover}><Download className="h-3 w-3" /> Export cover</Button>
            <Button size="xs" variant="outline" onClick={openConcepts}><Sparkles className="h-3 w-3" /> AI concepts</Button>
            <Button size="xs" onClick={generate} disabled={busy}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Generate art</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin bg-muted/40 p-6">
          <div className="mx-auto max-w-4xl">
            <div
              className="relative mx-auto overflow-hidden rounded-md shadow-page"
              style={{ aspectRatio: `${ratio}`, background: cover.gradient || cover.backgroundColor, maxWidth: side === 'spread' ? '100%' : '420px', width: '100%' }}
            >
              {cover.imageUrl && (
                <img
                  src={cover.imageUrl}
                  alt=""
                  className={cn('absolute inset-0 h-full w-full object-cover', cover.layout === 'image-top' ? 'opacity-100' : 'opacity-90')}
                  style={{ display: cover.layout === 'minimal' ? 'none' : undefined }}
                />
              )}
              <div className={cn('relative flex h-full w-full', side === 'spread' ? 'flex-row' : '')} style={{ color: cover.titleColor }}>
                {(side === 'spread' || side === 'back') && (
                  <Panel label="Back cover" dim={side === 'spread'}>
                    <div className="flex h-full flex-col justify-between p-6">
                      <p className="whitespace-pre-line text-xs leading-relaxed" style={{ color: cover.subtitleColor }}>{cover.backText}</p>
                      {cover.showBarcode && (
                        <div className="self-end rounded bg-white p-1.5 text-center">
                          <div className="flex h-8 items-end gap-px">
                            {Array.from({ length: 34 }).map((_, index) => (
                              <span key={index} className="block w-[2px] bg-black" style={{ height: `${60 + ((index * 37) % 40)}%` }} />
                            ))}
                          </div>
                          <p className="mt-0.5 text-[8px] text-black">{cover.barcodeIsbn}</p>
                        </div>
                      )}
                    </div>
                  </Panel>
                )}
                {(side === 'spread' || side === 'spine') && (
                  <div className="flex h-full items-center justify-center border-x bg-black/5" style={{ width: `${(spine.widthIn / fullWidth) * 100}%`, minWidth: side === 'spine' ? '100%' : undefined, minHeight: side === 'spine' ? '100%' : undefined }}>
                    {spine.widthIn > 0.22 ? (
                      <p className="rotate-0 p-1 text-center text-2xs font-medium" style={{ color: cover.titleColor, writingMode: side === 'spread' ? 'vertical-rl' : 'horizontal-tb' }}>
                        {cover.spineText || `${book.title} · ${book.authorName}`}
                      </p>
                    ) : (
                      <p className="p-1 text-center text-[8px]" style={{ color: cover.subtitleColor }}>Spine too narrow for text ({spine.widthIn.toFixed(3)}″)</p>
                    )}
                  </div>
                )}
                {(side === 'spread' || side === 'front') && (
                  <Panel label="Front cover" dim={side === 'spread'}>
                    <div className={cn('flex h-full flex-col p-6', layoutClasses(cover.layout))}>
                      <p className="text-2xs uppercase tracking-widest" style={{ color: cover.subtitleColor }}>{cover.tagline || book.subtitle}</p>
                      <h2 className="mt-2 max-w-full text-3xl leading-tight" style={{ fontFamily: cover.titleFont, fontSize: `${cover.titleSize}px`, color: cover.titleColor }}>{book.title}</h2>
                      <p className="mt-3 text-sm" style={{ fontFamily: cover.subtitleFont, color: cover.subtitleColor }}>{book.subtitle}</p>
                      <p className="mt-auto text-sm font-medium" style={{ fontFamily: cover.authorFont, color: cover.authorColor }}>{book.authorName}</p>
                    </div>
                  </Panel>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-2xs text-muted-foreground">
              Full cover {fullWidth.toFixed(2)}″ × {fullHeight.toFixed(2)}″ (including {bleed}″ bleed) · front {trim.widthIn}″ × {trim.heightIn}″ · spine {spine.widthIn.toFixed(3)}″
            </p>
          </div>
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-4 overflow-y-auto scrollbar-thin border-t p-3 lg:h-full lg:w-80 lg:border-l lg:border-t-0">
        <div>
          <p className="mb-2 text-2xs font-medium">Layout</p>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => onPatchCover({ layout })}
                className={cn('rounded-md border p-2 text-2xs capitalize', cover.layout === layout ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                {layout.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>

        <Separator />
        <div className="space-y-2">
          <p className="text-2xs font-medium">Style &amp; palette</p>
          <Select value={book.theme.palette} onChange={(event) => {
            const palette = PAGE_PALETTES.find((entry) => entry.id === event.target.value);
            if (!palette) return;
            onPatchCover({ gradient: `linear-gradient(150deg, ${palette.accent}, ${palette.paper})`, backgroundColor: palette.paper, titleColor: palette.accent, subtitleColor: palette.accent, tagline: cover.tagline });
            success(`${palette.name} palette applied to the cover`);
          }} className="h-8 text-xs" aria-label="Cover palette">
            {PAGE_PALETTES.map((palette) => <option key={palette.id} value={palette.id}>{palette.name}</option>)}
          </Select>
          <div className="space-y-1">
            <Label htmlFor="cover-gradient" className="text-2xs">Gradient / background CSS</Label>
            <Input id="cover-gradient" value={cover.gradient} onChange={(event) => onPatchCover({ gradient: event.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cover-image" className="text-2xs">Artwork URL</Label>
            <Input id="cover-image" value={cover.imageUrl} onChange={(event) => onPatchCover({ imageUrl: event.target.value })} className="h-8 text-xs" />
          </div>
          <Button size="xs" variant="outline" className="w-full" onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />} New artwork
          </Button>
        </div>

        <Separator />
        <div className="space-y-2">
          <p className="text-2xs font-medium">Typography</p>
          {([
            ['titleFont', 'Title font'],
            ['subtitleFont', 'Subtitle font'],
            ['authorFont', 'Author font'],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`cover-${key}`} className="text-2xs">{label}</Label>
              <Select id={`cover-${key}`} value={cover[key]} onChange={(event) => onPatchCover({ [key]: event.target.value } as Partial<Book['cover']>)} className="h-8 text-xs">
                {FONTS.headings.map((font) => <option key={font} value={font}>{font}</option>)}
                {FONTS.body.map((font) => <option key={font} value={font}>{font}</option>)}
              </Select>
            </div>
          ))}
          <Slider label="Title size" value={cover.titleSize} min={20} max={72} onChange={(value) => onPatchCover({ titleSize: value })} format={(value) => `${value}px`} />
          <div className="grid grid-cols-3 gap-1.5">
            {([['titleColor', 'Title'], ['subtitleColor', 'Sub'], ['authorColor', 'Author']] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`colour-${key}`} className="text-2xs">{label}</Label>
                <input id={`colour-${key}`} type="color" value={cover[key]} onChange={(event) => onPatchCover({ [key]: event.target.value } as Partial<Book['cover']>)} className="h-8 w-full rounded border" />
              </div>
            ))}
          </div>
        </div>

        <Separator />
        <div className="space-y-2">
          <p className="text-2xs font-medium">Spine &amp; back</p>
          <div className="space-y-1">
            <Label htmlFor="spine-text" className="text-2xs">Spine text</Label>
            <Input id="spine-text" value={cover.spineText} onChange={(event) => onPatchCover({ spineText: event.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tagline" className="text-2xs">Tagline</Label>
            <Input id="tagline" value={cover.tagline} onChange={(event) => onPatchCover({ tagline: event.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="back-text" className="text-2xs">Back cover copy</Label>
            <Textarea id="back-text" rows={5} value={cover.backText} onChange={(event) => onPatchCover({ backText: event.target.value })} className="text-xs" />
          </div>
        </div>

        <Separator />
        <div className="space-y-2">
          <p className="text-2xs font-medium">Barcode &amp; ISBN</p>
          <label className="flex items-center justify-between text-xs">
            <span>Show barcode on back cover</span>
            <Switch checked={cover.showBarcode} onCheckedChange={(checked) => onPatchCover({ showBarcode: checked })} />
          </label>
          <div className="space-y-1">
            <Label htmlFor="cover-isbn" className="text-2xs">ISBN</Label>
            <Input id="cover-isbn" value={cover.barcodeIsbn} onChange={(event) => onPatchCover({ barcodeIsbn: event.target.value })} className="h-8 text-xs" />
          </div>
          <p className="text-2xs text-muted-foreground">Barcodes are simulated here and written into print PDF exports by the publishing engine.</p>
        </div>

        <Separator />
        <div className="space-y-2">
          <p className="text-2xs font-medium">Cover checklist</p>
          {[
            { label: 'Title is legible at thumbnail size', ok: cover.titleSize >= 28 },
            { label: 'Spine has enough width for text', ok: spine.widthIn > 0.22 },
            { label: 'Barcode present on the back', ok: cover.showBarcode },
            { label: 'Back cover copy written', ok: cover.backText.trim().length > 40 },
            { label: 'Artwork assigned', ok: Boolean(cover.imageUrl) },
          ].map((row) => (
            <p key={row.label} className={cn('flex items-center gap-1.5 text-2xs', row.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
              {row.ok ? <Check className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {row.label}
            </p>
          ))}
        </div>

        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            bookService.createVersion(book.id, { id: book.ownerId, name: book.authorName }, 'Cover checkpoint', `Cover layout: ${cover.layout}`);
            success('Cover saved', 'A checkpoint was added to version history.');
          }}
        >
          <Save className="h-3.5 w-3.5" /> Save cover checkpoint
        </Button>
      </aside>

      <Modal
        open={conceptOpen}
        onOpenChange={setConceptOpen}
        title="AI cover concepts"
        description="Pick a direction and it is applied to the designer immediately."
        size="lg"
        footer={<Button variant="outline" onClick={() => setConceptOpen(false)}>Close</Button>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {concepts.map((concept) => (
            <button
              key={concept.id}
              type="button"
              onClick={async () => {
                const palette = PAGE_PALETTES.find((entry) => entry.id === concept.paletteId) ?? PAGE_PALETTES[0];
                const result = await bookService.generateCoverArt(book.id, concept.paletteId, concept.styleIndex);
                onPatchCover({
                  backgroundColor: palette.paper,
                  gradient: `linear-gradient(150deg, ${palette.accent}, ${palette.paper})`,
                  imageUrl: result?.cover.imageUrl ?? cover.imageUrl,
                  style: concept.name,
                  titleColor: palette.accent,
                  subtitleColor: palette.accent,
                });
                setConceptOpen(false);
                success(`${concept.name} applied`);
              }}
              className="rounded-lg border p-2 text-left transition-colors hover:border-primary/50"
            >
              <div className="h-24 rounded" style={{ background: `linear-gradient(150deg, ${PAGE_PALETTES.find((entry) => entry.id === concept.paletteId)?.accent ?? '#888'}, ${PAGE_PALETTES.find((entry) => entry.id === concept.paletteId)?.paper ?? '#eee'})` }} />
              <p className="mt-1.5 text-xs font-medium">{concept.name}</p>
              <p className="text-2xs text-muted-foreground">{concept.rationale}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground"><Palette className="h-3 w-3" /> Concepts combine your palette, title length and genre.</p>
      </Modal>

      <span className="hidden"><BookOpen className="h-3 w-3" /><ImageIcon className="h-3 w-3" /></span>
    </div>
  );
}

function Panel({ label, dim, children }: { label: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative h-full flex-1" style={{ minWidth: 0 }}>
      {children}
      {dim && <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-[8px] text-white">{label}</span>}
    </div>
  );
}

function layoutClasses(layout: Book['cover']['layout']) {
  switch (layout) {
    case 'bold-bottom':
      return 'justify-end text-left';
    case 'centered':
      return 'items-center justify-center text-center';
    case 'image-top':
      return 'justify-end';
    case 'minimal':
      return 'justify-center text-left';
    case 'illustrated':
      return 'items-end text-center';
    default:
      return 'justify-center';
  }
}

function coverSvg(book: Book, spineWidth: number, paper: number) {
  const trim = book.trimSize;
  const bleed = book.bleed;
  const width = trim.widthIn * 2 + spineWidth + bleed * 2;
  const height = trim.heightIn + bleed * 2;
  const scale = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(width * scale).toFixed(0)}" height="${(height * scale).toFixed(0)}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${book.cover.backgroundColor}"/><stop offset="100%" stop-color="${book.theme.accentColor}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="${bleed + trim.widthIn + spineWidth}" y="${bleed}" width="${trim.widthIn}" height="${trim.heightIn}" fill="none" stroke="#00000022"/>
  <text x="${bleed + trim.widthIn / 2}" y="${bleed + trim.heightIn / 2}" text-anchor="middle" font-family="${book.cover.titleFont}" font-size="${(book.cover.titleSize / 96).toFixed(2)}" fill="${book.cover.titleColor}">${escapeXml(book.title)}</text>
  <text x="${bleed + trim.widthIn + spineWidth / 2}" y="${bleed + trim.heightIn / 2}" text-anchor="middle" font-family="${book.cover.titleFont}" font-size="0.14" fill="${book.cover.titleColor}" transform="rotate(90 ${bleed + trim.widthIn + spineWidth / 2} ${bleed + trim.heightIn / 2})">${escapeXml(book.cover.spineText)}</text>
  <text x="${bleed + trim.widthIn + spineWidth + trim.widthIn / 2}" y="${bleed + trim.heightIn - 0.6}" text-anchor="middle" font-family="${book.cover.authorFont}" font-size="0.16" fill="${book.cover.authorColor}">${escapeXml(book.authorName)}</text>
  <text x="${bleed + 0.25}" y="${bleed + 0.4}" font-size="0.09" fill="${book.cover.subtitleColor}">Paper: ${paper.toFixed(3)}in · spine ${spineWidth.toFixed(3)}in · ${book.pageCount} pages</text>
</svg>`;
}

function conceptRationale(index: number) {
  return [
    'Large type carries the title; art stays low so the cover reads at thumbnail size.',
    'Atmospheric artwork with the title anchored in the lower third.',
    'Modern geometry with a strong accent block behind the author name.',
    'Soft illustrated plate framed by generous margins and a classic serif.',
  ][index] ?? 'A distinct direction generated from your palette and genre.';
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character] ?? character));
}
