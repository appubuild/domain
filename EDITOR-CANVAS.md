# Book editor canvas — upgrade notes

The canvas was upgraded **in place**: the site, dashboard, navigation and app shell are
untouched. Everything below is driven by the same document model
(`Book → sections → pages → blocks/objects → text / image / shape / table`), so the
editor, preview, page numbering, TOC, publishing and export all read one source of truth.

## What the editor can now do

| Area | Where | Notes |
| --- | --- | --- |
| Full text toolbar | `src/pages/editor/ContextToolbar.tsx` (text mode) | Bold…strikethrough, font family/size/weight, colour, highlight, align ×4, line height, letter spacing, paragraph spacing, indent, bullet/numbered/checklist, super/subscript, text case, clear formatting, hyperlink + remove, quote, named styles, drop cap, text direction, page break, blank page |
| Named typography styles | `textStyles.ts` + Book tab → *Typography styles* | 17 styles (Title…Footer, drop cap). “Update all matching content” rewrites flow HTML **and** canvas elements by `data-style` / `styleName` |
| Overflow safety | `flow.ts` + canvas badge | Hidden measurer (`div[data-flow-measurer]`), `inspectPage`, `paginateFlow`, `planSpill`, `splitAtBlock`. Overflow shows an amber bar with *Continue on a new page*; blocks are moved as units, an over-long paragraph is split mid-sentence; nothing is clipped or lost. Without a layout engine (jsdom/SSR) the engine reports `unmeasurable` and **never invents** breaks |
| Write vs Design | `EditorPage` + `PageCanvas.designMode` | Write = auto-refowing prose; Design = object layer on **every** page (previously only `canvas`/`blank` pages had one). Switching modes only changes rendering, so content survives |
| Objects | page canvas | move, resize, rotate, duplicate, delete, lock/unlock, hide/show, front/back, align ×6, distribute H/V, group/ungroup (group moves and selects as one, and can always be unlocked) |
| Text wrap | `wrappingElements`, `imageFilterStyle`, canvas floats | around / square / tight (CSS `shape-outside`) / top-and-bottom / behind text / in front / no wrap. Floats are real floats inside the text column, so the browser reflows exactly what the paginator measures |
| Layers | Properties panel → *Layers* | grouped by type (Background, Image, Text, Shape, Table, Decoration), drag reorder rewrites `z`, lock, hide, rename (double-click), select, group/ungroup, multi-select |
| Elements library | `libraries.ts`, Elements panel | shapes, lines & arrows, frames, dividers & ornaments, book elements (chapter ornament, scene separator, drop cap, pull quote, footnote rule/block, caption, running head, page number, copyright, dedication, epigraph, author bio, callout, recipe, worksheet, quote block), tables, badges, patterns. Every entry inserts a real, editable object |
| Admin-managed library | `src/data/libraryAssets.ts`, `assetService.library()/publishToLibrary()/retireFromLibrary()`, `adminService.assetLibrary()` | 24 shipped assets (illustrations, backgrounds, frames, icons, stickers, imprint marks) available to every user, plus anything an admin publishes; retired ids are filtered out. The editor reads it through the service layer only, so Phase 2 can swap the constant for an admin API without touching a screen |
| Asset library | Assets panel, `freeImageService.ts` | My uploads (kept after insertion, with type/size/date/search/delete), Images, Illustrations, Icons, Shapes, Backgrounds, Frames, Stickers, AI generated, Covers, Logos, and **Free images** with the approved-provider architecture (Unsplash, Pexels, Pixabay enabled; Openverse declared). Keys live on a server proxy — none in the client. Mock results, *Add to Book* inserts into the current page and stores the credit |
| Page management | Pages panel | thumbnails (real page model, virtualised past `canvas.virtualizeAfter`), rename (double-click), insert before/after, blank-page insert, duplicate, move up/down, lock, recto start, keep-together, move to section, numbering, delete, drag reorder |
| Chapter management | Chapters panel | add (all section kinds), rename, duplicate with pages, move up/down, collapse/expand (persisted in `canvas.collapsedSections`), reorder by drag, split, delete, page list |
| Page breaks | text toolbar + Page tab | insert break at cursor, break before, start on right page, keep on one page, orphan/widow controls on the theme, blank page insertion |
| Book dimensions & margins | Page/Book tabs | 5×8 … 8.5×11 plus custom, orientation, top/bottom/inner/outer margins, gutter, bleed, safe area |
| Spine & cover | Cover tab | automatic width from page count + paper stock, freezes into `cover.spineWidthOverride` when overridden; front, spine and back render as one spread |
| Rulers, guides, snapping | canvas toolbar → *Guides* | rulers, margin, centre, safe-area and bleed guides, baseline grid, snap-to-grid with configurable step, snap-to-objects with live alignment guides |
| Colours | text/image/object toolbars | recent colours, document palette, theme colours, custom picker |
| Tables | Elements library + table toolbar | insert 2×2/3×3/data/caption tables; click any cell on the page to edit its text; insert/delete row or column **at the active cell**; merge right/down and split; per-cell fill, alignment, bold/italic; header row; border colour; caption. The grid shrinks its type automatically so a table can never spill past the page edge |
| Footnotes | Page tab | add, edit, delete, automatic sequential numbering across the book; `kind` is already `footnote | endnote` so print and reflowable EPUB can diverge later |
| Headers/footers | Book tab | author, title, chapter, custom text, page number, different first page |
| Preview parity | `PreviewMode` | renders the **same** `PageCanvas` read-only at 0.62 zoom — no second layout to drift from the editor |
| Export safety | `exportSafety.ts` + export modal | overflow, objects outside the safe area, missing images, empty pages, unattached notes, no-wrap art over prose, spine override. Each issue links to *Open page* |
| Performance | canvas + panel | editor renders one page at a time; thumbnails are cheap model renders and virtualise past 40 pages; flow measurement runs outside React render |
| Undo/redo | `useEditorProject.commit` | every operation (text, formatting, move/resize, add/remove, page and chapter ops) is a history entry; gestures commit once on pointer-up |
| Shortcuts | `EditorPage` + Tiptap | Ctrl/Cmd+B/I/U/Z/Shift+Z/C/V/X/F/P/S/Delete/Escape; Ctrl+C/X/V use the object clipboard when an object is selected |

## Guarding the upgrade

```
npm run check:editor   # jsdom: toolbar, page ops, chapters, library insert, layers/lock,
                       # preview parity, export safety — 26 assertions
npm run smoke          # every public, dashboard and admin route
npm run check:theme    # theme tokens still propagate from the database
npm run report:size    # entry 490.6 kB raw / 149.6 kB gzip; initial download 240.7 kB gzip
```

`check:editor` needs the smoke bundle first:

```
SMOKE_BUILD=1 node scripts/smoke.mjs /
```

## Deliberate boundaries

* The paginator measures text with a hidden DOM measurer. In a non-browser environment it
  reports `unmeasurable` and refuses to split — fake page breaks would be worse than none.
* Free-image search answers from a deterministic mock catalogue behind the provider
  registry; the server proxy that will hold the keys is the only thing missing in Phase 1.
* No production database schema was added: everything still flows through
  UI → service → repository → mock database.
