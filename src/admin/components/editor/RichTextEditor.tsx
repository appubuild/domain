/**
 * Rich-text editor (TipTap) used by the blog and page builders.
 *
 * The toolbar exposes the formatting editors actually need — headings,
 * paragraphs, bold/italic/underline/strike, lists, quotes, code, links, images,
 * tables and alignment — and each button reflects the current selection.
 *
 * Content is stored as sanitised HTML by the API (Security::sanitizeHtml on
 * write), so pasting from Word or Docs is safe to save.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react'
import { cn } from '@/admin/components/ui'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /** Opens the media library; the picker returns a public URL. */
  onRequestImage?: () => void
  minHeight?: string
  className?: string
}

const ToolbarButton = ({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    className={cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-600 transition',
      'hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900',
      active && 'border-brand-200 bg-brand-50 text-brand-700',
      disabled && 'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent',
    )}
  >
    {children}
  </button>
)

const Toolbar = ({ editor, onRequestImage }: { editor: Editor; onRequestImage?: () => void }) => {
  const setLink = useCallback(() => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL (https://…, /page, mailto:, tel:)', previous ?? 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }, [editor])

  const insertImage = useCallback(() => {
    if (onRequestImage) {
      onRequestImage()
      return
    }
    const url = window.prompt('Image URL', 'https://')
    if (url && url.trim() !== '') {
      editor.chain().focus().setImage({ src: url.trim() }).run()
    }
  }, [editor, onRequestImage])

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-t-xl border-b border-slate-200 bg-white/95 px-2 py-2 backdrop-blur">
      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton
        label="Paragraph"
        active={editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <span className="text-xs font-semibold">P</span>
      </ToolbarButton>
      {[1, 2, 3].map((level) => {
        const Icon = level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3
        return (
          <ToolbarButton
            key={level}
            label={`Heading ${level}`}
            active={editor.isActive('heading', { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
          >
            <Icon className="h-4 w-4" />
          </ToolbarButton>
        )
      })}

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code2 className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton
        label="Bullet list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Align centre" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-slate-200" />

      <ToolbarButton label="Add or edit link" active={editor.isActive('link')} onClick={setLink}>
        <Link2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Remove link" disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()}>
        <Unlink className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Insert image" onClick={insertImage}>
        <ImagePlus className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Insert table"
        active={editor.isActive('table')}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 className="h-4 w-4" />
      </ToolbarButton>

      {editor.isActive('table') && (
        <span className="ml-1 flex items-center gap-1 rounded-lg bg-slate-50 px-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            + row
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            + col
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-white"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            remove
          </button>
        </span>
      )}
    </div>
  )
}

export interface RichTextEditorHandle {
  /** Inserts an <img> at the cursor (used by the media picker). */
  insertImage: (src: string, altText?: string) => void
  /** Inserts raw HTML at the cursor. */
  insertHtml: (html: string) => void
  focus: () => void
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, onChange, placeholder = 'Write the article…', onRequestImage, minHeight = '520px', className },
  ref,
) {
  const [showHtml, setShowHtml] = useState(false)
  const htmlDraft = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: 'shn-code-block' } },
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener nofollow' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'shn-prose focus:outline-none',
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor: current }) => {
      htmlDraft.current = current.getHTML()
      onChange(current.getHTML())
    },
  })

  useImperativeHandle(
    ref,
    () => ({
      insertImage: (src: string, altText?: string) => {
        editor?.chain().focus().setImage({ src, alt: altText ?? '' }).run()
      },
      insertHtml: (html: string) => {
        editor?.chain().focus().insertContent(html).run()
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  )

  // External value changes (loading a post, undo from the HTML pane) must reach
  // the editor without resetting the cursor on every keystroke.
  useEffect(() => {
    if (!editor) return
    if (value !== editor.getHTML() && value !== htmlDraft.current) {
      htmlDraft.current = value
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  if (!editor) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading the editor…</div>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {editor.storage.characterCount.words()} words · {editor.storage.characterCount.characters()} characters
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-brand-700 hover:underline"
          onClick={() => setShowHtml((current) => !current)}
        >
          {showHtml ? 'Back to editor' : 'Edit HTML'}
        </button>
      </div>

      {showHtml ? (
        <textarea
          className="h-[520px] w-full resize-y border-0 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-100 focus:outline-none"
          value={value}
          onChange={(event) => {
            htmlDraft.current = event.target.value
            onChange(event.target.value)
          }}
        />
      ) : (
        <>
          <Toolbar editor={editor} onRequestImage={onRequestImage} />
          <EditorContent editor={editor} />
        </>
      )}
    </div>
  )
})

export default RichTextEditor
