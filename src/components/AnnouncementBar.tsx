import React from 'react';
import { ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-react';
import { SITE_CONFIG } from '../config';
import { DealStructureType } from '../types/domain';

interface AnnouncementBarProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
}

export const AnnouncementBar: React.FC<AnnouncementBarProps> = ({
  onOpenModal,
}) => {
  const monthlyLease = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

  return (
    <div className="w-full bg-indigo-50/95 dark:bg-[#070A18]/95 backdrop-blur-xl border-b border-indigo-200/80 dark:border-indigo-500/25 transition-colors duration-250">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 border border-indigo-400/40 text-indigo-700 dark:text-indigo-200 font-semibold text-xs flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping absolute" />
            <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 relative" />
            Verified Asset
          </span>
          <p className="font-medium tracking-tight text-slate-800 dark:text-slate-200">
            <span className="mr-1" role="img" aria-label="fire">
              🔥
            </span>
            This premium domain name (
            <span className="font-bold text-indigo-700 dark:text-white underline decoration-indigo-500/60 underline-offset-4">
              {SITE_CONFIG.displayDomain}
            </span>
            ) is currently available for acquisition or lease.
          </p>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{SITE_CONFIG.marketplaces.escrow.shortName} Protected</span>
            <span className="text-slate-400 dark:text-slate-600">•</span>
            <span className="text-indigo-700 dark:text-cyan-300 font-semibold">
              BIN ${SITE_CONFIG.pricing.binPrice.toLocaleString()}
            </span>
          </div>

          <a
            href="#acquire"
            className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white transition-colors px-2.5 py-1 rounded-lg hover:bg-indigo-500/10"
          >
            Lease from ${monthlyLease.toLocaleString()}/mo
          </a>

          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                sourceLabel: 'Top Sticky Announcement Bar',
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:via-violet-500 hover:to-cyan-400 shadow-sm shadow-indigo-500/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span className="text-white">Make an Offer</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};
