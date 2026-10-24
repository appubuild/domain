import { useState, useCallback, useEffect } from 'react';
import { SITE_CONFIG } from './config';
import { AnnouncementBar } from './components/AnnouncementBar';
import { Navbar } from './components/Navbar';
import { NavigationDrawer } from './components/NavigationDrawer';
import { HeroSection } from './components/HeroSection';
import { UseCaseShowcase } from './components/UseCaseShowcase';
import { BrandPowerMatrix } from './components/BrandPowerMatrix';
import { AcquisitionSection } from './components/AcquisitionSection';
import { FaqSection } from './components/FaqSection';
import { Footer } from './components/Footer';
import { AcquisitionModal } from './components/AcquisitionModal';
import {
  DealStructureType,
  MarketplaceId,
  ModalTriggerContext,
  ThemeMode,
} from './types/domain';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

const THEME_STORAGE_KEY = 'vigochat-theme-preference';

export function App() {
  // 1. Theme State Management (Persisted to localStorage, defaults to 'dark')
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors in restricted environments
    }
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // 2. Slide-Over Navigation Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // 3. Acquisition / Offer Modal State
  const [modalState, setModalState] = useState<ModalTriggerContext>({
    isOpen: false,
    dealType: 'outright',
    prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
    preferredMarketplace: 'escrow',
  });

  // 4. Audio Pronunciation Radio Test State
  const [isPronouncing, setIsPronouncing] = useState(false);

  const handleOpenModal = useCallback(
    (options?: {
      dealType?: DealStructureType;
      prefilledOffer?: string;
      preferredMarketplace?: MarketplaceId;
      sourceLabel?: string;
    }) => {
      setModalState({
        isOpen: true,
        dealType: options?.dealType || 'outright',
        prefilledOffer:
          options?.prefilledOffer || String(SITE_CONFIG.pricing.binPrice),
        preferredMarketplace: options?.preferredMarketplace || 'escrow',
        sourceLabel: options?.sourceLabel,
      });
    },
    []
  );

  const handleCloseModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handlePronounceDomain = useCallback(() => {
    setIsPronouncing(true);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          SITE_CONFIG.speechSynthesisText
        );
        utterance.rate = 0.96;
        utterance.pitch = 1.02;
        utterance.onend = () => setIsPronouncing(false);
        utterance.onerror = () => setIsPronouncing(false);
        window.speechSynthesis.speak(utterance);
        setTimeout(() => setIsPronouncing(false), 3600);
        return;
      } catch {
        // Fallback timer below
      }
    }

    setTimeout(() => {
      setIsPronouncing(false);
    }, 2200);
  }, []);

  const monthlyEstimate = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

  return (
    <div
      id="top"
      className="min-h-screen bg-slate-50 dark:bg-[#050711] text-slate-900 dark:text-slate-100 selection:bg-indigo-500 selection:text-white relative overflow-x-clip transition-colors duration-250"
    >
      {/* Unified Sticky Top Stack: Top Notice Bar + Navigation Header never overlap */}
      <div className="sticky top-0 z-40 w-full">
        <AnnouncementBar onOpenModal={handleOpenModal} />
        <Navbar
          onOpenModal={handleOpenModal}
          onOpenDrawer={() => setIsDrawerOpen(true)}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      </div>

      {/* Main Content */}
      <main>
        {/* 1. Split-Screen Hero & Live Interactive VigoChat AI Widget */}
        <HeroSection
          onOpenModal={handleOpenModal}
          onPronounceDomain={handlePronounceDomain}
          isPronouncing={isPronouncing}
        />

        {/* 2. Interactive 4-Industry Use-Case Showcase */}
        <UseCaseShowcase onOpenModal={handleOpenModal} />

        {/* 3. Domain Valuation & Brand Power Matrix */}
        <BrandPowerMatrix
          onOpenModal={handleOpenModal}
          onPronounceDomain={handlePronounceDomain}
          isPronouncing={isPronouncing}
        />

        {/* 4. Acquisition Hub: 3 Deal Cards + Lease Calculator + Verified Marketplaces */}
        <AcquisitionSection onOpenModal={handleOpenModal} />

        {/* 5. Buyer & Escrow FAQ */}
        <FaqSection onOpenModal={handleOpenModal} />
      </main>

      {/* 6. Footer with Legal Disclaimer & Safe Transaction Guarantee Badges */}
      <Footer onOpenModal={handleOpenModal} />

      {/* Mobile Floating Bottom Acquisition Bar */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 p-3 bg-white/95 dark:bg-[#080B1A]/95 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-lg">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{SITE_CONFIG.displayDomain}</span>
          </div>
          <div className="font-mono text-sm font-extrabold text-slate-900 dark:text-white">
            ${SITE_CONFIG.pricing.binPrice.toLocaleString()}{' '}
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
              or ${monthlyEstimate.toLocaleString()}/mo
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            handleOpenModal({
              dealType: 'outright',
              prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
              sourceLabel: 'Mobile Sticky Bottom Bar',
            })
          }
          className="px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 flex items-center gap-1.5 shadow-lg shadow-indigo-600/30"
        >
          <span className="text-white">Acquire / Offer</span>
          <ArrowUpRight className="w-3.5 h-3.5 text-white" />
        </button>
      </div>

      {/* Off-Canvas Slide-Over Navigation Drawer */}
      <NavigationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onOpenModal={handleOpenModal}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Interactive Offer / Inquiry / Webhook Modal */}
      <AcquisitionModal modalState={modalState} onClose={handleCloseModal} />
    </div>
  );
}

export default App;
