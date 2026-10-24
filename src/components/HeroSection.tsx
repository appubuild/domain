import React from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Compass,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Zap,
  Globe2,
  Award,
  Volume2,
} from 'lucide-react';
import { SITE_CONFIG } from '../config';
import { InteractiveChatWidget } from './InteractiveChatWidget';
import { DealStructureType } from '../types/domain';

interface HeroSectionProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
  onPronounceDomain: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onOpenModal,
  onPronounceDomain,
}) => {
  const monthlyLease = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

  const quickSpecs = [
    {
      icon: Globe2,
      label: 'Extension',
      value: `Tier-1 ${SITE_CONFIG.tld.toUpperCase()}`,
    },
    {
      icon: Zap,
      label: 'Length',
      value: `${SITE_CONFIG.brandPrefix.length} Letters`,
    },
    {
      icon: Award,
      label: 'Syllables',
      value: `3 (${SITE_CONFIG.phoneticSpelling})`,
    },
    { icon: ShieldCheck, label: 'Escrow', value: '<24h Transfer' },
  ];

  return (
    <section
      id="top"
      className="relative pt-10 pb-20 lg:pt-16 lg:pb-28 overflow-hidden bg-grid-pattern"
    >
      {/* Ambient Radial Glow Orbs */}
      <div className="pointer-events-none absolute top-0 left-1/4 -translate-x-1/2 w-[550px] h-[550px] bg-indigo-500/15 dark:bg-indigo-600/20 rounded-full blur-[130px]" />
      <div className="pointer-events-none absolute top-28 right-10 w-[480px] h-[480px] bg-cyan-500/15 rounded-full blur-[130px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-violet-500/10 dark:bg-violet-600/15 rounded-full blur-[140px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
          {/* Left Column: High-Converting Brand Hook & Dual CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="lg:col-span-6 space-y-6"
          >
            {/* Category-Defining Pill Badge */}
            <div className="inline-flex flex-wrap items-center gap-2 p-1.5 pr-4 rounded-full bg-white dark:bg-slate-900/90 border border-indigo-200 dark:border-indigo-500/30 shadow-md dark:shadow-lg shadow-indigo-500/10 dark:shadow-indigo-950/20">
              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-cyan-500 text-white">
                Premium {SITE_CONFIG.tld.toUpperCase()} Asset
              </span>
              <span className="text-xs sm:text-sm font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
                <span>Category-Defining AI &amp; Messaging Brand</span>
              </span>
            </div>

            {/* Main Hero Headline */}
            <h1 className="font-display text-4xl sm:text-5xl xl:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.08]">
              Next-Gen Conversations Start Here:{' '}
              <span className="text-gradient-vigo inline-block">
                {SITE_CONFIG.displayDomain}
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Own a punchy, memorable, and category-defining{' '}
              <strong className="text-slate-900 dark:text-white font-semibold">
                {SITE_CONFIG.brandPrefix.length}-letter {SITE_CONFIG.tld} domain
              </strong>{' '}
              engineered for AI customer support, real-time enterprise
              messaging, telehealth, or Web3 social ecosystems. Fusing{' '}
              <span className="text-indigo-600 dark:text-indigo-300 font-semibold">
                &ldquo;Vigo&rdquo;
              </span>{' '}
              (vigor, vitality, speed) with the universal high-intent keyword{' '}
              <span className="text-cyan-700 dark:text-cyan-300 font-semibold">
                &ldquo;Chat&rdquo;
              </span>
              , {SITE_CONFIG.displayDomain} gives your startup instant Series-A
              authority from Day 1.
            </p>

            {/* Dual Call-to-Action (CTA) */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5">
              <button
                type="button"
                onClick={() =>
                  onOpenModal({
                    dealType: 'outright',
                    prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                    sourceLabel: 'Hero Primary CTA (Acquire Domain / Buy Now)',
                  })
                }
                className="group inline-flex items-center justify-center gap-2.5 px-7 py-4 rounded-2xl text-base font-bold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:via-violet-500 hover:to-cyan-400 shadow-xl shadow-indigo-600/30 border border-indigo-400/40 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="text-white">Acquire Domain / Buy Now</span>
                <ArrowRight className="w-5 h-5 text-white group-hover:translate-x-1 transition-transform" />
              </button>

              <a
                href="#use-cases"
                className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl text-base font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-800/90 border border-slate-300 dark:border-slate-700/80 hover:border-indigo-500/40 shadow-sm dark:shadow-none transition-all"
              >
                <Compass className="w-5 h-5 text-indigo-600 dark:text-cyan-400" />
                <span>Explore Use Cases</span>
              </a>
            </div>

            {/* Direct Pricing & Phonetic Strip */}
            <div className="pt-1 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Buy Now:{' '}
                  <strong className="text-slate-900 dark:text-white font-mono">
                    ${SITE_CONFIG.pricing.binPrice.toLocaleString()}{' '}
                    {SITE_CONFIG.pricing.currency}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>
                  Lease-to-Own:{' '}
                  <strong className="text-cyan-700 dark:text-cyan-300 font-mono">
                    ${monthlyLease.toLocaleString()}/mo
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onPronounceDomain}
                className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300 hover:text-cyan-600 dark:hover:text-cyan-300 font-mono font-semibold underline decoration-indigo-500/50 underline-offset-4 transition-colors"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>
                  Pronounced: &ldquo;{SITE_CONFIG.phoneticSpelling}&rdquo;
                </span>
              </button>
            </div>

            {/* 4-Pillar Domain Spec Mini Cards */}
            <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {quickSpecs.map((spec, idx) => {
                const IconComponent = spec.icon;
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-2xl bg-white dark:bg-[#0B0F23]/90 border border-slate-200 dark:border-slate-800/90 hover:border-indigo-500/40 shadow-sm dark:shadow-none transition-colors"
                  >
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <IconComponent className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>{spec.label}</span>
                    </div>
                    <div className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                      {spec.value}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Right Column: Interactive Floating Chat Widget Mockup */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1 }}
            className="lg:col-span-6"
          >
            <InteractiveChatWidget onOpenModal={onOpenModal} />
          </motion.div>
        </div>
      </div>
    </section>
  );
};
