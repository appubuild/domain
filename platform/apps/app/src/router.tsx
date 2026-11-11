import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { VoicePage } from './pages/VoicePage';
import { ConversationsPage } from './pages/ConversationsPage';
import { CharactersPage } from './pages/CharactersPage';
import { StudioPage } from './pages/StudioPage';
import { MemoryPage } from './pages/MemoryPage';
import { SkillsPage } from './pages/SkillsPage';
import { TasksPage } from './pages/TasksPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ModelsPage } from './pages/ModelsPage';
import { BillingPage } from './pages/BillingPage';
import { SettingsPage } from './pages/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'voice', element: <VoicePage /> },
      { path: 'conversations', element: <ConversationsPage /> },
      { path: 'characters', element: <CharactersPage /> },
      { path: 'studio', element: <StudioPage /> },
      { path: 'studio/:characterId', element: <StudioPage /> },
      { path: 'memory', element: <MemoryPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'models', element: <ModelsPage /> },
      { path: 'billing', element: <BillingPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
