import React from 'react';
import { motion } from 'framer-motion';
import {
  Globe2,
  Volume2,
  ShieldCheck,
  TrendingUp,
  Zap,
  CheckCircle2,
  Award,
  BarChart3,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { SITE_CONFIG } from '../config';
import {
  BRAND_SPECS_MATRIX,
  COMPARABLE_DOMAIN_BENCHMARKS,
} from '../data/domainData';
import { BrandSpecItem, DealStructureType } from '../types/domain';

interface BrandPowerMatrixProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
  onPronounceDomain: () => void;
  isPronouncing: boolean;
}

export const BrandPowerMatrix: React.FC<BrandPowerMatrixProps> = ({
  onOpenModal,
  onPronounceDomain,
  isPronouncing,
}) => {
  const getIcon = (id: BrandSpecItem['id']) => {
    switch (id) {
      case 'tld':
        return Globe2;
      case 'pronunciation':
        return Volume2;
      case 'history':
        return ShieldCheck;
      case 'market-fit':
        return TrendingUp;
      case 'transfer':
        return Zap;
      default:
        return Award;
    }
  };

  const getAccentBadgeClasses = (accent: BrandSpecItem['accent']) => {
    switch (accent) {
      case 'indigo':
        return 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30';
      case 'violet':
        return 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30';
      case 'emerald':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
      case 'cyan':
        return 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/30';
      case 'amber':
        return 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30';
    }
  };

  const brandScores = [
    {
      label: `Radio & Podcast Test ("${SITE_CONFIG.phoneticSpelling}")`,
      score: '10 / 10',
      pct: '100%',
    },
    {
      label: `Global ${SITE_CONFIG.tld.toUpperCase()} Extension Authority`,
      score: '10 / 10',
      pct: '100%',
    },
    {
      label: `${SITE_CONFIG.brandPrefix.length}-Letter Brevity & Visual Balance`,
      score: '9.8 / 10',
      pct: '98%',
    },
    {
      label: 'AI & Messaging Keyword Relevance',
      score: '9.9 / 10',
      pct: '99%',
    },
  ];

  return (
    <section
      id="brand-matrix"
      className="relative py-20 lg:py-28 border-t border-slate-200 dark:border-slate-800/80 bg-gradient-to-b from-white via-indigo-50/40 to-white dark:from-[#050711] dark:via-[#080B1C] dark:to-[#050711] transition-colors duration-250"
    >
      {/* Ambient Glow */}
      <div className="pointer-events-none absolute top-1/4 right-0 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-[140px]" />
      <div className="pointer-events-none absolute bottom-10 left-0 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[140px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Heading */}
        <div className="text-center max-w-3xl mx-auto mb-14 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-700 dark:text-violet-300 text-xs font-mono font-semibold uppercase tracking-wider">
            <BarChart3 className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
            <span>Domain Valuation &amp; Brand Power Matrix</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Engineered for{' '}
            <span className="text-gradient-vigo">
              Instant Category Leadership
            </span>
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-base sm:text-lg leading-relaxed">
            A great domain name permanently lowers customer acquisition cost
            (CAC), boosts organic click-through rates, and commands instant
            investor respect. Here is why{' '}
            <strong className="text-slate-900 dark:text-white">
              {SITE_CONFIG.displayDomain}
            </strong>{' '}
            is a rare tier-one digital asset.
          </p>
        </div>

        {/* 5-Card Specs Matrix Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 mb-12">
          {BRAND_SPECS_MATRIX.map((spec, idx) => {
            const Icon = getIcon(spec.id);
            const colSpan = idx < 3 ? 'lg:col-span-2' : 'lg:col-span-3';
            const isPronunciation = spec.id === 'pronunciation';

            return (
              <motion.div
                key={spec.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.06 }}
                className={`${colSpan} rounded-3xl glass-card glass-card-hover p-6 sm:p-7 flex flex-col justify-between relative overflow-hidden`}
              >
                <div>
                  {/* Top Spec Label & Highlight Badge */}
                  <div className="flex items-center justify-between gap-2 mb-5">
                    <span className="font-mono text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
                      {spec.label}
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${getAccentBadgeClasses(
                        spec.accent
                      )}`}
                    >
                      {spec.highlightValue}
                    </span>
                  </div>

                  {/* Icon + Title */}
                  <div className="flex items-center gap-3.5 mb-3">
                    <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700/80 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <Icon className="w-5 h-5 text-indigo-600 dark:text-cyan-300" />
                    </div>
                    <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                      {spec.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
                    {spec.description}
                  </p>

                  {/* Interactive Audio Test Button on Pronunciation Card */}
                  {isPronunciation && (
                    <div className="mb-5">
                      <button
                        type="button"
                        onClick={onPronounceDomain}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-500/15 to-indigo-500/15 hover:from-violet-500/25 hover:to-indigo-500/25 dark:from-violet-600/30 dark:to-indigo-600/30 dark:hover:from-violet-600/50 dark:hover:to-indigo-600/50 border border-violet-400/40 text-xs font-mono font-semibold text-violet-800 dark:text-violet-200 flex items-center justify-center gap-2 transition-all"
                      >
                        <Volume2
                          className={`w-4 h-4 text-indigo-600 dark:text-cyan-300 ${
                            isPronouncing ? 'animate-bounce' : ''
                          }`}
                        />
                        <span>
                          {isPronouncing
                            ? `Playing Audio: "${SITE_CONFIG.phoneticSpelling}${SITE_CONFIG.tld}"`
                            : `Click to Hear Radio Test: "${SITE_CONFIG.phoneticSpelling}"`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Sub-metrics Checklist */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
                  {spec.subMetrics.map((sub, sIdx) => (
                    <div
                      key={sIdx}
                      className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-slate-300"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span>{sub}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom 2-Column Valuation Benchmark & Linguistic Anatomy */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left: Linguistic Anatomy & Brand Scorecard */}
          <div className="lg:col-span-5 rounded-3xl glass-card p-6 sm:p-8 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-indigo-700 dark:text-cyan-300 uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                <span>Linguistic &amp; Syllabic Breakdown</span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#070A17] border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    3-SYLLABLE PHONETIC STRUCTURE
                  </div>
                  <div className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
                    <span className="text-indigo-600 dark:text-indigo-400">
                      Vi
                    </span>
                    <span className="text-slate-400 dark:text-slate-600">
                      •
                    </span>
                    <span className="text-violet-600 dark:text-violet-400">
                      go
                    </span>
                    <span className="text-slate-400 dark:text-slate-600">
                      •
                    </span>
                    <span className="text-cyan-600 dark:text-cyan-400">
                      Chat
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-lg font-mono">
                      {SITE_CONFIG.tld}
                    </span>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    CHARACTERS
                  </div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {SITE_CONFIG.brandPrefix.length}
                  </div>
                </div>
              </div>

              {/* Progress Bars */}
              <div className="space-y-3.5 pt-2">
                {brandScores.map((item, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        {item.label}
                      </span>
                      <span className="font-mono font-bold text-indigo-700 dark:text-cyan-300">
                        {item.score}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-900 overflow-hidden p-0.5 border border-slate-300/60 dark:border-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400"
                        style={{ width: item.pct }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Includes vector logo &amp; brand guidelines</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                Ready for Day-1 Launch
              </span>
            </div>
          </div>

          {/* Right: Category Valuation Benchmarks */}
          <div className="lg:col-span-7 rounded-3xl glass-card p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
                <div>
                  <span className="text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                    MARKET COMPARABLES &amp; MOAT
                  </span>
                  <h3 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    Why Category Leaders Invest in &ldquo;Chat&rdquo; .COMs
                  </h3>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  Asymmetric Startup ROI
                </span>
              </div>

              <div className="space-y-3">
                {COMPARABLE_DOMAIN_BENCHMARKS.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-2xl border transition-all ${
                      item.highlight
                        ? 'bg-gradient-to-r from-indigo-50 via-violet-50/70 to-cyan-50 dark:from-indigo-950/60 dark:via-violet-950/40 dark:to-cyan-950/60 border-indigo-400/60 shadow-md dark:shadow-lg shadow-indigo-500/10 dark:shadow-indigo-950/20'
                        : 'bg-slate-50 dark:bg-[#080B1A]/90 border-slate-200 dark:border-slate-800/90'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-bold text-base text-slate-900 dark:text-white">
                          {item.domain}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                          {item.category}
                        </span>
                      </div>
                      <span
                        className={`font-mono text-xs sm:text-sm font-bold ${
                          item.highlight
                            ? 'text-cyan-700 dark:text-cyan-300'
                            : 'text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {item.reportedValuation}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {item.insight}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Lock in{' '}
                <strong className="text-slate-900 dark:text-white">
                  {SITE_CONFIG.displayDomain}
                </strong>{' '}
                before it is acquired by a funded AI competitor.
              </p>
              <button
                type="button"
                onClick={() =>
                  onOpenModal({
                    dealType: 'outright',
                    prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                    sourceLabel: 'Brand Power Matrix Benchmark CTA',
                  })
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
              >
                <span className="text-white">Make Acquisition Offer</span>
                <ArrowUpRight className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
