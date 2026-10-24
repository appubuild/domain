import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sun,
  Moon,
  Volume2,
  Sparkles,
  ArrowUpRight,
  MessageCircle,
  Mail,
  ShieldCheck,
  Compass,
  Layers,
  BarChart3,
  ShoppingBag,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { SITE_CONFIG, buildWhatsAppUrl, buildMailtoUrl } from '../config';
import { VigoLogo } from './VigoLogo';
import { DealStructureType, MarketplaceId, ThemeMode } from '../types/domain';

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onPronounceDomain: () => void;
  isPronouncing: boolean;
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    preferredMarketplace?: MarketplaceId;
    sourceLabel?: string;
  }) => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  onPronounceDomain,
  isPronouncing,
  onOpenModal,
}) => {
  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const navIcons = [Compass, Layers, BarChart3, ShoppingBag, HelpCircle];
  const monthlyLease = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[70] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Drawer"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm"
          />

          {/* Off-Canvas Slide-Over Panel */}
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-screen max-w-md bg-white dark:bg-[#080B1A] border-l border-slate-200 dark:border-indigo-500/30 shadow-2xl flex flex-col justify-between overflow-y-auto"
            >
              {/* Top Gradient Strip */}
              <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 flex-shrink-0" />

              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-transparent">
                <VigoLogo size="sm" showBadge={true} />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white border border-slate-200 dark:border-slate-700/80 transition-colors"
                    aria-label="Toggle Dark / Light Theme"
                    title={
                      theme === 'dark'
                        ? 'Switch to Enterprise Light Mode'
                        : 'Switch to Dark Cyber Mode'
                    }
                  >
                    {theme === 'dark' ? (
                      <Sun className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Moon className="w-4 h-4 text-indigo-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/80 transition-colors"
                    aria-label="Close Navigation Drawer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Drawer Body */}
              <div className="p-5 space-y-6 flex-1 overflow-y-auto">
                {/* Domain Quick Valuation Summary */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-cyan-50/80 dark:from-indigo-950/60 dark:via-slate-900/90 dark:to-cyan-950/50 border border-indigo-200 dark:border-indigo-500/30 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping" />
                      {SITE_CONFIG.domainName} • Available
                    </span>
                    <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                      Escrow Verified
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#070A18]/90 border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none">
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">
                        Buy It Now
                      </div>
                      <div className="font-mono text-base font-extrabold text-slate-900 dark:text-white">
                        ${SITE_CONFIG.pricing.binPrice.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#070A18]/90 border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none">
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">
                        Lease-to-Own
                      </div>
                      <div className="font-mono text-base font-extrabold text-cyan-700 dark:text-cyan-300">
                        ${monthlyLease.toLocaleString()}/mo
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section Jump Links */}
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2.5 px-1">
                    Page Sections &amp; Interactive Demos
                  </div>
                  <nav className="space-y-1.5">
                    {SITE_CONFIG.navigationLinks.map((item, idx) => {
                      const Icon = navIcons[idx % navIcons.length];
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          className="group flex items-start gap-3.5 p-3 rounded-2xl hover:bg-indigo-50/80 dark:hover:bg-indigo-500/10 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all"
                        >
                          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 group-hover:border-indigo-400 dark:group-hover:border-indigo-500/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400 group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-display font-bold text-sm text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                                {item.label}
                              </span>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-indigo-50 dark:bg-slate-900 border border-indigo-200/80 dark:border-slate-800 text-indigo-700 dark:text-cyan-300">
                                {item.badge}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                              {item.description}
                            </p>
                          </div>
                        </a>
                      );
                    })}
                  </nav>
                </div>

                {/* Theme & Radio-Test Controls */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold px-1">
                    Appearance &amp; Audio Test
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={onToggleTheme}
                      className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 transition-all"
                    >
                      {theme === 'dark' ? (
                        <>
                          <Sun className="w-4 h-4 text-amber-400" />
                          <span>Light Mode</span>
                        </>
                      ) : (
                        <>
                          <Moon className="w-4 h-4 text-indigo-600" />
                          <span>Dark Mode</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={onPronounceDomain}
                      className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 transition-all"
                    >
                      <Volume2
                        className={`w-4 h-4 text-indigo-600 dark:text-cyan-400 ${
                          isPronouncing ? 'animate-bounce' : ''
                        }`}
                      />
                      <span>
                        Hear &ldquo;{SITE_CONFIG.phoneticSpelling}&rdquo;
                      </span>
                    </button>
                  </div>
                </div>

                {/* Verified Marketplaces Direct Links (from config.ts) */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold px-1">
                    Verified Marketplaces ({SITE_CONFIG.domainName})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.values(SITE_CONFIG.marketplaces).map((mp) => (
                      <a
                        key={mp.id}
                        href={mp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900/90 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-xs font-mono font-medium text-slate-800 dark:text-slate-200 transition-all"
                      >
                        <span className="truncate">{mp.shortName}</span>
                        <ExternalLink className="w-3 h-3 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>

                {/* Direct Contact Shortcuts */}
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={buildWhatsAppUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 text-xs font-mono font-semibold transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>WhatsApp</span>
                  </a>
                  <a
                    href={buildMailtoUrl()}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-800 dark:text-indigo-300 text-xs font-mono font-semibold transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    <span>Direct Email</span>
                  </a>
                </div>
              </div>

              {/* Drawer Footer CTA */}
              <div className="p-5 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#060916] space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenModal({
                      dealType: 'outright',
                      prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                      sourceLabel: 'Slide-Over Navigation Drawer CTA',
                    });
                  }}
                  className="w-full py-3.5 px-5 rounded-2xl text-sm font-bold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <Sparkles className="w-4 h-4 text-white" />
                  <span className="text-white">
                    Make an Offer / Acquire Now
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-white" />
                </button>
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>100% Escrow Protected • Instant Push Transfer</span>
                </div>
              </div>
            </motion.aside>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};
