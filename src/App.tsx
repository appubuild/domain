import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Volume2 } from 'lucide-react';
import { AnnouncementBar } from './components/AnnouncementBar';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { UseCaseShowcase } from './components/UseCaseShowcase';
import { BrandPowerMatrix } from './components/BrandPowerMatrix';
import { AcquisitionSection } from './components/AcquisitionSection';
import { FaqSection } from './components/FaqSection';
import { AcquisitionModal } from './components/AcquisitionModal';
import { Footer } from './components/Footer';
import {
  DealStructureType,
  MarketplaceId,
  ModalTriggerContext,
} from './types/domain';

export function App() {
  const [modalState, setModalState] = useState<ModalTriggerContext>({
    isOpen: false,
    dealType: 'outright',
    prefilledOffer: '24800',
    preferredMarketplace: 'escrow',
    sourceLabel: 'Direct Acquisition Inquiry',
  });

  const [isPronouncing, setIsPronouncing] = useState(false);
  const hasAutoPromptedRef = useRef(false);

  const handleOpenModal = (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    preferredMarketplace?: MarketplaceId;
    sourceLabel?: string;
  }) => {
    hasAutoPromptedRef.current = true;
    setModalState({
      isOpen: true,
      dealType: options?.dealType || 'outright',
      prefilledOffer: options?.prefilledOffer || '24800',
      preferredMarketplace: options?.preferredMarketplace || 'escrow',
      sourceLabel: options?.sourceLabel || 'Acquisition Inquiry',
    });
  };

  const handleCloseModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  // Delayed Popup after 10s + Exit-Intent Trigger (once per session)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasAutoPromptedRef.current) {
        hasAutoPromptedRef.current = true;
        setModalState({
          isOpen: true,
          dealType: 'outright',
          prefilledOffer: '24800',
          preferredMarketplace: 'escrow',
          sourceLabel: '⚡ Direct Buyer Window (10s Preview Offer)',
        });
      }
    }, 10000);

    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 5 && !hasAutoPromptedRef.current) {
        hasAutoPromptedRef.current = true;
        setModalState({
          isOpen: true,
          dealType: 'investor',
          prefilledOffer: '19500',
          preferredMarketplace: 'escrow',
          sourceLabel: '🔥 Wait! Submit a Direct Offer on VigoChat.com',
        });
      }
    };

    document.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  // Pronunciation Handler (Web Speech API + Visual Toast)
  const handlePronounceDomain = () => {
    setIsPronouncing(true);
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          'Vigo Chat dot com. Next generation conversations start here.'
        );
        utterance.rate = 0.96;
        utterance.pitch = 1.02;
        utterance.onend = () => setIsPronouncing(false);
        utterance.onerror = () => setIsPronouncing(false);
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      // Fallback handled by timeout below
    }
    setTimeout(() => {
      setIsPronouncing(false);
    }, 2800);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#050711] text-slate-100 relative selection:bg-indigo-500/30 selection:text-cyan-200">
      {/* 1. Top Sticky Announcement Bar */}
      <AnnouncementBar onOpenModal={handleOpenModal} />

      {/* Sticky Brand Navigation */}
      <Navbar
        onOpenModal={handleOpenModal}
        onPronounceDomain={handlePronounceDomain}
        isPronouncing={isPronouncing}
      />

      {/* Main Content */}
      <main className="flex-grow">
        {/* 2. Hero Section + Interactive Floating Chat Widget */}
        <HeroSection
          onOpenModal={handleOpenModal}
          onPronounceDomain={handlePronounceDomain}
        />

        {/* 3. Interactive Use-Case Showcase (Tabs + 4-Industry Bento Grid) */}
        <UseCaseShowcase onOpenModal={handleOpenModal} />

        {/* 4. Domain Valuation & Brand Power Matrix */}
        <BrandPowerMatrix
          onOpenModal={handleOpenModal}
          onPronounceDomain={handlePronounceDomain}
          isPronouncing={isPronouncing}
        />

        {/* 5. Marketplace & Direct Acquisition Section */}
        <AcquisitionSection onOpenModal={handleOpenModal} />

        {/* Buyer & Escrow FAQ */}
        <FaqSection onOpenModal={handleOpenModal} />
      </main>

      {/* 8. Minimalist Footer */}
      <Footer onOpenModal={handleOpenModal} />

      {/* 6. Lead Generation & Contact Modal (Popup) */}
      <AcquisitionModal modalState={modalState} onClose={handleCloseModal} />

      {/* Phonetic Audio Toast Notification */}
      <AnimatePresence>
        {isPronouncing && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 right-5 z-40 px-4 py-3 rounded-2xl bg-[#0D132B]/95 border border-cyan-400/50 shadow-xl shadow-cyan-950/60 flex items-center gap-3"
          >
            <Volume2 className="w-5 h-5 text-cyan-400 animate-bounce" />
            <div className="text-xs font-mono">
              <div className="text-white font-bold">
                Phonetic Radio Test: &ldquo;Vi-go-Chat.com&rdquo;
              </div>
              <div className="text-cyan-300">
                /ˈviː.ɡoʊ.tʃæt/ • 3 Syllables • 8 Letters
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Persistent Quick-Offer Button */}
      <div className="fixed bottom-5 right-5 z-40">
        <button
          type="button"
          onClick={() =>
            handleOpenModal({
              dealType: 'outright',
              prefilledOffer: '24800',
              sourceLabel: 'Floating Quick-Acquire Trigger',
            })
          }
          className="group flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs sm:text-sm font-bold shadow-2xl shadow-indigo-600/50 border border-white/20 transition-all hover:scale-105"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
          <Sparkles className="w-4 h-4 text-cyan-200" />
          <span>Buy / Make Offer: VigoChat.com</span>
        </button>
      </div>
    </div>
  );
}

export default App;
