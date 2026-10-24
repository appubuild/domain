import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Send,
  Sparkles,
  ShieldCheck,
  Zap,
  Activity,
  RotateCcw,
  CheckCheck,
  Cpu,
  Globe,
  Lock,
} from 'lucide-react';
import { SITE_CONFIG } from '../config';
import { HERO_CHAT_PERSONAS } from '../data/domainData';
import { ChatMessage, DealStructureType } from '../types/domain';

interface InteractiveChatWidgetProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
}

export const InteractiveChatWidget: React.FC<InteractiveChatWidgetProps> = ({
  onOpenModal,
}) => {
  const [activePersonaIndex, setActivePersonaIndex] = useState(0);
  const activePersona = HERO_CHAT_PERSONAS[activePersonaIndex];

  const [messages, setMessages] = useState<ChatMessage[]>(
    activePersona.initialMessages
  );
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const monthlyLease = Math.round(
    SITE_CONFIG.pricing.binPrice / SITE_CONFIG.pricing.defaultLeaseMonths
  );

  useEffect(() => {
    setMessages(HERO_CHAT_PERSONAS[activePersonaIndex].initialMessages);
    setIsTyping(false);
  }, [activePersonaIndex]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSendMessage = (
    promptText: string,
    customReply?: string,
    customLatency?: string,
    customTag?: string
  ) => {
    const trimmed = promptText.trim();
    if (!trimmed || isTyping) return;

    const now = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      authorName: 'You (Live Visitor)',
      authorRole: 'Founder / Buyer Preview',
      text: trimmed,
      timestamp: now,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    setTimeout(() => {
      let generatedReply = customReply;
      let latency = customLatency || '36ms';
      let tag = customTag || 'Live Neural Stream';

      if (!generatedReply) {
        const lower = trimmed.toLowerCase();
        if (
          lower.includes('price') ||
          lower.includes('buy') ||
          lower.includes('cost') ||
          lower.includes('offer') ||
          lower.includes('lease')
        ) {
          generatedReply = `${SITE_CONFIG.displayDomain} is available for immediate Buy-It-Now acquisition at $${SITE_CONFIG.pricing.binPrice.toLocaleString()} ${SITE_CONFIG.pricing.currency} or Lease-to-Own from $${monthlyLease.toLocaleString()}/month over ${SITE_CONFIG.pricing.defaultLeaseMonths} months via ${SITE_CONFIG.marketplaces.escrow.shortName}. Click "Acquire Domain" below to lock in ownership or submit a custom offer!`;
          tag = 'Escrow Verified • Instant Push';
          latency = '28ms';
        } else if (lower.includes('brand') || lower.includes('domain')) {
          generatedReply = `At just ${SITE_CONFIG.brandPrefix.length} letters and 3 crisp syllables (${SITE_CONFIG.phoneticSpelling}), ${SITE_CONFIG.displayDomain} combines "Vigor" (energy, life, speed) with the #1 category keyword "Chat". Zero spam flags, 100% ${SITE_CONFIG.tld} authority.`;
          tag = 'Brand Valuation Engine';
          latency = '33ms';
        } else {
          generatedReply = `[${SITE_CONFIG.brandPrefix} ${activePersona.badge} Engine]: Processed "${trimmed}" across 4 global edge nodes with zero-knowledge encryption. Imagine your own SaaS product or AI agent running live on ${SITE_CONFIG.displayDomain}!`;
          tag = 'Simulated Live Response';
          latency = '41ms';
        }
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        authorName: `${SITE_CONFIG.brandPrefix} AI`,
        authorRole: activePersona.label,
        text: generatedReply,
        timestamp: now,
        metrics: {
          latency,
          confidence: '99.8% Verified',
          tag,
        },
      };

      setIsTyping(false);
      setMessages((prev) => [...prev, aiMsg]);
    }, 650);
  };

  const handleResetChat = () => {
    setMessages(activePersona.initialMessages);
    setIsTyping(false);
  };

  return (
    <div id="hero-demo" className="relative w-full">
      {/* Ambient Multi-Layer Glow Behind Widget */}
      <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/20 via-violet-500/15 to-cyan-500/20 rounded-3xl blur-2xl pointer-events-none" />

      {/* Floating Glassmorphic SaaS Window */}
      <div className="relative rounded-3xl glass-card glow-border-indigo overflow-hidden border border-indigo-400/40">
        {/* Top macOS / SaaS Window Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50 dark:bg-[#090D1E]/95 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 dark:bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 dark:bg-emerald-400" />
              </span>
              <span className="font-mono text-xs font-bold text-slate-900 dark:text-white tracking-tight">
                {SITE_CONFIG.appPreviewDomain}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                <Lock className="w-2.5 h-2.5" />
                TLS 1.3 E2EE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTelemetry((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold flex items-center gap-1.5 border transition-colors ${
                showTelemetry
                  ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/40'
                  : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>HUD</span>
            </button>
            <button
              type="button"
              onClick={handleResetChat}
              title="Reset interactive demo conversation"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900/90 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Persona Switcher Tabs */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-100/80 dark:bg-[#0B1024]/90 border-b border-slate-200 dark:border-slate-800/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {HERO_CHAT_PERSONAS.map((persona, idx) => {
            const isActive = idx === activePersonaIndex;
            return (
              <button
                key={persona.id}
                type="button"
                onClick={() => setActivePersonaIndex(idx)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30 border border-indigo-400/40'
                    : 'bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-slate-200/70 dark:border-transparent'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive
                      ? 'bg-cyan-300 animate-pulse'
                      : 'bg-slate-400 dark:bg-slate-500'
                  }`}
                />
                <span className={isActive ? 'text-white' : ''}>
                  {persona.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Optional Telemetry Strip */}
        <AnimatePresence>
          {showTelemetry && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-indigo-50/80 dark:bg-indigo-950/30 border-b border-indigo-200/70 dark:border-indigo-500/20 px-4 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-700 dark:text-slate-300"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
                <span>{activePersona.statusText}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <Globe className="w-3 h-3" /> 99.999% SLA
                </span>
                <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                  {activePersona.badge}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Chat Stream Area */}
        <div
          ref={chatContainerRef}
          className="p-4 sm:p-5 h-[310px] sm:h-[330px] overflow-y-auto space-y-4 bg-gradient-to-b from-slate-50 to-indigo-50/40 dark:from-[#070A17] dark:to-[#0A0E22]"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isAi = msg.sender === 'ai';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`flex flex-col ${
                    isAi ? 'items-start' : 'items-end'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1">
                    {isAi && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-tr from-indigo-500 to-cyan-400 text-white">
                        <Bot className="w-3.5 h-3.5 text-white" />
                      </span>
                    )}
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {msg.authorName}
                    </span>
                    {msg.authorRole && (
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        • {msg.authorRole}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      {msg.timestamp}
                    </span>
                  </div>

                  <div
                    className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                      isAi
                        ? 'bg-white dark:bg-[#121836]/95 border border-indigo-200 dark:border-indigo-500/30 text-slate-800 dark:text-slate-100 rounded-tl-sm shadow-md dark:shadow-lg shadow-slate-200/60 dark:shadow-indigo-950/30'
                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-tr-sm shadow-md shadow-indigo-600/20'
                    }`}
                  >
                    <p className={isAi ? '' : 'text-white'}>{msg.text}</p>

                    {isAi && msg.metrics && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-indigo-400/20 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                            <Zap className="w-2.5 h-2.5" />
                            {msg.metrics.latency}
                          </span>
                          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">
                            {msg.metrics.confidence}
                          </span>
                        </div>
                        <span className="text-indigo-700 dark:text-indigo-300 font-semibold flex items-center gap-1">
                          <CheckCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          {msg.metrics.tag}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Animated Typing Indicator */}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#121836] border border-indigo-200 dark:border-indigo-500/30 w-fit shadow-sm"
            >
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 rounded-full bg-violet-500 dark:bg-violet-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 rounded-full bg-cyan-500 dark:bg-cyan-400 animate-bounce" />
              </div>
              <span className="text-xs font-mono text-indigo-700 dark:text-indigo-200">
                {SITE_CONFIG.brandPrefix} AI is synthesizing response...
              </span>
            </motion.div>
          )}
        </div>

        {/* Interactive Quick Prompt Chips */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50 dark:bg-[#090D1E] border-t border-slate-200 dark:border-slate-800/80">
          <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-indigo-600 dark:text-cyan-400" />
              Click a live prompt or type below to test {SITE_CONFIG.brandPrefix}:
            </span>
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold hidden sm:inline">
              Interactive Demo
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {activePersona.quickPrompts.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  handleSendMessage(q.prompt, q.aiReply, q.latency, q.tag)
                }
                disabled={isTyping}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-900/90 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 text-slate-700 dark:text-slate-300 hover:text-indigo-700 dark:hover:text-indigo-300 border border-slate-200 dark:border-slate-700/80 hover:border-indigo-400 dark:hover:border-indigo-500/50 whitespace-nowrap transition-all disabled:opacity-50"
              >
                {q.prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Live Message Input Bar + Instant Domain CTA */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
          className="p-3 sm:px-5 sm:py-3.5 bg-white dark:bg-[#060916] border-t border-slate-200 dark:border-slate-800/90 flex items-center gap-2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Ask ${SITE_CONFIG.brandPrefix} AI anything or test a command...`}
            className="flex-1 bg-slate-100 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700/80 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isTyping}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
          >
            <span className="text-white">Send</span>
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </form>

        {/* Bottom Acquisition Strip inside Widget */}
        <div className="px-4 sm:px-5 py-2.5 bg-gradient-to-r from-indigo-50 via-violet-50 to-cyan-50 dark:from-indigo-950/80 dark:via-violet-950/80 dark:to-cyan-950/80 border-t border-indigo-200 dark:border-indigo-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-700 dark:text-indigo-100">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span>
              Want to launch this exact brand?{' '}
              <strong className="font-bold text-slate-900 dark:text-white underline decoration-indigo-400/50">
                {SITE_CONFIG.displayDomain}
              </strong>{' '}
              is ready for instant transfer.
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              onOpenModal({
                dealType: 'outright',
                prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                sourceLabel: 'Interactive Chat Widget Footer',
              })
            }
            className="font-mono font-bold text-indigo-700 dark:text-cyan-300 hover:underline underline-offset-4"
          >
            Claim Domain →
          </button>
        </div>
      </div>
    </div>
  );
};
