import { useId, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { FaqItem } from '@/types'

interface FaqAccordionProps {
  items: FaqItem[]
  /** Allows more than one panel to be open at once. */
  allowMultiple?: boolean
  defaultOpen?: number
}

export const FaqAccordion = ({ items, allowMultiple = false, defaultOpen }: FaqAccordionProps) => {
  const baseId = useId()
  const [open, setOpen] = useState<number[]>(defaultOpen === 0 ? [0] : defaultOpen ? [defaultOpen] : [])

  const toggle = (index: number) => {
    setOpen((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index)
      return allowMultiple ? [...current, index] : [index]
    })
  }

  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {items.map((item, index) => {
        const isOpen = open.includes(index)
        const buttonId = `${baseId}-trigger-${index}`
        const panelId = `${baseId}-panel-${index}`
        return (
          <div key={item.question}>
            <h3 className="m-0">
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
                className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-soft/70 sm:px-6 sm:py-5"
              >
                <span className="font-display text-[0.9375rem] font-bold leading-6 text-ink sm:text-base">
                  {item.question}
                </span>
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    isOpen
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line bg-surface text-muted'
                  }`}
                  aria-hidden="true"
                >
                  {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!isOpen}
              className="px-5 pb-5 sm:px-6 sm:pb-6"
            >
              <p className="max-w-3xl text-sm leading-7 text-muted">{item.answer}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
