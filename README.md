# VigoChat.com — Premium Domain Acquisition & Interactive SaaS Demo Landing Page

An ultra-modern, high-converting SaaS demo and premium domain acquisition funnel built for **[VigoChat.com](https://vigochat.com)**.

## Core Objectives

1. **Interactive VigoChat Product Showcase**: Demonstrates what **VigoChat.com** can power across AI Customer Support, Web3 & Social Community Hubs, Enterprise Team Collaboration, and Encrypted Telehealth / Live Video.
2. **High-Converting Domain Sales Funnel**: Showcases the linguistic, SEO, and valuation power of an 8-letter, 3-syllable (`Vi-go-Chat`) `.com` domain with direct Escrow.com checkout, Lease-to-Own calculator, verified marketplace badges (Atom/Squadhelp, GoDaddy, Afternic, Sedo), and an interactive Lead Generation & Offer Modal.

---

## Tech Stack

- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS (Dark Obsidian SaaS theme, Indigo/Violet/Cyan ambient mesh glows, Glassmorphism cards, Plus Jakarta Sans & JetBrains Mono typography)
- **Icons**: Lucide React (`lucide-react`)
- **Animations**: Framer Motion (`framer-motion`)
- **Assets & SEO**:
  - Custom SVG Favicon (`public/favicon.svg` — Chat Bubble + Lightning Bolt V-Monogram)
  - Custom OpenGraph Social Preview Card (`public/og-vigochat.svg`)
  - Full OpenGraph, Twitter Card, Canonical, and `Product` / `AggregateOffer` JSON-LD Structured Data in `index.html`

---

## Modular Component Architecture

- `src/components/AnnouncementBar.tsx` — Top sticky announcement bar with live availability status and instant `"Make an Offer"` modal trigger.
- `src/components/Navbar.tsx` — Sticky glassmorphic navigation bar with Web Speech API `"Hear Vi-go-Chat"` pronunciation button and section links.
- `src/components/HeroSection.tsx` — High-impact brand hook, 4-pillar domain spec cards, dual CTAs, and the embedded interactive chat widget.
- `src/components/InteractiveChatWidget.tsx` — Live multi-persona AI chat simulator (`VigoAI Support Copilot`, `Web3 & Token Community`, `Enterprise Team HQ`) with typing indicators, quick-prompt pills, custom user message input, and telemetry HUD.
- `src/components/UseCaseShowcase.tsx` — Filterable Tabs + 4-Industry Bento Grid (`AI & Customer Support`, `Social & Community Hubs`, `Team Collaboration`, `Telehealth / Live Video & Voice`) with interactive micro-simulators inside every card.
- `src/components/BrandPowerMatrix.tsx` — 5-card Domain Valuation & Brand Power Matrix (`.COM` TLD, `Vi-go-Chat` Radio Test with audio playback, Clean History, High-CPC Market Fit, `<24h` Escrow Transfer) + Market Comparable Benchmarks.
- `src/components/AcquisitionSection.tsx` — Flexible Deal Structures (`Outright Purchase`, interactive `Lease-to-Own` monthly calculator, `Investor Inquiry`), Verified Marketplace Badges (`Atom`, `GoDaddy`, `Afternic`, `Sedo`, `Escrow.com`), and 4-step Escrow timeline.
- `src/components/AcquisitionModal.tsx` — Triggerable via any CTA button, 10-second delayed preview timer, or exit-intent; includes pre-filled WhatsApp trigger, direct `mailto:` & 1-click email copy, and an interactive Quick Offer Form.
- `src/components/FaqSection.tsx` & `src/components/Footer.tsx` — Buyer FAQ accordion, Escrow/SSL/ICANN trust badges, and legal disclaimer.

---

## Running Locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
