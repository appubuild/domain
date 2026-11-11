import * as React from 'react';
import { Sliders, Info } from 'lucide-react';
import type { Character } from '@/lib/types';
import { Badge, Field, Panel, Select, Slider, Toggle } from '@/components/ui';

/**
 * Behaviour: how the character acts without being asked. Values are persisted in the
 * character config and honoured by the orchestrator (initiative gates task creation,
 * verbosity adjusts prompt guidance, confirmation strictness gates risky steps).
 */
export function CharacterStudioBehaviour({ draft, update, updateConfig }: { draft: Character; update: (m: (c: Character) => void) => void; updateConfig: (p: Partial<Character['config']>) => void }) {
  const p = draft.config.personality;
  const intel = draft.config.intelligence;
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Sliders className="h-4 w-4 text-holo-400" /> Interaction</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">These shape prompts and orchestration behaviour — not just visual settings.</p>
        <Field label="Response length">
          <Select value={p.responseLength} onChange={(e) => update((c) => { c.config.personality.responseLength = e.target.value as typeof p.responseLength; })}>
            {['concise', 'balanced', 'detailed'].map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
        <Slider label="Emotional expression" value={p.emotionalExpression} min={0} max={1} step={0.05} onChange={(emotionalExpression) => update((c) => { c.config.personality.emotionalExpression = emotionalExpression; })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Context window" value={intel.contextMessages} min={4} max={200} step={2} onChange={(contextMessages) => update((c) => { c.config.intelligence.contextMessages = contextMessages; })} format={(v) => `${v} messages`} />
        <Toggle checked={intel.memoryAccess} onChange={(memoryAccess) => update((c) => { c.config.intelligence.memoryAccess = memoryAccess; })} label="Recall memory proactively" description="Retrieve relevant memories before answering, even when not explicitly asked." />
        <Toggle checked={draft.config.memory.autoExtract} onChange={(autoExtract) => updateConfig({ memory: { ...draft.config.memory, autoExtract } })} label="Learn from conversation" description="Write durable facts after exchanges so the character improves over time." />
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">Guardrails</h3>
        <p className="flex items-start gap-2 rounded-lg border border-holo-500/20 bg-holo-500/[0.05] p-2.5 text-[11px] leading-relaxed text-slate-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-holo-400" />
          Untrusted content (web pages, documents, MCP responses) is wrapped as data. The orchestrator refuses instructions that arrive from tool output, and any file or system action outside the workspace sandbox is denied regardless of character settings.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="good">prompt-injection guard</Badge>
          <Badge tone="good">workspace sandbox</Badge>
          <Badge tone="good">audit log</Badge>
          <Badge tone="warn">high-risk actions need confirmation</Badge>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
          Changing personality descriptors (humor, formality) alters the generated system prompt and therefore actual model output; they are not decorative sliders.
        </p>
      </Panel>
    </div>
  );
}
