import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import '../../../../packages/localization/src';
import { SurveyPage } from './SurveyPage';

const harness = vi.hoisted(() => ({ trigger: (_feature: unknown) => {} }));
vi.mock('maplibre-gl', () => {
  class Map {
    addControl() {}
    on(event: string, listener: () => void) { if (event === 'load') queueMicrotask(listener); return { unsubscribe() {} }; }
    remove() {}
  }
  return { Map, NavigationControl: class {} };
});
vi.mock('terra-draw-maplibre-gl-adapter', () => ({ TerraDrawMapLibreGLAdapter: class {} }));
vi.mock('terra-draw', () => {
  class Draw {
    enabled = false;
    snapshot: GeoJSONStoreFeatures[] = [];
    listeners: Record<string, Array<() => void>> = {};
    constructor() { harness.trigger = (feature: unknown) => { this.snapshot = [feature as GeoJSONStoreFeatures]; this.listeners.change?.forEach(fn => fn()); }; }
    on(event: string, listener: () => void) { (this.listeners[event] ??= []).push(listener); }
    start() { this.enabled = true; }
    stop() { this.enabled = false; }
    setMode(mode: string) { if (mode === 'select') this.snapshot = this.snapshot.filter(f => !f.properties.currentlyDrawing); }
    getSnapshot() { return this.snapshot; }
    canUndo() { return false; }
    canRedo() { return false; }
  }
  return { TerraDraw: Draw, TerraDrawPointMode: class {}, TerraDrawLineStringMode: class {}, TerraDrawPolygonMode: class {}, TerraDrawRectangleMode: class {}, TerraDrawSelectMode: class {}, TerraDrawModeUndoRedo: class {}, TerraDrawSessionUndoRedo: class {} };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('guards unfinished work when navigating and allows confirmed cancellation', async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([{ path: '/survey', element: <SurveyPage /> }, { path: '/settings', element: <h1>Settings destination</h1> }], { initialEntries: ['/survey'] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('button', { name: 'Polygon' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Polygon' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Polygon' }));
  harness.trigger({ type: 'Feature', id: 'draft', geometry: { type: 'Point', coordinates: [90, 23] }, properties: { mode: 'polygon', currentlyDrawing: true } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel drawing' })).toBeEnabled());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  await router.navigate('/settings');
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(router.state.location.pathname).toBe('/survey');
  await user.click(screen.getByRole('button', { name: 'Cancel drawing' }));
  expect(screen.getByRole('button', { name: 'Cancel drawing' })).toBeDisabled();
  await router.navigate('/settings');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings destination' })).toBeInTheDocument());
});
