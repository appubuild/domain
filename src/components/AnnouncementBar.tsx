import React from 'react';
import { ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-react';
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
  return (
    <div className="sticky top-0 z-50 w-full bg-[#070A18]/95 backdrop-blur-xl border-b border-indigo-500/25">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 text-slate-200">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/20 via-violet-500/20 to-cyan-500/20 border border-indigo-400/30 text-indigo-200 font-medium text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-2 h-2 rounded-full bg-emerald-400 relative" />
            Verified Asset
          </span>
          <p className="font-medium tracking-tight text-slate-200">
            <span className="mr-1" role="img" aria-label="fire">
              🔥
            </span>
            This premium domain name (
            <span className="font-bold text-white underline decoration-indigo-400/60 underline-offset-4">
              VigoChat.com
            </span>
            ) is currently available for acquisition or lease.
          </p>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Escrow.com Protected</span>
            <span className="text-slate-600">•</span>
            <span className="text-cyan-300">BIN $24,800</span>
          </div>

          <a
            href="#acquire"
            className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white transition-colors px-2.5 py-1 rounded-lg hover:bg-white/5"
          >
            Lease from $1,033/mo
          </a>

          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                sourceLabel: 'Top Sticky Announcement Bar',
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:via-violet-500 hover:to-cyan-400 shadow-sm shadow-indigo-500/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Make an Offer</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
