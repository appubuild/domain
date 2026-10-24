import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, HelpCircle, MessageSquarePlus } from 'lucide-react';
import { FAQ_ITEMS } from '../data/domainData';
import { DealStructureType } from '../types/domain';

interface FaqSectionProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
}

export const FaqSection: React.FC<FaqSectionProps> = ({ onOpenModal }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="relative py-16 lg:py-24 border-t border-slate-800/80 bg-[#060916]"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-mono uppercase tracking-wider">
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Acquisition &amp; Escrow FAQ</span>
          </div>
          <h2 className="font-display text-2xl sm:text-4xl font-extrabold text-white">
            Frequently Asked Questions
          </h2>
          <p className="text-sm sm:text-base text-slate-400">
            Everything founders, legal teams, and domain investors need to know
            about acquiring <strong className="text-white">VigoChat.com</strong>.
          </p>
        </div>

        <div className="space-y-3.5">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl glass-card border border-slate-800/90 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                >
                  <span className="font-display font-bold text-sm sm:text-base text-white">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-indigo-400 flex-shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-cyan-300' : ''
                    }`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                    >
                      <div className="px-6 pb-5 pt-1 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-slate-800/60">
                        {item.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-10 p-6 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-violet-950/50 to-cyan-950/60 border border-indigo-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <h3 className="font-display font-bold text-base text-white">
              Have a custom structure or broker question?
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Speak directly with the VigoChat.com domain seller via WhatsApp or
              Email.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'investor',
                sourceLabel: 'FAQ Direct Contact Banner',
              })
            }
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 whitespace-nowrap transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4 text-cyan-300" />
            <span>Open Direct Contact &amp; Offer Modal</span>
          </button>
        </div>
      </div>
    </section>
  );
};
