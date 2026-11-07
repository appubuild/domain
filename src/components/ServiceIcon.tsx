import {
  AppWindow,
  Bath,
  Bed,
  Bug,
  ChefHat,
  DoorOpen,
  Droplets,
  House,
  KeyRound,
  Layers,
  Snowflake,
  Waves,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Maps the `icon` string in services.ts to a Lucide component. */
const ICONS: Record<string, LucideIcon> = {
  home: House,
  wrench: Wrench,
  droplets: Droplets,
  wind: Wind,
  snowflake: Snowflake,
  bug: Bug,
  waves: Waves,
  zap: Zap,
  'chef-hat': ChefHat,
  bath: Bath,
  bed: Bed,
  'app-window': AppWindow,
  'door-open': DoorOpen,
  layers: Layers,
  'key-round': KeyRound,
}

interface ServiceIconProps {
  name: string
  className?: string
  strokeWidth?: number
}

export const ServiceIcon = ({ name, className = 'h-5 w-5', strokeWidth = 1.75 }: ServiceIconProps) => {
  const Icon = ICONS[name] ?? Wrench
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}
