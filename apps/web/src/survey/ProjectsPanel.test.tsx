import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import '../../../../packages/localization/src';
import { ProjectsPanel } from './ProjectsPanel';

const feature: GeoJSONStoreFeatures = { type: 'Feature', id: 'e3236b84-2d4c-4e6c-8dea-20ba22ffb898', geometry: { type: 'Point', coordinates: [90, 23] }, properties: { mode: 'point', selected: true } };
afterEach(async () => { cleanup(); await deleteDB('land-expert-projects'); vi.restoreAllMocks(); });
it('saves a validated copy, opens it only with an empty editor, and deletes it after confirmation', async () => {
  const user = userEvent.setup();
  const openProject = vi.fn();
  const props = { features: [feature], inProgress: false, ready: true, areaUnit: 'm2' as const, lengthUnit: 'm' as const, openProject };
  const view = render(<ProjectsPanel {...props} />);
  await screen.findByLabelText('Project name');
  await user.type(screen.getByLabelText('Project name'), 'Homestead');
  await user.click(screen.getByRole('button', { name: 'Save copy' }));
  expect(await screen.findByText('Project copy saved on this device.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Homestead' })).toBeDisabled();
  view.rerender(<ProjectsPanel {...props} features={[]} />);
  await user.click(screen.getByRole('button', { name: 'Open Homestead' }));
  await waitFor(() => expect(openProject).toHaveBeenCalledOnce());
  expect(openProject.mock.calls[0][0].features[0].properties).toEqual({ mode: 'point' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await user.click(screen.getByRole('button', { name: 'Delete Homestead' }));
  expect(await screen.findByText('No saved project copies yet.')).toBeInTheDocument();
});

it('restores a validated backup and rejects restoring duplicate IDs without changing saved projects', async () => {
  const { createProject } = await import('./project-adapter');
  const { createBackup } = await import('../../../../packages/storage/src/transfer');
  const project = createProject('Restored land', [feature], 'm2', 'm');
  const backup = createBackup([project]);
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  const input = await screen.findByLabelText('Restore backup file');
  const file = new File([backup], 'backup.json', { type: 'application/json' });
  await user.upload(input, file);
  expect(await screen.findByText('Backup restored to this browser.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Restored land' })).toBeEnabled();
  await user.upload(input, file);
  expect(await screen.findByText(/Restore failed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Restored land' })).toBeEnabled();
  expect(confirm).toHaveBeenCalledTimes(2);
});

it('offers backup and GeoJSON downloads from saved copies', async () => {
  const user = userEvent.setup();
  const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ProjectsPanel features={[feature]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  await user.type(await screen.findByLabelText('Project name'), 'Map');
  await user.click(screen.getByRole('button', { name: 'Save copy' }));
  await screen.findByText('Project copy saved on this device.');
  await user.click(screen.getByRole('button', { name: 'Download backup' }));
  await waitFor(() => expect(createURL).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: 'Export GeoJSON for Map' }));
  await waitFor(() => expect(createURL).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole('button', { name: 'Back up Map' }));
  await waitFor(() => expect(createURL).toHaveBeenCalledTimes(3));
  expect(click).toHaveBeenCalledTimes(3);
});

it('imports a valid GeoJSON copy and leaves existing copies intact after invalid input', async () => {
  const user = userEvent.setup();
  const inputJson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90, 23] }, properties: { privateMetadata: 'not retained' } }] });
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  await user.type(await screen.findByLabelText('Name for imported project'), 'Imported');
  const file = new File([inputJson], 'land.geojson', { type: 'application/geo+json' });
  await user.upload(screen.getByLabelText('GeoJSON file'), file);
  await user.click(screen.getByLabelText('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.'));
  await user.click(screen.getByRole('button', { name: 'Import as new copy' }));
  expect(await screen.findByText(/GeoJSON imported as a new local project copy/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Imported' })).toBeEnabled();
  await user.type(screen.getByLabelText('Name for imported project'), 'Bad import');
  const invalid = new File(['invalid'], 'bad.geojson', { type: 'application/geo+json' });
  await user.upload(screen.getByLabelText('GeoJSON file'), invalid);
  await user.click(screen.getByLabelText('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.'));
  await user.click(screen.getByRole('button', { name: 'Import as new copy' }));
  expect(await screen.findByText(/Import failed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Imported' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Open Bad import' })).not.toBeInTheDocument();
});

it('renames and duplicates a saved project through its controls', async () => {
  const user = userEvent.setup();
  render(<ProjectsPanel features={[feature]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  await user.type(await screen.findByLabelText('Project name'), 'Field');
  await user.click(screen.getByRole('button', { name: 'Save copy' }));
  await screen.findByRole('button', { name: 'Rename Field' });
  await user.click(screen.getByRole('button', { name: 'Rename Field' }));
  await user.clear(screen.getByLabelText('New project name'));
  await user.type(screen.getByLabelText('New project name'), 'North');
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  await screen.findByRole('button', { name: 'Duplicate North' });
  await user.click(screen.getByRole('button', { name: 'Duplicate North' }));
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  expect(await screen.findByRole('button', { name: 'Rename North copy' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rename North' })).toBeInTheDocument();
});

it('checks a backup without restoring it and rejects malformed and oversized files', async () => {
  const { createProject } = await import('./project-adapter');
  const { createBackup, MAX_BACKUP_BYTES } = await import('../../../../packages/storage/src/transfer');
  const text = createBackup([createProject('Checked', [feature], 'm2', 'm')]);
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  const input = await screen.findByLabelText('Check backup file');
  const good = new File([text], 'valid.json', { type: 'application/json' });
  await user.upload(input, good);
  expect(await screen.findByText('Backup format and project data validated (1 saved copy). No data was restored.')).toBeInTheDocument();
  expect(screen.getByText('No saved project copies yet.')).toBeInTheDocument();
  expect(screen.getByText(/No matching IDs were found/)).toBeInTheDocument();
  await user.upload(input, good);
  expect(await screen.findByText('Backup format and project data validated (1 saved copy). No data was restored.')).toBeInTheDocument();
  const bad = new File(['bad'], 'bad.json', { type: 'application/json' });
  await user.upload(input, bad);
  expect(await screen.findByRole('alert')).toHaveTextContent('Backup check failed');
  const oversized = new File([''], 'large.json', { type: 'application/json' });
  Object.defineProperty(oversized, 'size', { value: MAX_BACKUP_BYTES + 1 });
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
  await user.upload(input, oversized);
  expect(await screen.findByRole('alert')).toHaveTextContent('Backup check failed');
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByText('No saved project copies yet.')).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
});


it('reports conflict check unavailable separately from a valid backup', async () => {
  const storage = await import('../../../../packages/storage/src/projects');
  const { createProject } = await import('./project-adapter');
  const { createBackup } = await import('../../../../packages/storage/src/transfer');
  const open = storage.openProjectRepository;
  vi.spyOn(storage, 'openProjectRepository').mockImplementation(async (...args) => {
    const repo = await open(...args);
    return { ...repo, countExisting: async () => { throw new Error('storage blocked'); } };
  });
  const text = createBackup([createProject('Valid', [feature], 'm2', 'm')]);
  const file = new File([text], 'valid.json', { type: 'application/json' });
  const user = userEvent.setup();
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  await user.upload(await screen.findByLabelText('Check backup file'), file);
  expect(await screen.findByText(/Could not check existing project IDs/)).toBeInTheDocument();
  expect(screen.getByText(/Backup format and project data validated/)).toBeInTheDocument();
  expect(screen.getByText('No saved project copies yet.')).toBeInTheDocument();
});

it('shows readable copies and preserves unreadable records without offering an incomplete all-copy backup', async () => {
  const { openProjectRepository } = await import('../../../../packages/storage/src/projects');
  const { createProject } = await import('./project-adapter');
  const { openDB } = await import('idb');
  const repo = await openProjectRepository();
  const good = createProject('Readable copy', [feature], 'm2', 'm');
  await repo.add(good); repo.close();
  const db = await openDB('land-expert-projects', 1);
  const bad = { id: crypto.randomUUID(), schemaVersion: 2, name: 'Future record' };
  await db.add('projects', bad); db.close();
  const user = userEvent.setup();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('1 stored record could not be read');
  expect(screen.getByRole('button', { name: 'Open Readable copy' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download backup' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Back up Readable copy' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
  const raw = await openDB('land-expert-projects', 1);
  expect(await raw.get('projects', bad.id)).toEqual(bad);
  raw.close();
});

it('does not claim the store is empty when only unreadable records exist', async () => {
  const { openProjectRepository } = await import('../../../../packages/storage/src/projects');
  const { openDB } = await import('idb');
  const repo = await openProjectRepository(); repo.close();
  const db = await openDB('land-expert-projects', 1);
  await db.add('projects', { id: crypto.randomUUID(), schemaVersion: 2 }); db.close();
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  expect(await screen.findByText('No readable saved project copies are currently available.')).toBeInTheDocument();
  expect(screen.queryByText('No saved project copies yet.')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('1 stored record could not be read');
  expect(screen.getByRole('button', { name: 'Download backup' })).toBeDisabled();
});

it('does not download or modify unreadable data that cannot be represented faithfully in JSON', async () => {
  const { openProjectRepository } = await import('../../../../packages/storage/src/projects');
  const { openDB } = await import('idb');
  const repo = await openProjectRepository(); repo.close();
  const db = await openDB('land-expert-projects', 1);
  const bad = { id: crypto.randomUUID(), schemaVersion: 2, value: 1n };
  await db.add('projects', bad); db.close();
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const user = userEvent.setup();
  render(<ProjectsPanel features={[]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Download unreadable records diagnostic' }));
  expect(await screen.findByText(/Diagnostic export failed/)).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  const raw = await openDB('land-expert-projects', 1);
  expect(await raw.get('projects', bad.id)).toEqual(bad); raw.close();
});

it('reports blocked storage without claiming projects were deleted', async () => {
  const storage = await import('../../../../packages/storage/src/projects');
  vi.spyOn(storage, 'openProjectRepository').mockRejectedValue(new DOMException('Storage denied', 'SecurityError'));
  render(<ProjectsPanel features={[feature]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Local projects could not be opened');
  expect(screen.getByRole('alert')).toHaveTextContent('No data was removed');
  expect(screen.queryByText('No saved project copies yet.')).not.toBeInTheDocument();
});

it('preserves the existing copy and form input when saving fails with a simulated quota error', async () => {
  const storage = await import('../../../../packages/storage/src/projects');
  const { createProject } = await import('./project-adapter');
  const existing = createProject('Previously saved', [feature], 'm2', 'm');
  const setup = await storage.openProjectRepository(); await setup.add(existing); setup.close();
  const open = storage.openProjectRepository;
  vi.spyOn(storage, 'openProjectRepository').mockImplementation(async (...args) => {
    const repo = await open(...args);
    return { ...repo, add: async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } };
  });
  const user = userEvent.setup();
  render(<ProjectsPanel features={[feature]} inProgress={false} ready areaUnit="m2" lengthUnit="m" openProject={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Open Previously saved' })).toBeInTheDocument();
  await user.type(screen.getByLabelText('Project name'), 'Unsaved field');
  await user.click(screen.getByRole('button', { name: 'Save copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the project');
  expect(screen.getByLabelText('Project name')).toHaveValue('Unsaved field');
  expect(screen.getByRole('button', { name: 'Open Previously saved' })).toBeInTheDocument();
  const verify = await open();
  try { expect(await verify.list()).toEqual([existing]); } finally { verify.close(); }
});
