"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils/format";
import { sanitizeHtml } from "@/lib/content/sanitize";

/**
 * Rich text editor for the admin content screens.
 *
 * Design notes:
 *
 *  - **Sticky toolbar inside its own container.** The toolbar sticks to the top of the editor's
 *    scroll area, not the window, so it can never float over the page title. The editor body has
 *    a minimum height and grows with the text, and the page scrolls normally around it.
 *  - **The value written to the database is sanitised HTML.** The toolbar only offers marks that
 *    the sanitiser keeps, so what the author sees is what gets stored. `style` attributes are not
 *    offered at all (the sanitiser drops them), which is why there is no alignment control:
 *    a button whose effect disappears on save is worse than no button.
 *  - **`immediatelyRender: false`.** The admin is a static export, so the editor must not render
 *    during prerendering; it mounts on the client after hydration.
 */
export function RichTextEditor({
  value,
  onChange,
  label = "Body",
  placeholder = "Write the article…",
  minHeight = "22rem",
  toolbarStickyTop = "0px",
  error,
}: {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  placeholder?: string;
  minHeight?: string;
  /**
   * Offset for the sticky toolbar. The surrounding screen usually has its own sticky action bar,
   * so the toolbar parks underneath it instead of sliding under (and being covered by) it.
   */
  toolbarStickyTop?: string;
  error?: string | null;
}) {
  const handleUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      onChange(editor.getHTML());
    },
    [onChange],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
        codeBlock: { HTMLAttributes: { class: "code-block" } },
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: null }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "prose-editor focus:outline-none min-h-[var(--editor-min-height)] px-4 py-4 text-sm leading-relaxed",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: handleUpdate,
  });

  // Keep the editor in sync when the value changes from outside (loading a record, discarding
  // changes). Comparing first avoids resetting the cursor on every keystroke, which would make
  // typing impossible.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-surface" style={{ minHeight }}>
        <div className="border-b border-border px-3 py-2 text-[11px] text-fg-subtle">Loading editor…</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius)] border bg-surface",
        error ? "border-danger" : "border-border-strong",
      )}
    >
      <div
        className="sticky z-10 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
        style={{ top: toolbarStickyTop }}
      >
        <Toolbar editor={editor} />
      </div>
      <div style={{ ["--editor-min-height" as string]: minHeight }}>
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/50 px-3 py-1.5 text-[11px] text-fg-subtle">
        <span>
          {editor.storage.characterCount.words().toLocaleString()} words ·{" "}
          {editor.storage.characterCount.characters().toLocaleString()} characters
        </span>
        <span>Formatting is stored as sanitised HTML.</span>
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [, forceRender] = useState(0);
  // Tiptap re-renders on selection changes itself; this keeps the active states honest after
  // commands that do not move the cursor (e.g. toggling a mark with no selection).
  useEffect(() => {
    const update = () => forceRender((value) => value + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const setLink = () => {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link address (https://…, mailto:…). Leave empty to remove the link.", previous);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    // The sanitiser only keeps http, https, mailto and tel links; other schemes are refused here
    // rather than silently stripped on save.
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) {
      window.alert("Use a full address starting with https://, mailto: or tel:.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1.5" role="toolbar" aria-label="Formatting">
      <Group>
        <ToolButton
          label="Undo"
          shortcut="Ctrl+Z"
          active={false}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="size-3.5" />
        </ToolButton>
        <ToolButton
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          active={false}
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="size-3.5" />
        </ToolButton>
      </Group>

      <Divider />

      <Group>
        <ToolButton label="Bold" shortcut="Ctrl+B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-3.5" />
        </ToolButton>
        <ToolButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="size-3.5" />
        </ToolButton>
        <ToolButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className="size-3.5" />
        </ToolButton>
      </Group>

      <Divider />

      <Group>
        <ToolButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-3.5" />
        </ToolButton>
        <ToolButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="size-3.5" />
        </ToolButton>
        <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-3.5" />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-3.5" />
        </ToolButton>
        <ToolButton label="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-3.5" />
        </ToolButton>
      </Group>

      <Divider />

      <Group>
        <ToolButton label="Link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="size-3.5" />
        </ToolButton>
        <ToolButton
          label="Clear formatting"
          active={false}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <RemoveFormatting className="size-3.5" />
        </ToolButton>
      </Group>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
}

function ToolButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // Keep the selection: a normal mousedown would blur the editor and collapse it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "grid size-8 place-items-center rounded-[var(--radius-sm)] text-fg-muted transition-colors",
        "hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        active && "bg-accent-soft text-accent-soft-fg",
        "disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Sanitises editor output before it is written.
 *
 * Exported (rather than inlined at every call site) so the same rule applies to a future importer
 * or API client, and so a test can assert that nothing the toolbar produces is stripped.
 */
export function sanitizeEditorHtml(html: string): string {
  return sanitizeHtml(html);
}

export const RICH_TEXT_EXTENSIONS = ["bold", "italic", "underline", "strike", "code", "heading", "bulletList", "orderedList", "blockquote", "link"];

/** Memo helper for callers that only need the word count. */
export function useWordCount(html: string): number {
  return useMemo(() => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length, [html]);
}
