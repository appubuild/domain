import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ShieldCheck,
  MessageCircle,
  Mail,
  Send,
  CheckCircle2,
  Sparkles,
  Copy,
  Check,
  DollarSign,
  Lock,
  Building2,
} from 'lucide-react';
import {
  DealStructureType,
  MarketplaceId,
  ModalTriggerContext,
} from '../types/domain';
import { VigoLogo } from './VigoLogo';

interface AcquisitionModalProps {
  modalState: ModalTriggerContext;
  onClose: () => void;
}

export const AcquisitionModal: React.FC<AcquisitionModalProps> = ({
  modalState,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [offerAmount, setOfferAmount] = useState('24800');
  const [dealType, setDealType] = useState<DealStructureType>('outright');
  const [marketplace, setMarketplace] = useState<MarketplaceId>('escrow');
  const [message, setMessage] = useState(
    'Hello, I am interested in acquiring vigochat.com. Please share the Escrow.com transaction link or next steps.'
  );
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [referenceId, setReferenceId] = useState('VG-88412');

  useEffect(() => {
    if (modalState.isOpen) {
      if (modalState.dealType) {
        setDealType(modalState.dealType);
      }
      if (modalState.prefilledOffer) {
        setOfferAmount(modalState.prefilledOffer);
      }
      if (modalState.preferredMarketplace) {
        setMarketplace(modalState.preferredMarketplace);
      }
      setIsSubmitted(false);
      setReferenceId(`VG-${Math.floor(10000 + Math.random() * 90000)}`);
    }
  }, [modalState]);

  if (!modalState.isOpen) return null;

  const whatsappMessage = encodeURIComponent(
    'Hello, I am interested in acquiring vigochat.com.'
  );
  const whatsappUrl = `https://wa.me/?text=${whatsappMessage}`;

  const mailtoSubject = encodeURIComponent(
    `Acquisition Inquiry: VigoChat.com (Offer: $${offerAmount} USD)`
  );
  const mailtoBody = encodeURIComponent(
    `Hello,\n\nI am interested in acquiring vigochat.com.\n\nName: ${
      name || '[Your Name]'
    }\nDeal Structure: ${dealType.toUpperCase()}\nOffer / Terms: $${offerAmount} USD\nPreferred Escrow / Marketplace: ${marketplace.toUpperCase()}\n\nMessage:\n${message}`
  );
  const mailtoUrl = `mailto:acquisitions@vigochat.com?subject=${mailtoSubject}&body=${mailtoBody}`;

  const handleCopyEmail = () => {
    navigator.clipboard?.writeText('acquisitions@vigochat.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2500);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  return (
    <AnimatePresence>
      {modalState.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          {/* Backdrop Click to Close */}
          <div className="fixed inset-0" onClick={onClose} />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 w-full max-w-2xl rounded-3xl bg-[#090D1F] border border-indigo-500/40 shadow-2xl shadow-indigo-950/90 overflow-hidden my-auto"
          >
            {/* Top Gradient Accent Bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" />

            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#0B1026] border-b border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <VigoLogo size="sm" showBadge={false} />
                {modalState.sourceLabel && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    {modalState.sourceLabel}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
                aria-label="Close Acquisition Modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 sm:p-7 max-h-[82vh] overflow-y-auto space-y-6">
              {/* Direct Contact Channels (WhatsApp & Email) */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Instant Direct Contact Channels
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Seller Online • Avg Reply &lt; 15m
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* WhatsApp Button with Pre-Filled Message */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
                        <MessageCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-white group-hover:text-emerald-200">
                          Chat on WhatsApp
                        </div>
                        <div className="text-[11px] text-emerald-300/90 font-mono">
                          Pre-filled acquisition inquiry
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-300">
                      Open →
                    </span>
                  </a>

                  {/* Direct Email Trigger + Copy Button */}
                  <div className="flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/40">
                    <a
                      href={mailtoUrl}
                      className="flex items-center gap-3 flex-1 min-w-0 group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/20">
                        <Mail className="w-5 h-5" />
                      </div>
                      <div className="truncate">
                        <div className="text-xs sm:text-sm font-bold text-white group-hover:text-cyan-200 truncate">
                          Direct Email Dispatch
                        </div>
                        <div className="text-[11px] font-mono text-indigo-300 truncate">
                          acquisitions@vigochat.com
                        </div>
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      title="Copy Email Address"
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-mono flex items-center gap-1 flex-shrink-0"
                    >
                      {copiedEmail ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800" />
                <span className="flex-shrink mx-3 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Or Submit Official Escrow Offer Form
                </span>
                <div className="flex-grow border-t border-slate-800" />
              </div>

              {/* Quick Offer Form or Submitted Confirmation */}
              {!isSubmitted ? (
                <form onSubmit={handleFormSubmit} className="space-y-4">
                  {/* Deal Structure & Marketplace Selector Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1.5">
                        Deal Structure
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
                        {(
                          [
                            { id: 'outright', label: 'Buy Outright' },
                            { id: 'lease', label: 'Lease-to-Own' },
                            { id: 'investor', label: 'Make Offer' },
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setDealType(tab.id);
                              if (tab.id === 'outright') setOfferAmount('24800');
                              if (tab.id === 'lease')
                                setOfferAmount('1033/mo (24m)');
                              if (tab.id === 'investor') setOfferAmount('18500');
                            }}
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                              dealType === tab.id
                                ? 'bg-indigo-600 text-white shadow'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1.5">
                        Preferred Escrow / Marketplace
                      </label>
                      <div className="relative">
                        <Building2 className="w-4 h-4 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          value={marketplace}
                          onChange={(e) =>
                            setMarketplace(e.target.value as MarketplaceId)
                          }
                          className="w-full bg-slate-900/90 border border-slate-700/90 focus:border-indigo-500 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm text-white focus:outline-none"
                        >
                          <option value="escrow">
                            Escrow.com Direct (0% Buyer Markup)
                          </option>
                          <option value="atom">
                            Atom.com / Squadhelp Verified
                          </option>
                          <option value="godaddy">
                            GoDaddy Auctions / Fast Transfer
                          </option>
                          <option value="afternic">
                            Afternic DLS Registrar Network
                          </option>
                          <option value="sedo">Sedo.com Certified Escrow</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Name & Email */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="buyer-name"
                        className="block text-xs font-mono text-slate-300 mb-1.5"
                      >
                        Your Full Name or Company *
                      </label>
                      <input
                        id="buyer-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Rivera / Acme AI Inc."
                        className="w-full bg-slate-900/90 border border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="buyer-email"
                        className="block text-xs font-mono text-slate-300 mb-1.5"
                      >
                        Corporate or Founder Email *
                      </label>
                      <input
                        id="buyer-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="founder@company.com"
                        className="w-full bg-slate-900/90 border border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Offer Amount (USD) + Quick Preset Chips */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor="buyer-offer"
                        className="block text-xs font-mono text-slate-300"
                      >
                        Offer Amount (USD) *
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400">
                          Quick Presets:
                        </span>
                        {[
                          { label: '$15,000', val: '15000' },
                          { label: '$19,500', val: '19500' },
                          { label: '$24,800 (BIN)', val: '24800' },
                          { label: 'Lease $1,033/mo', val: '1033/mo (24m)' },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() => setOfferAmount(chip.val)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 hover:bg-indigo-600/40 text-cyan-300 border border-slate-700 transition-colors"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="relative">
                      <DollarSign className="w-4 h-4 text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="buyer-offer"
                        type="text"
                        required
                        value={offerAmount}
                        onChange={(e) => setOfferAmount(e.target.value)}
                        placeholder="24800"
                        className="w-full bg-slate-900/90 border border-slate-700/90 focus:border-indigo-500 rounded-xl pl-9 pr-16 py-2.5 font-mono text-base font-bold text-white placeholder-slate-500 focus:outline-none"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                        USD
                      </span>
                    </div>
                  </div>

                  {/* Message Field */}
                  <div>
                    <label
                      htmlFor="buyer-message"
                      className="block text-xs font-mono text-slate-300 mb-1.5"
                    >
                      Message / Escrow Instructions
                    </label>
                    <textarea
                      id="buyer-message"
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full bg-slate-900/90 border border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm sm:text-base text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      Submit Acquisition Offer (${offerAmount} via{' '}
                      {marketplace.toUpperCase()})
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] font-mono text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      100% Escrow Protected
                    </span>
                    <span className="flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5 text-cyan-400" />
                      256-Bit SSL Confidential
                    </span>
                  </div>
                </form>
              ) : (
                /* Interactive Submission Confirmation State */
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-6 rounded-2xl bg-gradient-to-b from-emerald-950/40 to-slate-900/90 border border-emerald-500/40 text-center space-y-4"
                >
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div className="space-y-1">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/20 text-emerald-300">
                      Escrow Inquiry Logged • Ref #{referenceId}
                    </span>
                    <h4 className="font-display text-xl font-bold text-white">
                      Offer Ready for Priority Dispatch
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto">
                      Thank you, <strong className="text-white">{name}</strong>.
                      Your <strong className="text-cyan-300">${offerAmount} USD</strong>{' '}
                      ({dealType}) inquiry for{' '}
                      <strong className="text-white">VigoChat.com</strong> via{' '}
                      <strong className="text-indigo-300">
                        {marketplace.toUpperCase()}
                      </strong>{' '}
                      has been prepared.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                    <a
                      href={mailtoUrl}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2"
                    >
                      <Mail className="w-4 h-4" />
                      <span>Send via Email Client Now</span>
                    </a>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>Fast-Track on WhatsApp</span>
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSubmitted(false)}
                    className="text-xs font-mono text-slate-400 hover:text-white underline"
                  >
                    ← Edit Offer Details
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
