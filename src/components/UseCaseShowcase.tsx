import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Users,
  Shield,
  Video,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Zap,
  Lock,
  Radio,
  FileText,
  Globe,
  Activity,
  Layers,
} from 'lucide-react';
import { SITE_CONFIG } from '../config';
import { USE_CASES_DATA } from '../data/domainData';
import { DealStructureType, UseCaseItem } from '../types/domain';

interface UseCaseShowcaseProps {
  onOpenModal: (options?: {
    dealType?: DealStructureType;
    prefilledOffer?: string;
    sourceLabel?: string;
  }) => void;
}

export const UseCaseShowcase: React.FC<UseCaseShowcaseProps> = ({
  onOpenModal,
}) => {
  const [selectedTab, setSelectedTab] = useState<string>('all');

  // Interactive micro-states inside the 4 Bento cards
  const [crmResolvedCount, setCrmResolvedCount] = useState(1482);
  const [crmActionTriggered, setCrmActionTriggered] = useState(false);

  const [zkGateUnlocked, setZkGateUnlocked] = useState(true);
  const [threadSummarized, setThreadSummarized] = useState(false);
  const [telehealthLang, setTelehealthLang] = useState<
    'EN' | 'ES' | 'DE' | 'JP'
  >('EN');

  const telehealthCaptions: Record<'EN' | 'ES' | 'DE' | 'JP', string> = {
    EN: '“Patient vitals stable (BP 118/76). Prescription transmitted to pharmacy via encrypted HL7 FHIR.”',
    ES: '“Signos vitales estables (PA 118/76). Receta enviada a la farmacia mediante HL7 FHIR cifrado.”',
    DE: '“Vitalwerte stabil (RR 118/76). Rezept über verschlüsseltes HL7 FHIR an Apotheke übermittelt.”',
    JP: '「バイタル安定（血圧 118/76）。暗号化されたHL7 FHIR経由で処方箋を薬局へ送信完了。」',
  };

  const getIconForUseCase = (id: UseCaseItem['id']) => {
    switch (id) {
      case 'ai-support':
        return Bot;
      case 'social-web3':
        return Users;
      case 'team-collab':
        return Shield;
      case 'telehealth':
        return Video;
    }
  };

  const visibleUseCases =
    selectedTab === 'all'
      ? USE_CASES_DATA
      : USE_CASES_DATA.filter((item) => item.id === selectedTab);

  return (
    <section
      id="use-cases"
      className="relative py-20 lg:py-28 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#050711] transition-colors duration-250"
    >
      {/* Background Glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/10 rounded-full blur-[150px]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-xs font-mono font-semibold uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
            <span>Multi-Billion Dollar Market Versatility</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            One Iconic Domain.{' '}
            <span className="text-gradient-vigo">
              Four Hyper-Growth Markets.
            </span>
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-base sm:text-lg leading-relaxed">
            Whether you are building an autonomous AI customer agent, a Web3
            community super-app, an encrypted Slack competitor, or a HIPAA-ready
            telehealth platform,{' '}
            <strong className="text-slate-900 dark:text-slate-200">
              {SITE_CONFIG.displayDomain}
            </strong>{' '}
            adapts effortlessly to your product vision.
          </p>
        </div>

        {/* Interactive Filter Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          <button
            type="button"
            onClick={() => setSelectedTab('all')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 border ${
              selectedTab === 'all'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-indigo-400/50 shadow-lg shadow-indigo-600/25'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-cyan-300" />
            <span className={selectedTab === 'all' ? 'text-white' : ''}>
              All 4 Industries (Bento Grid)
            </span>
          </button>

          {USE_CASES_DATA.map((item, idx) => {
            const Icon = getIconForUseCase(item.id);
            const isActive = selectedTab === item.id;
            const letterPrefix = ['A', 'B', 'C', 'D'][idx];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedTab(item.id)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 border ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white border-cyan-400/50 shadow-lg shadow-cyan-600/20'
                    : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${
                    isActive
                      ? 'text-cyan-200'
                      : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                />
                <span className={isActive ? 'text-white' : ''}>
                  {letterPrefix}. {item.title.split(' ')[0]} &amp;{' '}
                  {item.title.split(' ').slice(-1)[0]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bento Grid Showcase */}
        <motion.div
          layout
          className={`grid grid-cols-1 ${
            selectedTab === 'all'
              ? 'lg:grid-cols-2'
              : 'lg:grid-cols-1 max-w-4xl mx-auto'
          } gap-6 lg:gap-8`}
        >
          <AnimatePresence mode="popLayout">
            {visibleUseCases.map((uc) => {
              const Icon = getIconForUseCase(uc.id);
              return (
                <motion.div
                  layout
                  key={uc.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.35 }}
                  className="group relative rounded-3xl glass-card glass-card-hover p-6 sm:p-8 flex flex-col justify-between overflow-hidden"
                >
                  {/* Top Ambient Gradient Splash */}
                  <div
                    className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${uc.accentGradient} opacity-80`}
                  />

                  <div className="relative space-y-5">
                    {/* Card Top Metadata Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold tracking-wider text-indigo-700 dark:text-indigo-300 uppercase">
                        {uc.code}
                      </span>
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/80 text-cyan-800 dark:text-cyan-300">
                        {uc.badgeText}
                      </span>
                    </div>

                    {/* Title & Subtitle */}
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-violet-500/20 to-cyan-500/20 border border-indigo-400/30 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                        <Icon className="w-6 h-6 text-indigo-600 dark:text-cyan-300" />
                      </div>
                      <div>
                        <h3 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                          {uc.title}
                        </h3>
                        <p className="text-xs sm:text-sm font-mono font-medium text-indigo-600 dark:text-indigo-300 mt-0.5">
                          {uc.category}
                        </p>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                      {uc.description}
                    </p>

                    {/* 3 Tailored KPI Metrics */}
                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      {uc.kpis.map((kpi, kIdx) => (
                        <div
                          key={kIdx}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-[#080B1A]/90 border border-slate-200 dark:border-slate-800/90 group-hover:border-indigo-500/30 transition-colors"
                        >
                          <div className="font-mono text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                            {kpi.value}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 font-medium truncate">
                            {kpi.label}
                          </div>
                          <div className="text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {kpi.delta}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Tailored Interactive Micro-Simulator per Industry */}
                    <div className="rounded-2xl bg-slate-50 dark:bg-[#070A16] border border-slate-200 dark:border-slate-800/90 p-4 space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-semibold">
                          <Activity className="w-3.5 h-3.5 text-indigo-600 dark:text-cyan-400" />
                          {uc.interactiveDemoTitle}
                        </span>
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping" />
                          Live Preview
                        </span>
                      </div>

                      {/* Industry A: AI & Customer Support Interactive Widget */}
                      {uc.id === 'ai-support' && (
                        <div className="space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900/90 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div className="text-xs text-slate-800 dark:text-slate-200">
                              <span className="font-mono font-semibold text-indigo-600 dark:text-cyan-300">
                                Ticket #{crmResolvedCount}:
                              </span>{' '}
                              &ldquo;Upgrade 120 seats &amp; prorate annual
                              invoice&rdquo;
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCrmActionTriggered(true);
                                setCrmResolvedCount((c) => c + 1);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold flex items-center gap-1 transition-all"
                            >
                              <Zap className="w-3 h-3 text-cyan-200" />
                              <span className="text-white">
                                {crmActionTriggered
                                  ? 'Resolve Next Ticket'
                                  : 'Simulate Auto-Resolve'}
                              </span>
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            <span>
                              Channels: WhatsApp • Web • iOS • Slack • Email
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              {crmActionTriggered
                                ? '✓ Stripe + Salesforce Synced in 42ms'
                                : 'Ready for 1-Click CRM Execution'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Industry B: Social & Web3 Community Hubs Interactive Widget */}
                      {uc.id === 'social-web3' && (
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900/90 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                              <Radio className="w-4 h-4 text-violet-600 dark:text-violet-400 animate-pulse" />
                              <div>
                                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                                  #alpha-founders-stage (Spatial Audio)
                                </div>
                                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {zkGateUnlocked
                                    ? 'ZK-Passkey Verified • 1,840 Listening Live'
                                    : 'Locked • Requires Holder Passkey'}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-end gap-0.5 h-4">
                                <span className="w-1 h-2 bg-violet-500 rounded-full animate-pulse" />
                                <span className="w-1 h-4 bg-cyan-500 rounded-full animate-bounce" />
                                <span className="w-1 h-3 bg-indigo-500 rounded-full animate-pulse" />
                                <span className="w-1 h-2.5 bg-fuchsia-500 rounded-full animate-bounce" />
                              </div>
                              <button
                                type="button"
                                onClick={() => setZkGateUnlocked((v) => !v)}
                                className="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-violet-800 dark:text-violet-200 text-[11px] font-mono font-semibold"
                              >
                                {zkGateUnlocked ? 'ZK Verified ✓' : 'Verify ZK'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Industry C: Team Collaboration Interactive Widget */}
                      {uc.id === 'team-collab' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900/90 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
                              <FileText className="w-4 h-4 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
                              <span>
                                #release-v4-architecture (48 unread messages)
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setThreadSummarized((prev) => !prev)
                              }
                              className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-800 dark:text-cyan-200 text-xs font-mono font-semibold"
                            >
                              {threadSummarized
                                ? 'Hide AI Recap'
                                : 'AI Summarize'}
                            </button>
                          </div>
                          {threadSummarized && (
                            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-500/30 text-xs text-indigo-900 dark:text-indigo-200 font-mono">
                              ⚡ <strong>VigoAI Summary:</strong> API gateway
                              benchmark hit 420k req/s. Security audit signed
                              off by @sec-ops. Production deploy scheduled 14:00
                              UTC.
                            </div>
                          )}
                        </div>
                      )}

                      {/* Industry D: Telehealth & Live Video Interactive Widget */}
                      {uc.id === 'telehealth' && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                              <Lock className="w-3 h-3" /> E2EE Clinical Stream
                              • Live AI Translation:
                            </span>
                            <div className="flex items-center gap-1">
                              {(['EN', 'ES', 'DE', 'JP'] as const).map(
                                (lang) => (
                                  <button
                                    key={lang}
                                    type="button"
                                    onClick={() => setTelehealthLang(lang)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                                      telehealthLang === lang
                                        ? 'bg-emerald-500 text-slate-950'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                                    }`}
                                  >
                                    {lang}
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-emerald-500/25 text-xs text-slate-800 dark:text-slate-200 italic">
                            <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline mr-1.5" />
                            {telehealthCaptions[telehealthLang]}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Feature Bullet List */}
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {uc.features.map((feat, fIdx) => (
                        <li
                          key={fIdx}
                          className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Card Footer Action */}
                  <div className="relative mt-6 pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      Domain fit:{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {SITE_CONFIG.displayDomain}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenModal({
                          dealType: 'outright',
                          prefilledOffer: String(SITE_CONFIG.pricing.binPrice),
                          sourceLabel: `Use Case Card: ${uc.title}`,
                        })
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-cyan-300 hover:text-indigo-500 transition-colors"
                    >
                      <span>Acquire for {uc.title.split(' ')[0]}</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
};
