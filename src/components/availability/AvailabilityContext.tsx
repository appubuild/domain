import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AvailabilityModal } from './AvailabilityModal'

export interface AvailabilityRequest {
  serviceSlug?: string
  zip?: string
}

interface AvailabilityContextValue {
  open: (request?: AvailabilityRequest) => void
  close: () => void
  isOpen: boolean
  activeServiceSlug: string
  activeZip: string
}

const AvailabilityContext = createContext<AvailabilityContextValue | null>(null)

export const AvailabilityProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [serviceSlug, setServiceSlug] = useState('')
  const [zip, setZip] = useState('')

  const open = useCallback((request?: AvailabilityRequest) => {
    setServiceSlug(request?.serviceSlug ?? '')
    setZip(request?.zip ?? '')
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(
    () => ({ open, close, isOpen, activeServiceSlug: serviceSlug, activeZip: zip }),
    [open, close, isOpen, serviceSlug, zip],
  )

  return (
    <AvailabilityContext.Provider value={value}>
      {children}
      <AvailabilityModal
        isOpen={isOpen}
        onClose={close}
        initialServiceSlug={serviceSlug}
        initialZip={zip}
      />
    </AvailabilityContext.Provider>
  )
}

export const useAvailability = (): AvailabilityContextValue => {
  const context = useContext(AvailabilityContext)
  if (!context) throw new Error('useAvailability must be used inside AvailabilityProvider')
  return context
}
