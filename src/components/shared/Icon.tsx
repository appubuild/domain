import {
  ArrowRight,
  BookMarked,
  BookOpen,
  Brain,
  Calculator,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutTemplate,
  PenLine,
  PenTool,
  RefreshCw,
  Ruler,
  Settings2,
  Shapes,
  Sparkles,
  Store,
  Type,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  'pen-line': PenLine,
  'pen-tool': PenTool,
  layout: LayoutTemplate,
  layers: Layers,
  ruler: Ruler,
  type: Type,
  'book-marked': BookMarked,
  'book-open': BookOpen,
  sparkles: Sparkles,
  'refresh-cw': RefreshCw,
  wand: Wand2,
  image: ImageIcon,
  languages: Languages,
  brain: Brain,
  'settings-2': Settings2,
  'check-circle': CheckCircle2,
  download: Download,
  calculator: Calculator,
  store: Store,
  shapes: Shapes,
  'arrow-right': ArrowRight,
};

/** Renders a CMS-provided icon name, falling back to a neutral dot. */
export function Icon({ name, className }: { name?: string; className?: string }) {
  const Component = name ? ICONS[name] : undefined;
  if (!Component) {
    return (
      <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full bg-current', className)} />
    );
  }
  return <Component aria-hidden className={cn('h-5 w-5', className)} strokeWidth={1.75} />;
}
