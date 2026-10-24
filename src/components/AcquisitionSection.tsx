import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  CreditCard,
  CalendarClock,
  Briefcase,
  CheckCircle2,
  ArrowUpRight,
  Lock,
  Sparkles,
  Building2,
  BadgeCheck,
  Handshake,
} from 'lucide-react';
import { DOMAIN_PRICE_BIN, MARKETPLACE_LISTINGS } from '../data/domainData';
import { DealStructureType, MarketplaceId } from '../types/domain';

interface AcquisitionSectionProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    preferredMarketplace?: MarketplaceId;
    sourceLabel?: string;
  }) => void;
}

export const AcquisitionSection: React.FC<AcquisitionSectionProps> = ({
  onOpenModal,
}) => {
  const [leaseMonths, setLeaseMonths] = useState<number>(24);
  const [selectedDealCard, setSelectedDealCard] =
    useState<DealStructureType>('outright');

  const monthlyPayment = Math.round(DOMAIN_PRICE_BIN / leaseMonths);

  const marketplaceBadges: {
    id: MarketplaceId;
    name: string;
    tag: string;
    desc: string;
    accent: string;
  }[] = [
    {
      id: 'atom',
      name: 'Atom (Squadhelp)',
      tag: 'Verified Brand Listing',
      desc: 'Instant card/wire checkout + LTO protection',
      accent: 'from-indigo-500/20 to-violet-500/10 border-indigo-500/40',
    },
    {
      id: 'godaddy',
      name: 'GoDaddy',
      tag: 'Fast Transfer Enabled',
      desc: 'Instant push to your GoDaddy account',
      accent: 'from-cyan-500/20 to-sky-500/10 border-cyan-500/40',
    },
    {
      id: 'afternic',
      name: 'Afternic',
      tag: 'Global DLS Network',
      desc: '100+ partner registrar fast transfer',
      accent: 'from-violet-500/20 to-fuchsia-500/10 border-violet-500/40',
    },
    {
      id: 'sedo',
      name: 'Sedo',
      tag: 'EU & Global Escrow',
      desc: 'Multi-currency USD / EUR / GBP wire & VAT',
      accent: 'from-amber-500/20 to-orange-500/10 border-amber-500/40',
    },
  ];

  return (
    <section
      id="acquire"
      className="relative py-20 lg:py-28 border-t border-slate-800/80 bg-[#050711]"
    >
      {/* Ambient Glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-indigo-600/12 rounded-full blur-[150px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Certified Escrow &amp; Flexible Deal Structures</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
            Acquire <span className="text-gradient-vigo">VigoChat.com</span> on
            Your Terms
          </h2>
          <p className="text-slate-400 text-base sm:text-lg leading-relaxed">
            Choose between an immediate outright acquisition, a cash-flow
            friendly monthly Lease-to-Own plan with instant DNS access, or a
            custom investor offer—all 100% protected by certified domain escrow.
          </p>
        </div>

        {/* 3 Flexible Deal Structure Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 mb-14">
          {/* Card 1: Outright Purchase */}
          <motion.div
            whileHover={{ y: -4 }}
            onClick={() => setSelectedDealCard('outright')}
            className={`cursor-pointer rounded-3xl glass-card p-7 flex flex-col justify-between relative overflow-hidden transition-all ${
              selectedDealCard === 'outright'
                ? 'glow-border-indigo border-indigo-400/60'
                : 'border-slate-800 hover:border-indigo-500/40'
            }`}
          >
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" />

            <div>
              <div className="flex items-center justify-between gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                  <CreditCard className="w-3.5 h-3.5 text-cyan-300" />
                  Outright Purchase
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Save 15% Direct
                </span>
              </div>

              <h3 className="font-display text-2xl font-bold text-white mb-1">
                Buy It Now (Full Ownership)
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Immediate 100% title transfer via Escrow.com, Dan, or Sedo.
              </p>

              <div className="p-4 rounded-2xl bg-[#070A18] border border-slate-800/90 mb-5">
                <div className="text-xs font-mono text-slate-400">
                  BUY-IT-NOW VALUATION
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-3xl sm:text-4xl font-extrabold text-white">
                    ${DOMAIN_PRICE_BIN.toLocaleString()}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    USD One-Time
                  </span>
                </div>
                <div className="mt-2 text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  0% Buyer Escrow Fee on Direct Offer
                </div>
              </div>

              <ul className="space-y-2.5 text-xs sm:text-sm text-slate-300 mb-6">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Instant Registrar Push or Auth-Code handover in &lt;24h
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Includes official corporate Bill of Sale &amp; Tax Invoice
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Includes custom SVG brand monogram &amp; design assets
                  </span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenModal({
                  dealType: 'outright',
                  prefilledOffer: String(DOMAIN_PRICE_BIN),
                  preferredMarketplace: 'escrow',
                  sourceLabel: 'Outright Purchase Card ($24,800 BIN)',
                });
              }}
              className="w-full py-3.5 px-5 rounded-2xl font-bold text-sm text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition-all"
            >
              <span>Acquire Outright via Escrow</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </motion.div>

          {/* Card 2: Interactive Lease-to-Own */}
          <motion.div
            whileHover={{ y: -4 }}
            onClick={() => setSelectedDealCard('lease')}
            className={`cursor-pointer rounded-3xl glass-card p-7 flex flex-col justify-between relative overflow-hidden transition-all ${
              selectedDealCard === 'lease'
                ? 'glow-border-cyan border-cyan-400/60'
                : 'border-slate-800 hover:border-cyan-500/40'
            }`}
          >
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400" />

            <div>
              <div className="flex items-center justify-between gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">
                  <CalendarClock className="w-3.5 h-3.5 text-cyan-300" />
                  Lease-to-Own
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                  Startup Favorite
                </span>
              </div>

              <h3 className="font-display text-2xl font-bold text-white mb-1">
                Flexible Monthly Installments
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Launch on VigoChat.com today while preserving your seed runway.
              </p>

              {/* Dynamic Monthly Calculator Box */}
              <div className="p-4 rounded-2xl bg-[#070A18] border border-cyan-500/30 mb-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs font-mono text-slate-400">
                      ESTIMATED MONTHLY
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="font-mono text-3xl sm:text-4xl font-extrabold text-cyan-300">
                        ${monthlyPayment.toLocaleString()}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        / month
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs text-slate-400">TERM</div>
                    <div className="text-base font-bold text-white">
                      {leaseMonths} Months
                    </div>
                  </div>
                </div>

                {/* Term Selector Buttons */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Select Lease Term:</span>
                    <span className="text-emerald-400">0% Interest Plan</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[6, 12, 18, 24].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeaseMonths(m);
                          setSelectedDealCard('lease');
                        }}
                        className={`py-1.5 rounded-lg text-xs font-mono font-bold border transition-all ${
                          leaseMonths === m
                            ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-sm'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500/50'
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <ul className="space-y-2.5 text-xs sm:text-sm text-slate-300 mb-6">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Immediate DNS Control</strong>{' '}
                    after 1st payment (launch site &amp; email Day 1)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span>
                    100% of payments apply toward full domain ownership
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Cancel anytime or pay off early with zero penalty
                  </span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenModal({
                  dealType: 'lease',
                  prefilledOffer: `${monthlyPayment}/mo (${leaseMonths} mos)`,
                  preferredMarketplace: 'escrow',
                  sourceLabel: `Lease-to-Own (${leaseMonths} Months @ $${monthlyPayment}/mo)`,
                });
              }}
              className="w-full py-3.5 px-5 rounded-2xl font-bold text-sm text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all"
            >
              <span>Start Lease-to-Own (${monthlyPayment}/mo)</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </motion.div>

          {/* Card 3: Investor Inquiry / Custom Offer */}
          <motion.div
            whileHover={{ y: -4 }}
            onClick={() => setSelectedDealCard('investor')}
            className={`cursor-pointer rounded-3xl glass-card p-7 flex flex-col justify-between relative overflow-hidden transition-all ${
              selectedDealCard === 'investor'
                ? 'glow-border-indigo border-violet-400/60'
                : 'border-slate-800 hover:border-violet-500/40'
            }`}
          >
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500" />

            <div>
              <div className="flex items-center justify-between gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-violet-500/20 text-violet-200 border border-violet-400/30">
                  <Briefcase className="w-3.5 h-3.5 text-violet-300" />
                  Investor Inquiry
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  Direct Negotiation
                </span>
              </div>

              <h3 className="font-display text-2xl font-bold text-white mb-1">
                Make a Custom Offer
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Tailored for domain funds, startup studios, and VC-backed
                founders.
              </p>

              <div className="p-4 rounded-2xl bg-[#070A18] border border-slate-800/90 mb-5">
                <div className="text-xs font-mono text-slate-400">
                  RESERVE / OFFER FLOOR
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-3xl sm:text-4xl font-extrabold text-white">
                    Make Offer
                  </span>
                </div>
                <div className="mt-2 text-[11px] font-mono text-violet-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Direct Seller Response in &lt; 2 Hours
                </div>
              </div>

              <ul className="space-y-2.5 text-xs sm:text-sm text-slate-300 mb-6">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Direct negotiation with asset owner (no broker markup)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                  <span>
                    Cash + Equity hybrid considered for accredited AI startups
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
                  <span>
                    NDA &amp; custom escrow closing terms supported
                  </span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenModal({
                  dealType: 'investor',
                  prefilledOffer: '18500',
                  preferredMarketplace: 'escrow',
                  sourceLabel: 'Investor Inquiry / Make Custom Offer Card',
                });
              }}
              className="w-full py-3.5 px-5 rounded-2xl font-bold text-sm text-white bg-slate-900 hover:bg-violet-950/80 border border-violet-500/40 hover:border-violet-400 flex items-center justify-center gap-2 transition-all"
            >
              <span>Submit Custom Offer / Inquiry</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </motion.div>
        </div>

        {/* Verified Marketplace Listings & Direct Escrow Banner */}
        <div className="rounded-3xl glass-card p-6 sm:p-8 lg:p-10 border border-indigo-500/25 space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-300 uppercase tracking-wider mb-1">
                <BadgeCheck className="w-4 h-4 text-emerald-400" />
                <span>Verified Multi-Marketplace Availability</span>
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-white">
                Checkout via Your Preferred Domain Marketplace or Direct Escrow
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Select any verified marketplace below to initiate acquisition or
                lock in the lowest price directly through{' '}
                <strong className="text-slate-200">Escrow.com</strong>.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenModal({
                  dealType: 'outright',
                  prefilledOffer: String(DOMAIN_PRICE_BIN),
                  preferredMarketplace: 'escrow',
                  sourceLabel: 'Direct Escrow.com Priority Button',
                })
              }
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 shadow-lg shadow-emerald-500/20 whitespace-nowrap transition-all"
            >
              <Lock className="w-4 h-4" />
              <span>Direct Escrow.com (0% Markup)</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          {/* 4 Verified Marketplace Placeholder Badge Buttons (Atom / Squadhelp, GoDaddy, Afternic, Sedo) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {marketplaceBadges.map((mp) => (
              <button
                key={mp.id}
                type="button"
                onClick={() =>
                  onOpenModal({
                    dealType: 'outright',
                    prefilledOffer: String(DOMAIN_PRICE_BIN),
                    preferredMarketplace: mp.id,
                    sourceLabel: `Verified Marketplace Badge: ${mp.name}`,
                  })
                }
                className={`text-left p-5 rounded-2xl bg-gradient-to-br ${mp.accent} border hover:scale-[1.02] active:scale-[0.99] transition-all group flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase bg-slate-950/80 text-cyan-300 border border-slate-700/80">
                      {mp.tag}
                    </span>
                    <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </div>
                  <div className="font-display text-lg font-extrabold text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-300" />
                    <span>{mp.name}</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                    {mp.desc}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-indigo-200">
                  <span>Acquire via {mp.name.split(' ')[0]}</span>
                  <span className="text-emerald-300">Verified ✓</span>
                </div>
              </button>
            ))}
          </div>

          {/* 4-Step Safe Escrow Transaction Timeline */}
          <div className="pt-2">
            <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Handshake className="w-4 h-4 text-indigo-400" />
              <span>How Escrow-Protected Domain Transfer Works:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  step: '01',
                  title: 'Agree on Terms',
                  desc: 'Select Buy-It-Now ($24,800), Lease-to-Own ($1,033/mo), or have your custom offer accepted.',
                },
                {
                  step: '02',
                  title: 'Buyer Funds Escrow',
                  desc: 'Payment is held securely by Escrow.com, Atom, GoDaddy, or Sedo. Seller is not paid yet.',
                },
                {
                  step: '03',
                  title: 'Fast Domain Push',
                  desc: 'We push VigoChat.com or deliver the EPP Auth Code directly to your registrar account.',
                },
                {
                  step: '04',
                  title: 'Verified Release',
                  desc: 'Escrow verifies you have 100% sole ownership & control before disbursing funds.',
                },
              ].map((s, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-2xl bg-[#070A17]/90 border border-slate-800/90"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300">
                      STEP {s.step}
                    </span>
                    <span className="font-display font-bold text-sm text-white">
                      {s.title}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
