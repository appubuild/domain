export type ThemeMode = 'dark' | 'light';

export type DealStructureType = 'outright' | 'lease' | 'investor';

export type MarketplaceId =
  | 'escrow'
  | 'dan'
  | 'atom'
  | 'godaddy'
  | 'afternic'
  | 'sedo';

export interface ModalTriggerContext {
  isOpen: boolean;
  dealType?: DealStructureType;
  prefilledOffer?: string;
  preferredMarketplace?: MarketplaceId;
  sourceLabel?: string;
}

export interface LeadOfferPayload {
  domainName: string;
  fullName: string;
  email: string;
  offerAmount: string;
  dealType: DealStructureType;
  preferredMarketplace: MarketplaceId;
  message: string;
  timestamp: string;
  sourceLabel: string;
  referenceId: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  authorName: string;
  authorRole?: string;
  text: string;
  timestamp: string;
  metrics?: {
    latency?: string;
    confidence?: string;
    tag?: string;
  };
}

export interface ChatPersona {
  id: string;
  label: string;
  badge: string;
  statusText: string;
  accentColor: string;
  initialMessages: ChatMessage[];
  quickPrompts: {
    prompt: string;
    aiReply: string;
    latency: string;
    tag: string;
  }[];
}

export interface UseCaseItem {
  id: 'ai-support' | 'social-web3' | 'team-collab' | 'telehealth';
  code: string;
  title: string;
  category: string;
  tagline: string;
  description: string;
  accentGradient: string;
  badgeText: string;
  kpis: {
    label: string;
    value: string;
    delta: string;
  }[];
  features: string[];
  interactiveDemoTitle: string;
}

export interface BrandSpecItem {
  id: string;
  label: string;
  title: string;
  highlightValue: string;
  description: string;
  subMetrics: string[];
  accent: 'indigo' | 'violet' | 'cyan' | 'emerald' | 'amber';
}

export interface MarketplaceConfigItem {
  id: MarketplaceId;
  name: string;
  shortName: string;
  subtitle: string;
  badge: string;
  protectionText: string;
  transferSpeed: string;
  feeNote: string;
  url: string;
  accent: string;
  featured?: boolean;
}
