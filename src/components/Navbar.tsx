import React from 'react';
import {
  Volume2,
  ShoppingBag,
  Menu,
  Sun,
  Moon,
  Sparkles,
  PanelRightOpen,
} from 'lucide-react';
import { SITE_CONFIG } from '../config';
import { VigoLogo } from './VigoLogo';
import { DealStructureType, ThemeMode } from '../types/domain';

interface NavbarProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
  onPronounceDomain: () => void;
  isPronouncing: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenDrawer: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenModal,
  onPronounceDomain,
  isPronouncing,
  theme,
  onToggleTheme,
  onOpenDrawer,
}) => {
  return (
    <header className="w-full bg-white/92 dark:bg-[#050711]/90 backdrop-blur-xl border-b border-slate-200/90 dark:border-slate-800/80 shadow-sm dark:shadow-none transition-colors duration-250">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <a
          href="#top"
          className="focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-xl"
          aria-label={`${SITE_CONFIG.displayDomain} Home`}
        >
          <VigoLogo size="md" showBadge={true} />
        </a>

        {/* Clean, Minimal Desktop Navigation Links */}
        <nav
          className="hidden lg:flex items-center gap-1"
          aria-label="Primary Navigation"
        >
          {SITE_CONFIG.navigationLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Desktop Actions: Pronunciation, Theme Toggle, Acquire CTA, Drawer Trigger */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={onPronounceDomain}
            title={`Hear Phonetic Pronunciation: ${SITE_CONFIG.phoneticSpelling}${SITE_CONFIG.tld}`}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-all ${
              isPronouncing
                ? 'bg-indigo-500/15 border-indigo-500 text-indigo-700 dark:text-cyan-300 shadow-sm shadow-indigo-500/20'
                : 'bg-slate-100 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-white'
            }`}
          >
            <Volume2
              className={`w-3.5 h-3.5 ${
                isPronouncing
                  ? 'text-indigo-600 dark:text-cyan-400 animate-bounce'
                  : 'text-indigo-500 dark:text-indigo-400'
              }`}
            />
            <span className="hidden xl:inline">
              {isPronouncing
                ? `Playing: ${SITE_CONFIG.phoneticSpelling}`
                : `Hear "${SITE_CONFIG.phoneticSpelling}"`}
            </span>
          </button>

          {/* Accessible Sun / Moon Theme Switcher */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              theme === 'dark'
                ? 'Switch to Enterprise Light Mode'
                : 'Switch to Dark Cyber Mode'
            }
            title={
              theme === 'dark'
                ? 'Switch to Enterprise Light Mode'
                : 'Switch to Dark Cyber Mode'
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-900/80 hover:bg-slate-200/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-indigo-500/50 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white transition-all"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="hidden xl:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-indigo-600" />
                <span className="hidden xl:inline">Dark</span>
              </>
            )}
          </button>

          {/* Primary Acquire Domain CTA */}
          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                sourceLabel: 'Navbar Acquire CTA',
              })
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/30 shadow-lg shadow-indigo-600/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <ShoppingBag className="w-4 h-4 text-cyan-200" />
            <span className="text-white">Acquire Domain</span>
          </button>

          {/* Slide-Over Drawer Button */}
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Open Navigation Drawer"
            title="Open Quick Navigation & Marketplaces Drawer"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900/80 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-indigo-500/50 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white transition-all"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
        </div>

        {/* Tablet & Mobile Controls: Theme Toggle + Make Offer + Off-Canvas Drawer Trigger */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle Dark / Light Theme"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-600" />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                sourceLabel: 'Mobile Header CTA',
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span className="text-white">Buy / Offer</span>
          </button>

          <button
            type="button"
            onClick={onOpenDrawer}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white"
            aria-label="Open Off-Canvas Navigation Drawer"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};
