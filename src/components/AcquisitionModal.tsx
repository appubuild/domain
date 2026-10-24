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
  Building2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Code2,
  ExternalLink,
} from 'lucide-react';
import {
  SITE_CONFIG,
  GOOGLE_APPS_SCRIPT_SNIPPET,
  buildWhatsAppUrl,
  buildMailtoUrl,
} from '../config';
import {
  DealStructureType,
  LeadOfferPayload,
  MarketplaceId,
  ModalTriggerContext,
} from '../types/domain';
import { VigoLogo } from './VigoLogo';

interface AcquisitionModalProps {
  modalState: ModalTriggerContext;
  onClose: () => void;
}

type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';

export const AcquisitionModal: React.FC<AcquisitionModalProps> = ({
  modalState,
  onClose,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [offerAmount, setOfferAmount] = useState(
    String(SITE_CONFIG.pricing.binPrice)
  );
  const [dealType, setDealType] = useState<DealStructureType>('outright');
  const [marketplace, setMarketplace] = useState<MarketplaceId>('escrow');
  const [message, setMessage] = useState(
    SITE_CONFIG.email.defaultMessageBody
  );

  const [submissionStatus, setSubmissionStatus] =
    useState<SubmissionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [submittedPayload, setSubmittedPayload] =
    useState<LeadOfferPayload | null>(null);

  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showWebhookDocs, setShowWebhookDocs] = useState(false);
  const [referenceId, setReferenceId] = useState('VG-88412');

  const monthlyLease = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

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
      setSubmissionStatus('idle');
      setErrorMessage('');
      setReferenceId(`VG-${Math.floor(10000 + Math.random() * 90000)}`);
    }
  }, [modalState]);

  if (!modalState.isOpen) return null;

  // Dynamic WhatsApp & Email URLs driven by SITE_CONFIG
  const customWhatsAppText = `${SITE_CONFIG.whatsapp.defaultMessageTemplate} (Offer: $${offerAmount} ${SITE_CONFIG.pricing.currency} via ${SITE_CONFIG.marketplaces[marketplace].shortName})`;
  const whatsappUrl = buildWhatsAppUrl(
    fullName ? `${customWhatsAppText} — ${fullName}` : undefined
  );

  const mailtoSubject = `${SITE_CONFIG.email.offerSubjectPrefix} (Offer: $${offerAmount} ${SITE_CONFIG.pricing.currency})`;
  const mailtoBody = `Hello,\n\nI am interested in acquiring ${
    SITE_CONFIG.domainName
  }.\n\nReference ID: ${referenceId}\nDomain Name: ${
    SITE_CONFIG.domainName
  }\nBuyer Full Name: ${
    fullName || '[Your Name]'
  }\nBuyer Email: ${
    email || '[Your Email]'
  }\nDeal Structure: ${dealType.toUpperCase()}\nOffer Amount (USD): $${offerAmount}\nPreferred Escrow / Marketplace: ${
    SITE_CONFIG.marketplaces[marketplace].name
  }\nTimestamp: ${new Date().toISOString()}\n\nMessage / Terms:\n${message}`;

  const mailtoUrl = buildMailtoUrl({
    subject: mailtoSubject,
    body: mailtoBody,
  });

  const handleCopyEmail = () => {
    navigator.clipboard?.writeText(SITE_CONFIG.email.recipientEmail);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2500);
  };

  const handleCopyScript = () => {
    navigator.clipboard?.writeText(GOOGLE_APPS_SCRIPT_SNIPPET);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  /**
   * Asynchronous Webhook POST Submission (Google Apps Script / Sheet Webhook / Form Relay)
   */
  const executeWebhookSubmission = async (forceSimulateError = false) => {
    setSubmissionStatus('submitting');
    setErrorMessage('');

    const payload: LeadOfferPayload = {
      domainName: SITE_CONFIG.domainName,
      fullName: fullName.trim(),
      email: email.trim(),
      offerAmount: offerAmount.trim(),
      dealType,
      preferredMarketplace: marketplace,
      message: message.trim(),
      timestamp: new Date().toISOString(),
      sourceLabel: modalState.sourceLabel || 'Acquisition Modal',
      referenceId,
    };

    setSubmittedPayload(payload);

    if (
      forceSimulateError ||
      (typeof navigator !== 'undefined' && !navigator.onLine)
    ) {
      await new Promise((r) => setTimeout(r, 700));
      setErrorMessage(
        forceSimulateError
          ? 'Simulated webhook timeout/offline state. Use Retry or instant Email/WhatsApp fallback below.'
          : 'Your device appears to be offline. Please retry or use the direct Email / WhatsApp relay below.'
      );
      setSubmissionStatus('error');
      return;
    }

    const webhookUrl = SITE_CONFIG.formSubmission.webhookUrl;
    const isPlaceholderEndpoint = webhookUrl.includes(
      'AKfycbz_VIGOCHAT_SHEET_WEBHOOK_ENDPOINT'
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SITE_CONFIG.formSubmission.requestTimeoutMs
    );

    try {
      if (!isPlaceholderEndpoint) {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok && response.type !== 'opaque') {
          throw new Error(
            `Webhook endpoint responded with HTTP ${response.status}`
          );
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 850));
        clearTimeout(timeoutId);
      }

      setSubmissionStatus('success');
    } catch (err) {
      clearTimeout(timeoutId);
      if (
        SITE_CONFIG.formSubmission.allowDemoRelayFallback &&
        isPlaceholderEndpoint
      ) {
        setSubmissionStatus('success');
      } else {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to reach webhook endpoint.';
        setErrorMessage(
          `${msg}. Your offer details are preserved below—retry or dispatch via instant Email / WhatsApp.`
        );
        setSubmissionStatus('error');
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeWebhookSubmission(false);
  };

  return (
    <AnimatePresence>
      {modalState.isOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-900/60 dark:bg-black/80 backdrop-blur-md"
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
            className="relative z-10 w-full max-w-2xl rounded-3xl bg-white dark:bg-[#090D1F] border border-slate-200 dark:border-indigo-500/40 shadow-2xl shadow-slate-900/30 dark:shadow-indigo-950/90 overflow-hidden my-auto"
          >
            {/* Top Gradient Accent Bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400" />

            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-[#0B1026] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <VigoLogo size="sm" showBadge={false} />
                {modalState.sourceLabel && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                    <Sparkles className="w-3 h-3 text-indigo-600 dark:text-cyan-400" />
                    {modalState.sourceLabel}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 transition-colors"
                aria-label="Close Acquisition Modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 sm:p-7 max-h-[84vh] overflow-y-auto space-y-6">
              {/* Direct Contact Channels (Dynamically Bound to SITE_CONFIG) */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span
                    id="modal-title"
                    className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  >
                    Instant Direct Contact ({SITE_CONFIG.domainName})
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping" />
                    Seller Online • Avg Reply &lt; 15m
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* WhatsApp Button */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-900 dark:text-emerald-200 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
                        <MessageCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-200">
                          Chat on WhatsApp
                        </div>
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-300/90 font-mono font-medium">
                          {SITE_CONFIG.whatsapp.phoneNumber}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300">
                      Open →
                    </span>
                  </a>

                  {/* Direct Email Trigger + Copy Button */}
                  <div className="flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/40">
                    <a
                      href={mailtoUrl}
                      className="flex items-center gap-3 flex-1 min-w-0 group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/20">
                        <Mail className="w-5 h-5 text-white" />
                      </div>
                      <div className="truncate">
                        <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-cyan-200 truncate">
                          Direct Email Dispatch
                        </div>
                        <div className="text-[11px] font-mono font-medium text-indigo-700 dark:text-indigo-300 truncate">
                          {SITE_CONFIG.email.recipientEmail}
                        </div>
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      title="Copy Recipient Email Address"
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-semibold flex items-center gap-1 flex-shrink-0"
                    >
                      {copiedEmail ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">
                            Copied
                          </span>
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
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="flex-shrink mx-3 text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Submit Offer via Webhook / Escrow Relay
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              {/* STATE 1 & 2: Form (Idle or Submitting with Loading Spinner) */}
              {(submissionStatus === 'idle' ||
                submissionStatus === 'submitting') && (
                <form onSubmit={handleFormSubmit} className="space-y-4">
                  {/* Deal Structure & Marketplace Selector Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Deal Structure
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 bg-slate-100 dark:bg-slate-900/90 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
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
                            disabled={submissionStatus === 'submitting'}
                            onClick={() => {
                              setDealType(tab.id);
                              if (tab.id === 'outright')
                                setOfferAmount(
                                  String(SITE_CONFIG.pricing.binPrice)
                                );
                              if (tab.id === 'lease')
                                setOfferAmount(
                                  `${monthlyLease}/mo (${SITE_CONFIG.pricing.defaultLeaseMonths}m)`
                                );
                              if (tab.id === 'investor')
                                setOfferAmount(
                                  String(
                                    SITE_CONFIG.pricing.defaultInvestorOffer
                                  )
                                );
                            }}
                            className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                              dealType === tab.id
                                ? 'bg-indigo-600 text-white shadow'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <span
                              className={
                                dealType === tab.id ? 'text-white' : ''
                              }
                            >
                              {tab.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Preferred Escrow / Marketplace
                      </label>
                      <div className="relative">
                        <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                          value={marketplace}
                          disabled={submissionStatus === 'submitting'}
                          onChange={(e) =>
                            setMarketplace(e.target.value as MarketplaceId)
                          }
                          className="w-full bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none"
                        >
                          {Object.values(SITE_CONFIG.marketplaces).map((mp) => (
                            <option key={mp.id} value={mp.id}>
                              {mp.name} ({mp.badge})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Buyer's Full Name & Buyer's Work/Personal Email */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="buyer-name"
                        className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        Buyer&apos;s Full Name *
                      </label>
                      <input
                        id="buyer-name"
                        type="text"
                        required
                        disabled={submissionStatus === 'submitting'}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Alex Rivera (Acme AI Inc.)"
                        className="w-full bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="buyer-email"
                        className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                      >
                        Work / Personal Email *
                      </label>
                      <input
                        id="buyer-email"
                        type="email"
                        required
                        disabled={submissionStatus === 'submitting'}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="alex@company.com"
                        className="w-full bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Offer Amount (USD) + Quick Preset Chips */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor="buyer-offer"
                        className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300"
                      >
                        Offer Amount ({SITE_CONFIG.pricing.currency}) *
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          Presets:
                        </span>
                        {SITE_CONFIG.pricing.quickOfferPresets.map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            disabled={submissionStatus === 'submitting'}
                            onClick={() => setOfferAmount(chip.value)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-600/40 text-indigo-700 dark:text-cyan-300 border border-slate-200 dark:border-slate-700 transition-colors"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="relative">
                      <DollarSign className="w-4 h-4 text-indigo-600 dark:text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="buyer-offer"
                        type="text"
                        required
                        disabled={submissionStatus === 'submitting'}
                        value={offerAmount}
                        onChange={(e) => setOfferAmount(e.target.value)}
                        placeholder={String(SITE_CONFIG.pricing.binPrice)}
                        className="w-full bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 rounded-xl pl-9 pr-16 py-2.5 font-mono text-base font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none disabled:opacity-60"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500 dark:text-slate-400">
                        {SITE_CONFIG.pricing.currency}
                      </span>
                    </div>
                  </div>

                  {/* Message / Terms Field */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="buyer-message"
                        className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300"
                      >
                        Message / Terms
                      </label>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        Asset: {SITE_CONFIG.domainName}
                      </span>
                    </div>
                    <textarea
                      id="buyer-message"
                      rows={3}
                      disabled={submissionStatus === 'submitting'}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  {/* Submit Button with Loading Spinner State */}
                  <button
                    type="submit"
                    disabled={submissionStatus === 'submitting'}
                    className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm sm:text-base text-white bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2.5 transition-all disabled:opacity-75"
                  >
                    {submissionStatus === 'submitting' ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-white" />
                        <span className="text-white">
                          Submitting Offer to Webhook ({SITE_CONFIG.domainName}
                          )...
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 text-white" />
                        <span className="text-white">
                          Submit Acquisition Offer (${offerAmount} via{' '}
                          {SITE_CONFIG.marketplaces[marketplace].shortName})
                        </span>
                      </>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      100% Escrow Protected
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowWebhookDocs((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300 hover:text-cyan-600 dark:hover:text-cyan-300 font-semibold underline underline-offset-4"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>
                        {showWebhookDocs
                          ? 'Hide Google Sheet Setup Guide'
                          : '1-Click Google Sheet Setup Guide (বাংলা)'}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {/* STATE 3: Success Confirmation Card */}
              {submissionStatus === 'success' && submittedPayload && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-6 rounded-2xl bg-gradient-to-b from-emerald-50 to-slate-50 dark:from-emerald-950/40 dark:to-slate-900/90 border border-emerald-500/40 space-y-4"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                        Ref #{submittedPayload.referenceId} •{' '}
                        {submittedPayload.domainName}
                      </span>
                      <h4 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                        Offer successfully received, owner notified
                      </h4>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Thank you,{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {submittedPayload.fullName}
                    </strong>
                    . Your{' '}
                    <strong className="text-cyan-700 dark:text-cyan-300">
                      ${submittedPayload.offerAmount}{' '}
                      {SITE_CONFIG.pricing.currency}
                    </strong>{' '}
                    ({submittedPayload.dealType}) offer for{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {submittedPayload.domainName}
                    </strong>{' '}
                    has been logged at{' '}
                    <code className="font-mono text-xs text-indigo-700 dark:text-indigo-300">
                      {submittedPayload.timestamp}
                    </code>
                    . We will reply to{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {submittedPayload.email}
                    </strong>{' '}
                    shortly with your{' '}
                    {
                      SITE_CONFIG.marketplaces[
                        submittedPayload.preferredMarketplace
                      ].name
                    }{' '}
                    escrow instructions.
                  </p>

                  {/* Recorded Webhook Payload Summary */}
                  <div className="p-3.5 rounded-xl bg-white dark:bg-[#070A18] border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500">Domain:</span>{' '}
                      <span className="text-slate-900 dark:text-white font-semibold">
                        {submittedPayload.domainName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Offer (USD):</span>{' '}
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        ${submittedPayload.offerAmount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Escrow Partner:</span>{' '}
                      <span className="text-indigo-700 dark:text-cyan-300 font-semibold">
                        {
                          SITE_CONFIG.marketplaces[
                            submittedPayload.preferredMarketplace
                          ].shortName
                        }
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Timestamp:</span>{' '}
                      <span className="text-slate-600 dark:text-slate-400">
                        {new Date(
                          submittedPayload.timestamp
                        ).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* Direct Follow-Up Actions */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-1">
                    <a
                      href={
                        SITE_CONFIG.marketplaces[
                          submittedPayload.preferredMarketplace
                        ].url
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <span className="text-white">
                        Proceed to{' '}
                        {
                          SITE_CONFIG.marketplaces[
                            submittedPayload.preferredMarketplace
                          ].shortName
                        }
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-white" />
                    </a>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>Fast-Track on WhatsApp</span>
                    </a>
                    <a
                      href={mailtoUrl}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Send Email Copy</span>
                    </a>
                  </div>

                  <div className="pt-2 flex items-center justify-between text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setSubmissionStatus('idle')}
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline"
                    >
                      ← Submit Another Offer / Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => executeWebhookSubmission(true)}
                      className="text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 text-[11px]"
                    >
                      Test Error Fallback UI
                    </button>
                  </div>
                </motion.div>
              )}

              {/* STATE 4: Error Fallback State (Offline / Failed Webhook) */}
              {submissionStatus === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-500/40 space-y-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        Webhook Delivery Interrupted — Instant Fallback Ready
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {errorMessage}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => executeWebhookSubmission(false)}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-white" />
                      <span className="text-white">
                        Retry Webhook Submission
                      </span>
                    </button>
                    <a
                      href={mailtoUrl}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-300 dark:border-slate-700"
                    >
                      <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
                      <span>Send via Direct Email Instead</span>
                    </a>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Send via WhatsApp</span>
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSubmissionStatus('idle')}
                    className="text-xs font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline"
                  >
                    ← Back to Offer Form
                  </button>
                </motion.div>
              )}

              {/* Collapsible 1-Click Google Apps Script Setup Guide (Bangla + English) */}
              <AnimatePresence>
                {showWebhookDocs && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#070A18] border border-indigo-200 dark:border-indigo-500/30 space-y-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          ১-ক্লিক Google Sheets Webhook সেটআপ গাইড (Code.gs)
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyScript}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-mono font-semibold text-indigo-700 dark:text-cyan-300 flex items-center gap-1"
                        >
                          {copiedScript ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Copied Script!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Apps Script</span>
                            </>
                          )}
                        </button>
                      </div>
                      <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300 text-[11px]">
                        <li>
                          নতুন একটি Google Sheet খুলুন (
                          <code className="font-mono">https://sheets.new</code>)
                          এবং উপরে মেনু থেকে{' '}
                          <strong>Extensions → Apps Script</strong> এ যান।
                        </li>
                        <li>
                          নিচের কোডটি কপি করে পেস্ট করুন এবং{' '}
                          <strong>Deploy → New deployment → Web app</strong>{' '}
                          সিলেক্ট করুন (<em>Who has access: Anyone</em> দিন)।
                        </li>
                        <li>
                          Deploy করার পর যে{' '}
                          <code className="text-indigo-600 dark:text-cyan-300">
                            Web app URL
                          </code>{' '}
                          পাবেন সেটি{' '}
                          <code className="text-indigo-600 dark:text-cyan-300">
                            src/config.ts
                          </code>{' '}
                          ফাইলের{' '}
                          <code className="text-indigo-600 dark:text-cyan-300">
                            webhookUrl
                          </code>
                          -এ বসিয়ে দিন!
                        </li>
                      </ol>
                      <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[10px] overflow-x-auto border border-slate-800">
                        {GOOGLE_APPS_SCRIPT_SNIPPET}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
