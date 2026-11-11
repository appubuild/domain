import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { CharactersPage } from '@/pages/CharactersPage';
import { StudioPage } from '@/pages/StudioPage';
import { useApp } from '@/store/app';
import type { Character, Template } from '@/lib/types';
import { CHARACTER_TEMPLATES } from '@aura/core/characters';

/**
 * Integration smoke test for the real UI tree.
 *
 * The network is stubbed at `fetch` level with *shape-accurate* responses taken from the
 * server contract, so the components exercise their genuine render paths: loading states,
 * populated dashboard, character grid, and the 10-tab Character Studio.
 *
 * Every 3D stage is stubbed via the `AvatarStage` boundary because jsdom has no WebGL —
 * the rig itself is covered by avatarRig.test.tsx against the engine contract.
 */

const templateFixture: Template = {
  key: 'jarvis-holographic',
  name: 'ARIA',
  tagline: 'Holographic research companion',
  visualStyle: 'Holographic analyst',
  accent: '#38bdf8',
  renderFamily: 'hologram',
  avatar: CHARACTER_TEMPLATES[0]!.avatar,
  suggestedSkills: [],
  personalityPreview: { traits: ['precise', 'calm'], communicationStyle: 'analytical', responseLength: 'balanced', humor: 0.2, formality: 0.7 },
  defaultVoice: { name: 'nova', style: 'calm' },
  expertise: ['research'],
  characterType: 'assistant',
};

const characterFixture: Character = {
  id: 'chr_test_1',
  name: 'ARIA',
  templateKey: 'jarvis-holographic',
  avatarModel: 'procedural',
  avatarVariant: 'jarvis-holographic',
  avatarSpec: CHARACTER_TEMPLATES[0]!.avatar,
  profileImage: null,
  config: structuredClone(CHARACTER_TEMPLATES[0]!.config),
  isDefault: true,
  archived: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stats: { memoryCount: 12, conversationCount: 3 },
};

type Handler = (url: string, init?: RequestInit) => unknown | undefined;

function stubApi(extra: Handler = () => undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = extra(url, init);
    if (custom !== undefined) {
      return new Response(JSON.stringify(custom), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/health')) {
      return new Response(
        JSON.stringify({
          ok: true,
          app: 'AURA',
          version: '0.1.0',
          schemaVersion: 3,
          uptimeSeconds: 120,
          dataDir: '/tmp/aura',
          database: { path: '/tmp/aura/aura.sqlite', sizeBytes: 40960 },
          workspaceRoot: '/tmp/aura/workspace',
          vaultKeyPath: '/tmp/aura/vault.key',
        }),
        { status: 200 },
      );
    }
    if (url.includes('/api/system/info')) {
      return new Response(
        JSON.stringify({
          platform: 'win32',
          release: '10.0',
          hostname: 'studio',
          cpuCount: 16,
          totalMemMb: 32768,
          freeMemMb: 12000,
          node: 'v22.22.3',
          dataDir: '/tmp/aura',
          capabilityMode: 'server',
          capabilities: { browserAutomation: false, computerControl: false, fileSystem: true, knowledge: true },
          devMode: true,
          recommendedDataDir: '/tmp/aura',
        }),
        { status: 200 },
      );
    }
    if (url.includes('/api/characters/templates')) return json({ templates: [templateFixture] });
    if (url.match(/\/api\/characters(\?|$)/)) return json({ characters: [characterFixture], defaultId: characterFixture.id });
    if (url.match(/\/api\/characters\/[^/]+$/)) {
      return json({ character: characterFixture, stats: { memories: { short_term: 2, long_term: 9, episodic: 1, knowledge: 0 }, conversations: 3 } });
    }
    if (url.includes('/api/conversations/search')) return json({ conversations: [] });
    if (url.includes('/api/conversations')) return json({ conversations: [] });
    if (url.includes('/api/tasks')) return json({ tasks: [], counts: {} });
    if (url.includes('/api/usage')) return json({ usage: { today: { requests: 4, inputTokens: 900, outputTokens: 300, costUsd: 0.0021 }, last7: { requests: 20, inputTokens: 5000, outputTokens: 1500, costUsd: 0.01 }, byProvider: [], recent: [] } });
    if (url.includes('/api/skills')) return json({ skills: [], warnings: [] });
    if (url.includes('/api/memory')) return json({ memories: [], counts: {}, total: 0, characters: [], layers: [] });
    if (url.includes('/api/providers')) return json({ providers: [], models: {} });
    if (url.includes('/api/voice/voices')) return json({ openai: [], geminiLive: false, openaiRealtime: false, tts: { openai: false, browser: true }, note: 'Browser speech available' });
    if (url.includes('/api/permissions')) return json({ permissions: [], emergencyStop: false });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderRoute(element: React.ReactElement, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: '/', element: <AppShell />, children: [{ index: true, element }] }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('UI shell', () => {
  beforeEach(() => {
    // WebGL is unavailable in jsdom: stub the stage so pages still mount fully.
    vi.mock('@/components/avatar/AvatarStage', () => ({
      AvatarStage: ({ spec }: { spec: { palette: { accent: string } } }) => (
        <div data-testid="avatar-stage" data-accent={spec.palette.accent}>
          avatar
        </div>
      ),
    }));
    useApp.setState({ characters: [characterFixture], activeCharacterId: characterFixture.id, templates: [templateFixture], ready: true, emergencyStop: false });
  });

  it('renders all twelve sidebar destinations', async () => {
    stubApi();
    renderRoute(<DashboardPage />);
    const nav = await screen.findByRole('navigation', { name: /main navigation/i });
    const labels = ['Dashboard', 'Live Voice', 'Conversations', 'My Characters', 'Character Studio', 'Memory Center', 'Skills & Tools', 'Agent Tasks', 'Integrations', 'AI Models', 'Usage & Billing', 'Settings'];
    for (const label of labels) {
      expect(within(nav).getByText(label)).toBeTruthy();
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(12);
  });

  it('renders the dashboard with real server data and honest capability reporting', async () => {
    stubApi();
    renderRoute(<DashboardPage />);
    expect((await screen.findAllByText(/ARIA/)).length).toBeGreaterThan(0);
    // 2 + 9 + 1 memories aggregated from the detail endpoint.
    expect(await screen.findByText('12')).toBeTruthy();
    // Server mode must not claim computer control exists.
    expect(await screen.findByText(/Windows desktop build/i)).toBeTruthy();
    expect(screen.getAllByText(/Server mode/i).length).toBeGreaterThan(0);
  });

  it('shows the character grid with per-character metadata', async () => {
    stubApi();
    renderRoute(<CharactersPage />);
    await waitFor(() => expect(screen.getAllByText('ARIA').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/jarvis-holographic/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /new character/i }).length).toBeGreaterThan(0);
  });

  it('opens Character Studio with all ten design tabs', async () => {
    stubApi();
    renderRoute(<StudioPage />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(10));
    for (const label of ['Identity', 'Avatar', 'Personality', 'Voice', 'Intelligence', 'Memory', 'Skills', 'Knowledge', 'Behaviour', 'Permissions']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('switches studio tabs and edits the personality prompt', async () => {
    const user = userEvent.setup();
    stubApi();
    renderRoute(<StudioPage />);
    await user.click(await screen.findByRole('tab', { name: 'Personality' }));
    const prompt = (await screen.findByLabelText('System prompt')) as HTMLTextAreaElement;
    expect(prompt.value.length).toBeGreaterThan(20);
    await user.clear(prompt);
    await user.type(prompt, 'You are a test character.');
    expect(prompt.value).toBe('You are a test character.');
    // Editing marks the draft dirty, which enables save.
    expect(screen.getByText(/unsaved/i)).toBeTruthy();
  });

  it('persists a character config patch through the API', async () => {
    const user = userEvent.setup();
    const patchSpy = vi.fn();
    stubApi((url, init) => {
      if (url.includes('/api/characters/') && init?.method === 'PATCH') {
        patchSpy(JSON.parse(String(init.body)));
        return { character: characterFixture };
      }
      return undefined;
    });
    renderRoute(<StudioPage />);
    await user.click(await screen.findByRole('tab', { name: 'Personality' }));
    // Real user interaction path: typing into the system prompt flips the dirty flag.
    const prompt = (await screen.findByLabelText('System prompt')) as HTMLTextAreaElement;
    await user.type(prompt, ' Stay concise.');
    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    expect(patchSpy.mock.calls[0]![0]).toHaveProperty('config.personality');
  });
});
