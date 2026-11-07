import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CallSheet } from './CallSheet'

export interface CallSheetRequest {
  /** Open straight to one service's numbers, or omit for the service picker. */
  serviceSlug?: string
}

interface CallSheetContextValue {
  open: (request?: CallSheetRequest) => void
  close: () => void
  isOpen: boolean
}

const CallSheetContext = createContext<CallSheetContextValue | null>(null)

/**
 * One shared "Call Now" sheet for the whole site.
 *
 * Phone numbers are never printed in page markup before a service is chosen:
 * the sheet opens on a service picker, and only the chosen service's primary and
 * alternate numbers are rendered.
 */
export const CallSheetProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [serviceSlug, setServiceSlug] = useState('')

  const open = useCallback((request?: CallSheetRequest) => {
    setServiceSlug(request?.serviceSlug ?? '')
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen])

  return (
    <CallSheetContext.Provider value={value}>
      {children}
      <CallSheet isOpen={isOpen} onClose={close} initialServiceSlug={serviceSlug} />
    </CallSheetContext.Provider>
  )
}

export const useCallSheet = (): CallSheetContextValue => {
  const context = useContext(CallSheetContext)
  if (!context) throw new Error('useCallSheet must be used inside CallSheetProvider')
  return context
}
