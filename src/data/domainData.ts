import { SITE_CONFIG } from '../config';
import {
  BrandSpecItem,
  ChatPersona,
  MarketplaceConfigItem,
  UseCaseItem,
} from '../types/domain';

export const DOMAIN_PRICE_BIN = SITE_CONFIG.pricing.binPrice;
export const DOMAIN_MIN_OFFER = SITE_CONFIG.pricing.minOffer;

export const HERO_CHAT_PERSONAS: ChatPersona[] = [
  {
    id: 'ai-copilot',
    label: 'VigoAI Support Copilot',
    badge: 'Omnichannel AI',
    statusText: 'Neural Engine v4.2 • 38ms response',
    accentColor: 'from-indigo-500 to-cyan-400',
    initialMessages: [
      {
        id: 'm1',
        sender: 'user',
        authorName: 'Elena Vance',
        authorRole: 'Enterprise Customer',
        text: 'We need to migrate 45,000 active seats to our new SSO workspace before Friday without dropping live webhook events.',
        timestamp: '10:42 AM',
      },
      {
        id: 'm2',
        sender: 'ai',
        authorName: `${SITE_CONFIG.brandPrefix} AI`,
        authorRole: 'Autonomous Support Agent',
        text: 'Zero-downtime SSO migration plan staged! I have queued dual-write webhook buffering for all 45,000 seats and verified your SAML 2.0 metadata. Ready to execute?',
        timestamp: '10:42 AM',
        metrics: {
          latency: '42ms',
          confidence: '99.7% Match',
          tag: 'Auto-Resolved • CRM Synced',
        },
      },
    ],
    quickPrompts: [
      {
        prompt: `Why is ${SITE_CONFIG.displayDomain} a category-defining brand?`,
        aiReply: `${SITE_CONFIG.displayDomain} combines "Vigo" (Latin root for vigor, energy, life) with "Chat" — the #1 high-intent keyword in AI & SaaS. At just 8 letters and 3 punchy syllables (${SITE_CONFIG.phoneticSpelling}), it passes the radio test instantly and commands immediate enterprise trust.`,
        latency: '34ms',
        tag: 'Brand Intelligence',
      },
      {
        prompt: 'Execute zero-downtime SSO rollout now',
        aiReply:
          'Rollout initiated across 3 global edge regions (us-east, eu-central, ap-northeast). 45,000 seats migrated with 0 dropped packets. Audit log #VG-9921 pushed to your Slack & Datadog.',
        latency: '39ms',
        tag: 'Autonomous Action',
      },
      {
        prompt: 'Show live multilingual voice & chat metrics',
        aiReply:
          'Currently translating 142 concurrent voice & text streams across 28 languages at 99.4% CSAT. Average first-response latency is 0.18 seconds.',
        latency: '31ms',
        tag: 'Real-Time Telemetry',
      },
    ],
  },
  {
    id: 'web3-hub',
    label: 'Web3 & Token Community',
    badge: 'ZK-Verified Hub',
    statusText: '128,420 Peers Online • Mainnet Synced',
    accentColor: 'from-violet-500 to-fuchsia-400',
    initialMessages: [
      {
        id: 'w1',
        sender: 'user',
        authorName: '0xKai.eth',
        authorRole: 'Governance Delegate',
        text: `Proposal #84 just hit quorum! Can ${SITE_CONFIG.brandPrefix} open the token-gated Alpha Lounge for all stakers holding >500 VIGO?`,
        timestamp: '11:15 AM',
      },
      {
        id: 'w2',
        sender: 'ai',
        authorName: 'VigoGate Bot',
        authorRole: 'On-Chain Sentinel',
        text: 'Verified via zero-knowledge proof on L2. #alpha-lounge and Spatial Voice Room 01 are now unlocked for 4,812 verified holders—zero wallet signature spam required.',
        timestamp: '11:15 AM',
        metrics: {
          latency: '51ms',
          confidence: 'ZK-Proof Valid',
          tag: 'On-Chain Gated',
        },
      },
    ],
    quickPrompts: [
      {
        prompt: 'Launch encrypted spatial audio stage for DAO call',
        aiReply:
          'Spatial Audio Stage is live! 1,240 listeners connected with sub-40ms WebRTC mesh routing and live AI governance note-taking enabled.',
        latency: '44ms',
        tag: 'Spatial Voice',
      },
      {
        prompt: 'Verify smart contract treasury alert feed',
        aiReply:
          'Multi-sig watcher active. Real-time push alerts configured for transactions >$25k across Ethereum, Base, Arbitrum, and Solana.',
        latency: '37ms',
        tag: 'Chain Sentinel',
      },
    ],
  },
  {
    id: 'team-collab',
    label: 'Enterprise Team HQ',
    badge: 'E2EE Workspace',
    statusText: 'SOC2 Type II • Quantum-Resistant TLS',
    accentColor: 'from-cyan-500 to-emerald-400',
    initialMessages: [
      {
        id: 't1',
        sender: 'user',
        authorName: 'Marcus Chen',
        authorRole: 'VP Engineering',
        text: '@VigoAI summarize the 64 messages in #incident-prod-eu and draft the post-mortem action items for Jira.',
        timestamp: '02:04 PM',
      },
      {
        id: 't2',
        sender: 'ai',
        authorName: `${SITE_CONFIG.brandPrefix} Workspace AI`,
        authorRole: 'Executive Thread Synthesizer',
        text: 'Root cause: Redis connection pool saturation at 13:48 UTC. Fix deployed via PR #4102 in 6 minutes. I created 3 Jira tickets for connection pooling alerts and attached the timeline.',
        timestamp: '02:04 PM',
        metrics: {
          latency: '47ms',
          confidence: '64 Msgs Indexed',
          tag: 'Jira + GitHub Synced',
        },
      },
    ],
    quickPrompts: [
      {
        prompt: 'Generate Q4 product launch briefing from threads',
        aiReply:
          'Synthesized 14 channels: Design freeze is 100% complete, load testing passed 1.2M req/s, and GTM launch assets are approved for Tuesday 09:00 UTC.',
        latency: '49ms',
        tag: 'Executive Brief',
      },
      {
        prompt: 'Enable zero-knowledge ephemeral mode for #board-m&a',
        aiReply:
          'Ephemeral E2EE mode locked. Hardware-key attestation verified for all 9 board participants with auto-shred after 24 hours.',
        latency: '29ms',
        tag: 'Zero-Knowledge E2EE',
      },
    ],
  },
];

export const USE_CASES_DATA: UseCaseItem[] = [
  {
    id: 'ai-support',
    code: '01 / AI & CUSTOMER SUPPORT',
    title: 'AI & Customer Support Ecosystem',
    category: 'Automated Chatbots • CRM Sync • Omnichannel',
    tagline: 'Resolve 94%+ of customer inquiries autonomously in 40+ languages.',
    description: `Position ${SITE_CONFIG.displayDomain} as the next-generation challenger to Intercom, Zendesk, and Ada. Built for autonomous AI agents that don’t just answer questions—they execute refunds, update subscriptions, and sync bi-directionally with Salesforce, HubSpot, and Stripe.`,
    accentGradient: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    badgeText: 'High-CPC SaaS Category ($22.40 Avg CPC)',
    kpis: [
      { label: 'Autonomous Resolution', value: '94.8%', delta: '+38% vs Legacy' },
      { label: 'First Response Time', value: '0.18s', delta: 'Real-Time Stream' },
      { label: 'CSAT Score', value: '99.2%', delta: 'Verified Enterprise' },
    ],
    features: [
      'Autonomous RAG agents with zero-hallucination guardrails',
      '1-Click CRM actions (Stripe, Shopify, Salesforce, Linear)',
      'Unified inbox across Web, WhatsApp, iOS, Android & Voice',
      'Instant sentiment escalation to human specialists',
    ],
    interactiveDemoTitle: 'Live Autonomous Ticket Resolution Simulator',
  },
  {
    id: 'social-web3',
    code: '02 / SOCIAL & COMMUNITY HUBS',
    title: 'Social & Web3 Community Hubs',
    category: 'Next-Gen Discord / Telegram Alternative',
    tagline: 'Token-gated guilds, spatial audio stages, and sovereign social graphs.',
    description: `${SITE_CONFIG.brandPrefix} rolls off the tongue as an iconic consumer or Web3 super-app. Ideal for high-velocity creator communities, crypto DAOs, trading floors, and private social networks requiring zero-knowledge authentication and native micro-tipping.`,
    accentGradient: 'from-violet-500/20 via-fuchsia-500/5 to-transparent',
    badgeText: 'Viral Consumer & Web3 Fit',
    kpis: [
      { label: 'Concurrent Stage Peers', value: '250K+', delta: 'Edge Mesh Audio' },
      { label: 'Bot & Sybil Spam', value: '0.00%', delta: 'ZK-Proof Gated' },
      { label: 'Community Retention', value: '89.4%', delta: '30-Day Active' },
    ],
    features: [
      'Zero-knowledge wallet & passkey verification without gas fees',
      'Ultra-low-latency spatial voice lounges & 4K screen sharing',
      'In-chat mini-apps, prediction markets, and instant global payouts',
      'AI community moderators that stop phishing links in <10ms',
    ],
    interactiveDemoTitle: 'Live Spatial Voice & Token-Gated Lounge',
  },
  {
    id: 'team-collab',
    code: '03 / TEAM COLLABORATION',
    title: 'High-Security Team Collaboration',
    category: 'Enterprise Slack & Teams Challenger',
    tagline: 'Where mission-critical engineering and executive teams move faster.',
    description: `Give enterprise buyers immediate confidence with a crisp, authoritative .com brand. ${SITE_CONFIG.brandPrefix} powers AI-native workplace messaging where long threads summarize themselves, meetings turn into Jira tickets, and every message is protected by end-to-end encryption.`,
    accentGradient: 'from-cyan-500/20 via-sky-500/5 to-transparent',
    badgeText: 'Enterprise B2B Authority',
    kpis: [
      { label: 'Time Saved / Engineer', value: '6.4 hrs/wk', delta: 'AI Thread Recap' },
      { label: 'Encryption Standard', value: 'MLS E2EE', delta: 'Post-Quantum' },
      { label: 'Global Uptime SLA', value: '99.999%', delta: 'Multi-Region' },
    ],
    features: [
      '1-Click AI executive thread summarization & action extraction',
      'Native GitHub, GitLab, Jira, Linear, and PagerDuty command center',
      'Self-hosted or Sovereign Cloud deployment for regulated industries',
      'Async video huddles with searchable AI transcripts',
    ],
    interactiveDemoTitle: 'AI Thread Synthesizer & DevOps Command Center',
  },
  {
    id: 'telehealth',
    code: '04 / TELEHEALTH & LIVE VIDEO',
    title: 'Telehealth, Live Video & Voice',
    category: 'HIPAA-Ready Encrypted Video & Clinical Chat',
    tagline: 'Crystal-clear encrypted video consultations with ambient AI charting.',
    description: `"Vigo" evokes vitality, health, and vigor—making ${SITE_CONFIG.displayDomain} a natural powerhouse for digital health, telemedicine platforms, remote patient monitoring, and high-trust financial advisory video portals.`,
    accentGradient: 'from-emerald-500/20 via-teal-500/5 to-transparent',
    badgeText: 'Healthcare & FinTech Ready',
    kpis: [
      { label: 'WebRTC Video Latency', value: '34ms', delta: '4K60 Adaptive' },
      { label: 'Clinical Note Time', value: '-78%', delta: 'Ambient AI Scribe' },
      { label: 'Compliance Architecture', value: 'HIPAA / GDPR', delta: 'Zero-Storage' },
    ],
    features: [
      'Browser-native 4K encrypted video calls with zero app downloads',
      'Real-time voice translation & live captions across 35+ languages',
      'Ambient AI clinical scribe that drafts SOAP notes automatically',
      'Biometric patient intake & encrypted diagnostic file transfer',
    ],
    interactiveDemoTitle: 'Encrypted HD Telehealth & Live AI Scribe',
  },
];

export const BRAND_SPECS_MATRIX: BrandSpecItem[] = [
  {
    id: 'tld',
    label: 'EXTENSION AUTHORITY',
    title: 'Top-Tier Global .COM',
    highlightValue: '.COM',
    description:
      'The undisputed gold standard of global business. Over 92% of unicorn SaaS companies and Fortune 500 enterprises operate on an exact-match .com domain.',
    subMetrics: [
      '100% Direct Type-In Trust',
      'No Traffic Leakage to Competitors',
      'Global Investor Recognition',
    ],
    accent: 'indigo',
  },
  {
    id: 'pronunciation',
    label: 'PHONETIC PRECISION',
    title: '3 Syllables, Punchy & Memorable',
    highlightValue: SITE_CONFIG.phoneticSpelling,
    description:
      'Passes the "Radio & Podcast Test" on the first listen. Derived from "Vigor" (energy, vitality, speed) + "Chat" (universal communication). Easy to spell in every major language.',
    subMetrics: [
      '8 Letters Total Length',
      `Phonetic: ${SITE_CONFIG.ipaPronunciation}`,
      'Zero Spelling Ambiguity',
    ],
    accent: 'violet',
  },
  {
    id: 'history',
    label: 'REPUTATION & TRUST',
    title: 'Clean History & Instant Launch',
    highlightValue: '0 Spam Flags',
    description:
      'Verified clean historical profile across Google Safe Browsing, Spamhaus, and email deliverability registries. Launch your product and transactional emails on Day 1 without penalty.',
    subMetrics: [
      'Clean DNS & WHOIS Provenance',
      'High Inbox Deliverability Score',
      'Zero Trademark Conflicts',
    ],
    accent: 'emerald',
  },
  {
    id: 'market-fit',
    label: 'ORGANIC SEO & CPC POWER',
    title: 'High-CPC Category Keyword',
    highlightValue: '$18.40+ CPC',
    description:
      'Contains the exact high-intent root keyword "Chat" alongside a distinctive brand prefix. Built for instant semantic relevance in AI, Customer Support, and Messaging search queries.',
    subMetrics: [
      'Exact-Match "Chat" Anchor',
      'Ready for Instant Indexing',
      'High Click-Through Authority',
    ],
    accent: 'cyan',
  },
  {
    id: 'transfer',
    label: 'ACQUISITION SECURITY',
    title: 'Fast Certified Escrow Transfer',
    highlightValue: '< 24 Hours',
    description:
      'Seamless registrar push or EPP auth-code transfer protected 100% by Escrow.com, Dan, or your preferred verified marketplace. Funds are only released after you confirm full domain control.',
    subMetrics: [
      '100% Buyer Protection Guarantee',
      'Instant DNS Delegation for Lease',
      'Corporate Invoice & Bill of Sale',
    ],
    accent: 'amber',
  },
];

export const COMPARABLE_DOMAIN_BENCHMARKS = [
  {
    domain: 'Chat.com',
    category: 'Category Generic',
    reportedValuation: '$15,500,000+',
    insight: 'Acquired by OpenAI — proves massive strategic value of the "Chat" keyword.',
  },
  {
    domain: 'ManyChat.com',
    category: '8-Letter Brand + Chat',
    reportedValuation: '$140M+ SaaS Brand',
    insight: 'Identical 8-letter [Prefix] + [Chat].com structure powering a global SaaS leader.',
  },
  {
    domain: 'LiveChat.com',
    category: '8-Letter Compound .com',
    reportedValuation: '$300M+ Public Co',
    insight: 'Demonstrates how an 8-letter .com becomes a permanent moat in customer support.',
  },
  {
    domain: SITE_CONFIG.displayDomain,
    category: '8-Letter Brandable .com',
    reportedValuation: `$${SITE_CONFIG.pricing.binPrice.toLocaleString()} BIN / Offer`,
    insight: 'Available today for a fraction of Series-A rebranding costs—with lease-to-own flexibility.',
    highlight: true,
  },
];

export const MARKETPLACE_LISTINGS: MarketplaceConfigItem[] = Object.values(
  SITE_CONFIG.marketplaces
);

export const FAQ_ITEMS = [
  {
    question:
      'How does the domain transfer process work and how is my payment protected?',
    answer: `Every transaction is 100% protected through a licensed escrow service (Escrow.com, Dan, Atom, GoDaddy/Afternic, or Sedo). Once you initiate purchase or your offer is accepted, your funds are held securely in escrow. We then push ${SITE_CONFIG.displayDomain} directly to your registrar account (or provide the EPP transfer authorization code). The escrow provider only releases funds to the seller after verifying that you have full, sole ownership and control of the domain.`,
  },
  {
    question: `Can we use ${SITE_CONFIG.displayDomain} immediately if we choose the Lease-to-Own plan?`,
    answer: `Yes! With our Lease-to-Own structure, you gain full DNS nameserver control immediately upon your first monthly payment. You can launch your website, configure corporate email (@${SITE_CONFIG.domainName}), and build your brand right away while spreading the acquisition cost over 6 to 24 months. Upon final payment, full registrar ownership transfers automatically to your account.`,
  },
  {
    question: `What is included with the acquisition of ${SITE_CONFIG.displayDomain}?`,
    answer: `You receive 100% unencumbered ownership rights to the ${SITE_CONFIG.displayDomain} domain name, an official corporate Bill of Sale & tax invoice, the custom SVG vector logo/monogram suite shown on this page, and complimentary technical assistance during DNS/registrar migration.`,
  },
  {
    question:
      'Are you open to reasonable offers or startup equity + cash structures?',
    answer: `Yes. While our Buy-It-Now (BIN) price of $${SITE_CONFIG.pricing.binPrice.toLocaleString()} ${SITE_CONFIG.pricing.currency} guarantees immediate acquisition, we actively review serious cash offers from founders, domain investors, and venture-backed startups. You can submit an offer directly via the Quick Offer Modal, WhatsApp, or Email and receive a response within 2 business hours.`,
  },
];
