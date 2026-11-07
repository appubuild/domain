import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Phone, X } from 'lucide-react'
import { CALL_DIRECTORY_CATEGORIES, getGroupsForService, getPhoneGroup } from '@/data/serviceNumberMapping'
import { ServiceIcon } from '@/components/ServiceIcon'
import { CallConnectionPanel } from './CallConnectionPanel'
import { servicePath } from '@/config/services'

interface CallSheetProps {
  isOpen: boolean
  onClose: () => void
  initialServiceSlug?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The site's only phone dialog.
 *
 * Step 1 — pick a service (no numbers are rendered here).
 * Step 2 — that service's published call connections: "Call Now" for the
 * primary line and "Call Alternate" for the second one, each its own tel: link.
 */
export const CallSheet = ({ isOpen, onClose, initialServiceSlug = '' }: CallSheetProps) => {
  const [serviceSlug, setServiceSlug] = useState(initialServiceSlug)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setServiceSlug(initialServiceSlug || '')
    triggerRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }, 40)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      const trigger = triggerRef.current
      if (trigger instanceof HTMLElement) trigger.focus()
    }
  }, [isOpen, initialServiceSlug, onClose])

  if (!isOpen) return null

  // Accepts a directory group id ("roofing") or a website service slug
  // ("roof-repair") and resolves it to the group that owns the numbers.
  const resolvedGroupId = getPhoneGroup(serviceSlug)
    ? serviceSlug
    : (getGroupsForService(serviceSlug)[0]?.id ?? '')
  const selected = CALL_DIRECTORY_CATEGORIES.find((category) => category.groupId === resolvedGroupId)
  const selectedName = selected?.label ?? getPhoneGroup(resolvedGroupId)?.name ?? ''
  const selectedGroupId = resolvedGroupId

  const dialog = (
    <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close call options"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default bg-navy-950/60 backdrop-blur-sm animate-fade-in"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-sheet-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-line bg-elevated shadow-float animate-scale-in sm:max-h-[88dvh] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-300">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              Call a service line
            </p>
            <h2 id="call-sheet-title" className="mt-1 font-display text-lg font-extrabold text-ink sm:text-xl">
              {selectedName || 'Choose the service you need'}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              {selectedName
                ? 'Tap a button to dial the number directly from your phone.'
                : 'Select a service to reveal its call connections.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-soft hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {selectedName ? (
            <>
              <CallConnectionPanel
                serviceSlug={selectedGroupId}
                serviceName={selectedName}
                embedded
              />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setServiceSlug('')}
                  className="btn-secondary btn-sm"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Choose another service
                </button>
                {selected?.serviceSlug ? (
                  <Link
                    to={servicePath(selected.serviceSlug)}
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
                  >
                    Read about {selected.label.toLowerCase()}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            </>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {CALL_DIRECTORY_CATEGORIES.map((category) => (
                <li key={category.groupId}>
                  <button
                    type="button"
                    onClick={() => setServiceSlug(category.groupId)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      <ServiceIcon name={category.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-sm font-bold text-ink">{category.label}</span>
                      <span className="mt-0.5 block truncate text-2xs text-muted">{category.blurb}</span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return dialog
  return createPortal(dialog, document.body)
}
