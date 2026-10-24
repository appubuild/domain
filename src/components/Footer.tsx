import React from 'react';
import {
  ShieldCheck,
  Lock,
  BadgeCheck,
  ArrowUpRight,
  MessageCircle,
  Mail,
} from 'lucide-react';
import { SITE_CONFIG, buildWhatsAppUrl, buildMailtoUrl } from '../config';
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
  const whatsappUrl = buildWhatsAppUrl();
  const mailtoUrl = buildMailtoUrl();

  return (
    <footer className="border-t border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-[#04060F] text-slate-600 dark:text-slate-400 transition-colors duration-250">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-10">
        {/* Top Row: Brand + Safe Transaction Guarantee Badges */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8 pb-8 border-b border-slate-200 dark:border-slate-800/80">
          <div className="space-y-2.5 max-w-md">
            <VigoLogo size="md" showBadge={true} />
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong className="text-slate-900 dark:text-slate-200">
                {SITE_CONFIG.displayDomain}
              </strong>{' '}
              is a premium {SITE_CONFIG.brandPrefix.length}-letter, 3-syllable
              top-level domain asset available for immediate acquisition or
              lease-to-own via certified domain escrow.
            </p>
          </div>

          {/* Safe Transaction Guarantee Badges */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900/90 border border-emerald-500/30 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300 shadow-sm dark:shadow-none">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>100% Escrow Protected</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900/90 border border-cyan-500/30 text-xs font-mono font-semibold text-cyan-800 dark:text-cyan-300 shadow-sm dark:shadow-none">
              <Lock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>256-Bit SSL Encrypted</span>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900/90 border border-indigo-500/30 text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm dark:shadow-none">
              <BadgeCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>ICANN Verified Fast-Transfer</span>
            </div>
          </div>
        </div>

        {/* Middle Row: Quick Navigation & Direct Actions */}
        <div className="flex flex-wrap items-center justify-between gap-6 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-5 font-medium">
            <a
              href="#top"
              className="hover:text-indigo-600 dark:hover:text-white transition-colors"
            >
              Overview
            </a>
            {SITE_CONFIG.navigationLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-indigo-600 dark:hover:text-white transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-mono font-semibold transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Seller</span>
            </a>
            <a
              href={mailtoUrl}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-mono transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{SITE_CONFIG.email.recipientEmail}</span>
            </a>
            <button
              type="button"
              onClick={() =>
                onOpenModal({
                  dealType: 'outright',
                  prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                  sourceLabel: 'Footer Quick Offer CTA',
                })
              }
              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              <span className="text-white">Make Offer</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Copyright & Legal Disclaimer */}
        <div className="pt-6 border-t border-slate-200 dark:border-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            &copy; {new Date().getFullYear()} {SITE_CONFIG.displayDomain} Domain
            Asset Holdings. All rights reserved.
          </p>
          <p className="max-w-2xl sm:text-right leading-relaxed">
            <strong>Legal Disclaimer:</strong> The SaaS product interface,
            metrics, and AI chat capabilities demonstrated on this page are an
            illustrative concept showcase created solely to highlight the
            branding potential of the{' '}
            <span className="text-slate-700 dark:text-slate-400 font-medium">
              {SITE_CONFIG.displayDomain}
            </span>{' '}
            domain name. Third-party marketplace names (Escrow.com, Dan, Atom,
            GoDaddy, Afternic, Sedo) are trademarks of their respective owners.
          </p>
        </div>
      </div>
    </footer>
  );
};
