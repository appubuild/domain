import React from 'react';
import {
  ShieldCheck,
  Lock,
  BadgeCheck,
  ArrowUpRight,
  MessageCircle,
  Mail,
} from 'lucide-react';
import { VigoLogo } from './VigoLogo';
import { DealStructureType } from '../types/domain';

interface FooterProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenModal }) => {
  const whatsappUrl =
    'https://wa.me/?text=' +
    encodeURIComponent('Hello, I am interested in acquiring vigochat.com.');

  return (
    <footer className="border-t border-slate-800/90 bg-[#04060F] text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-10">
        {/* Top Row: Brand + Safe Transaction Guarantee Badges */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8 pb-8 border-b border-slate-800/80">
          <div className="space-y-2.5 max-w-md">
            <VigoLogo size="md" showBadge={true} />
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              <strong className="text-slate-200">VigoChat.com</strong> is a
              premium 8-letter, 3-syllable top-level domain asset available for
              immediate acquisition or lease-to-own via certified domain escrow.
            </p>
          </div>

          {/* Safe Transaction Guarantee Badges */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-xs font-mono text-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>100% Escrow Protected</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-cyan-500/30 text-xs font-mono text-cyan-300">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>256-Bit SSL Encrypted</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-indigo-500/30 text-xs font-mono text-indigo-300">
              <BadgeCheck className="w-4 h-4 text-indigo-400" />
              <span>ICANN Verified Fast-Transfer</span>
            </div>
          </div>
        </div>

        {/* Middle Row: Quick Navigation & Direct Actions */}
        <div className="flex flex-wrap items-center justify-between gap-6 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-5">
            <a href="#top" className="hover:text-white transition-colors">
              Overview
            </a>
            <a href="#hero-demo" className="hover:text-white transition-colors">
              Interactive Chat Demo
            </a>
            <a href="#use-cases" className="hover:text-white transition-colors">
              4 Industry Use Cases
            </a>
            <a
              href="#brand-matrix"
              className="hover:text-white transition-colors"
            >
              Valuation Matrix
            </a>
            <a href="#acquire" className="hover:text-white transition-colors">
              Marketplaces &amp; Pricing
            </a>
            <a href="#faq" className="hover:text-white transition-colors">
              Escrow FAQ
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-semibold transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Seller</span>
            </a>
            <a
              href="mailto:acquisitions@vigochat.com?subject=Acquisition%20Inquiry%3A%20VigoChat.com&body=Hello%2C%20I%20am%20interested%20in%20acquiring%20vigochat.com."
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-indigo-400" />
              <span>acquisitions@vigochat.com</span>
            </a>
            <button
              type="button"
              onClick={() =>
                onOpenModal({
                  dealType: 'outright',
                  prefilledOffer: '24800',
                  sourceLabel: 'Footer Quick Offer CTA',
                })
              }
              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              <span>Make Offer</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Copyright & Legal Disclaimer */}
        <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            &copy; {new Date().getFullYear()} VigoChat.com Domain Asset
            Holdings. All rights reserved.
          </p>
          <p className="max-w-2xl sm:text-right leading-relaxed">
            <strong>Legal Disclaimer:</strong> The SaaS product interface,
            metrics, and AI chat capabilities demonstrated on this page are an
            illustrative concept showcase created solely to highlight the
            branding potential of the{' '}
            <span className="text-slate-400">VigoChat.com</span> domain name.
            Third-party marketplace names (Escrow.com, Atom, GoDaddy, Afternic,
            Sedo) are trademarks of their respective owners.
          </p>
        </div>
      </div>
    </footer>
  );
};
