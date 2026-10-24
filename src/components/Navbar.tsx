import React, { useState } from 'react';
import {
  Volume2,
  ShoppingBag,
  Menu,
  X,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { VigoLogo } from './VigoLogo';
import { DealStructureType } from '../types/domain';

interface NavbarProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
  onPronounceDomain: () => void;
  isPronouncing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenModal,
  onPronounceDomain,
  isPronouncing,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: 'Live Demo', href: '#hero-demo' },
    { label: 'Use Cases', href: '#use-cases' },
    { label: 'Brand Matrix', href: '#brand-matrix' },
    { label: 'Acquisition & Escrow', href: '#acquire' },
    { label: 'Buyer FAQ', href: '#faq' },
  ];

  return (
    <header className="sticky top-[41px] z-40 w-full bg-[#050711]/80 backdrop-blur-xl border-b border-slate-800/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <a
          href="#top"
          className="focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-xl"
          aria-label="VigoChat.com Home"
        >
          <VigoLogo size="md" showBadge={true} />
        </a>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {navLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="hidden md:flex items-center gap-2.5">
          <button
            type="button"
            onClick={onPronounceDomain}
            title="Hear Phonetic Pronunciation: Vi-go-Chat.com"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-all ${
              isPronouncing
                ? 'bg-indigo-500/20 border-indigo-400 text-cyan-300 shadow-sm shadow-indigo-500/30'
                : 'bg-slate-900/80 border-slate-700/80 text-slate-300 hover:border-indigo-500/50 hover:text-white'
            }`}
          >
            <Volume2
              className={`w-3.5 h-3.5 ${
                isPronouncing ? 'text-cyan-400 animate-bounce' : 'text-indigo-400'
              }`}
            />
            <span>{isPronouncing ? 'Playing: Vi-go-Chat' : 'Hear "Vi-go-Chat"'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: '24800',
                sourceLabel: 'Navbar Acquire CTA',
              })
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/30 shadow-lg shadow-indigo-600/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <ShoppingBag className="w-4 h-4 text-cyan-300" />
            <span>Acquire Domain</span>
          </button>
        </div>

        {/* Mobile Menu Trigger */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: '24800',
                sourceLabel: 'Mobile Header CTA',
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Buy / Offer</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#080B1A]/98 border-b border-slate-800 px-4 pt-3 pb-5 space-y-2">
          {navLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/5"
            >
              {item.label}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => {
                onPronounceDomain();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono bg-slate-900 border border-slate-700 text-slate-200"
            >
              <Volume2 className="w-4 h-4 text-indigo-400" />
              <span>Hear Pronunciation: "Vi-go-Chat.com"</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenModal({
                  dealType: 'outright',
                  prefilledOffer: '24800',
                  sourceLabel: 'Mobile Menu CTA',
                });
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Acquire VigoChat.com Now</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
