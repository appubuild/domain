/**
 * Media library dialog used by the blog/page editors.
 *
 * Lists uploaded images (plus the bundled article illustrations), supports
 * upload from disk, and returns the chosen public path. SVG uploads are
 * rejected by the API on purpose — an SVG can carry script — so the article
 * illustrations ship as static assets and only raster images can be uploaded
 * here.
 */
import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, Upload } from 'lucide-react'
import { Button, Input, Modal, cn } from '@/admin/components/ui'
import { contentApi, type MediaAsset } from '@/admin/data/contentApi'
import { useToast } from '@/admin/context/ToastContext'

interface MediaPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (asset: { path: string; altText: string }) => void
  title?: string
}

export const MediaPicker = ({ open, onClose, onSelect, title = 'Media library' }: MediaPickerProps) => {
  const toast = useToast()
  const [items, setItems] = useState<MediaAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    contentApi
      .listMedia(1, 60)
      .then((result) => setItems(result.items))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The media library could not be loaded.'))
      .finally(() => setLoading(false))
  }, [open])

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setUploading(true)
    try {
      const asset = await contentApi.uploadMedia(file)
      setItems((current) => [asset, ...current])
      toast.success('Image uploaded', asset.filename)
    } catch (cause) {
      toast.error('Upload failed', cause instanceof Error ? cause.message : 'Try a JPG, PNG or WebP under 5 MB.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Pick an image for the content, or paste a path from the site."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="/images/blog/example.svg"
              aria-label="Image path"
            />
            <Button
              variant="secondary"
              onClick={() => {
                if (!manualPath.trim()) return
                onSelect({ path: manualPath.trim(), altText: '' })
                onClose()
              }}
            >
              Use path
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-soft/60 px-4 py-3">
          <p className="text-xs text-muted">JPG, PNG, WebP or AVIF · up to 5 MB. SVGs are shipped with the build.</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            className="hidden"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="secondary"
            iconLeft={uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            Upload
          </Button>
        </div>

        {error ? <p className="text-xs text-rose-600">{error}</p> : null}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted">Loading media…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ImageIcon className="h-6 w-6 text-muted" />
            <p className="text-sm font-medium text-ink">Nothing uploaded yet</p>
            <p className="text-xs text-muted">Upload an image or paste a path such as /images/blog/article-01.svg.</p>
          </div>
        ) : (
          <ul className="grid max-h-[46vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
            {items.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect({ path: asset.path, altText: asset.altText })
                    onClose()
                  }}
                  className={cn(
                    'group w-full overflow-hidden rounded-xl border border-line bg-surface text-left transition',
                    'hover:border-brand-300 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  )}
                >
                  <span className="block aspect-[4/3] overflow-hidden bg-soft">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.path}
                      alt={asset.altText || asset.filename}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-[11px] text-muted">{asset.filename}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default MediaPicker
