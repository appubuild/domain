import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import { openProjectRepository, StaleProjectError, type LocalProject, type ProjectRepository } from '../../../../packages/storage/src/projects';
import type { AreaUnit, LengthUnit } from '../../../../packages/survey-engine/src';
import { createProject, duplicateProject } from './project-adapter';
import type { ReportLanguage } from '../../../../packages/reports/src/report';
import { readUtf8File } from './read-utf8-file';
import { createUnreadableDiagnostic } from '../../../../packages/storage/src/diagnostics';
import { createBackup, exportGeoJSON, importGeoJSON, MAX_BACKUP_BYTES, MAX_GEOJSON_BYTES, parseBackup } from '../../../../packages/storage/src/transfer';

export function ProjectsPanel({ features, inProgress, ready, areaUnit, lengthUnit, openProject }: {
  features: GeoJSONStoreFeatures[]; inProgress: boolean; ready: boolean; areaUnit: AreaUnit; lengthUnit: LengthUnit;
  openProject: (project: LocalProject) => void;
}) {
  const { t, i18n } = useTranslation();
  const repository = useRef<ProjectRepository | null>(null);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<{ project: LocalProject; action: 'rename' | 'duplicate'; name: string } | null>(null);
  const [reportLanguage, setReportLanguage] = useState<ReportLanguage>('en');
  const [importName, setImportName] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [sourceCrsConfirmed, setSourceCrsConfirmed] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; key: string } | null>(null);
  const [checkResult, setCheckResult] = useState<{ kind: 'error' } | { kind: 'success'; count: number; conflicts: number | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    void openProjectRepository().then(async repo => {
      if (disposed) { repo.close(); return; }
      repository.current = repo;
      try { const result = await repo.listReadable(); if (!disposed) { setProjects(result.projects); setInvalidCount(result.invalidCount); setState('ready'); } }
      catch { if (!disposed) setState('unavailable'); }
    }).catch(() => { if (!disposed) setState('unavailable'); });
    return () => { disposed = true; repository.current?.close(); repository.current = null; };
  }, []);
  const refreshProjects = async () => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null);
    try { const result = await repo.listReadable(); setProjects(result.projects); setInvalidCount(result.invalidCount); setEdit(null); setMessage({ kind: 'success', key: 'projectsRefreshed' }); }
    catch { setMessage({ kind: 'error', key: 'projectsRefreshError' }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const repo = repository.current;
    if (!repo || busy || !ready || inProgress || !features.length) return;
    setMessage(null);
    let project: LocalProject;
    try { project = createProject(name, features, areaUnit, lengthUnit); }
    catch { setMessage({ kind: 'error', key: 'projectInvalid' }); return; }
    setBusy(true);
    try {
      await repo.add(project);
      setProjects(existing => [project, ...existing]); setName(''); setMessage({ kind: 'success', key: 'projectSaved' });
    } catch { setMessage({ kind: 'error', key: 'projectSaveError' }); }
    finally { setBusy(false); }
  };
  const open = async (expected: LocalProject) => {
    const repo = repository.current;
    if (!repo || busy || !ready || inProgress || features.length) return;
    setMessage(null); setBusy(true);
    try {
      const project = await repo.getIfUnchanged(expected);
      openProject(project);
      setMessage({ kind: 'success', key: 'projectOpened' });
    } catch (error) { setMessage({ kind: 'error', key: error instanceof StaleProjectError ? 'projectStaleError' : 'projectOpenError' }); }
    finally { setBusy(false); }
  };
  const remove = async (project: LocalProject) => {
    const repo = repository.current;
    if (!repo || busy || !window.confirm(t('deleteProjectConfirm', { name: project.name }))) return;
    setMessage(null); setBusy(true);
    try { await repo.delete(project); setProjects(existing => existing.filter(item => item.id !== project.id)); setMessage({ kind: 'success', key: 'projectDeleted' }); }
    catch { setMessage({ kind: 'error', key: 'projectDeleteError' }); }
    finally { setBusy(false); }
  };
  const saveProjectAction = async () => {
    const repo = repository.current;
    if (!repo || busy || !edit || !edit.name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      if (edit.action === 'rename') {
        const updated = await repo.rename(edit.project, edit.name);
        setProjects(existing => existing.map(p => p.id === updated.id ? updated : p));
        setMessage({ kind: 'success', key: 'projectRenamed' });
      } else {
        const copy = duplicateProject(edit.project, edit.name);
        await repo.addIfUnchanged(edit.project, copy); setProjects(existing => [copy, ...existing]);
        setMessage({ kind: 'success', key: 'projectDuplicated' });
      }
      setEdit(null);
    } catch { setMessage({ kind: 'error', key: 'projectActionError' }); }
    finally { setBusy(false); }
  };
  const downloadReport = async (expected: LocalProject) => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null);
    try {
      const project = await repo.getIfUnchanged(expected);
      const { downloadProjectReport } = await import('../../../../packages/reports/src/browser');
      await downloadProjectReport(project, reportLanguage);
    } catch (error) { setMessage({ kind: 'error', key: error instanceof StaleProjectError ? 'projectStaleError' : 'reportError' }); }
    finally { setBusy(false); }
  };
  const download = (content: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    try {
      const link = document.createElement('a'); link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const downloadBackup = async () => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null);
    try { download(createBackup(await repo.list()), 'land-expert-backup.json', 'application/json'); }
    catch { setMessage({ kind: 'error', key: 'backupError' }); }
    finally { setBusy(false); }
  };
  const downloadUnreadableDiagnostic = async () => {
    const repo = repository.current;
    if (!repo || busy || !invalidCount) return;
    setBusy(true); setMessage(null);
    try {
      const records = await repo.listUnreadable();
      download(createUnreadableDiagnostic(records), 'land-expert-unreadable-diagnostic.json', 'application/json');
    } catch { setMessage({ kind: 'error', key: 'diagnosticError' }); }
    finally { setBusy(false); }
  };
  const downloadProjectBackup = async (expected: LocalProject) => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null);
    try {
      const project = await repo.getIfUnchanged(expected);
      download(createBackup([project]), `land-expert-${project.id}-backup.json`, 'application/json');
    } catch (error) { setMessage({ kind: 'error', key: error instanceof StaleProjectError ? 'projectStaleError' : 'singleBackupError' }); }
    finally { setBusy(false); }
  };
  const downloadProject = async (expected: LocalProject) => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null);
    try {
      const project = await repo.getIfUnchanged(expected);
      download(exportGeoJSON(project), `land-expert-${project.id}.geojson`, 'application/geo+json');
    } catch (error) { setMessage({ kind: 'error', key: error instanceof StaleProjectError ? 'projectStaleError' : 'geojsonError' }); }
    finally { setBusy(false); }
  };
  const importFileAsProject = async () => {
    const repo = repository.current;
    if (!repo || busy || !importFile || !importName.trim() || !sourceCrsConfirmed) return;
    setBusy(true); setMessage(null);
    try {
      const project = importGeoJSON(await readUtf8File(importFile, MAX_GEOJSON_BYTES), importName, areaUnit, lengthUnit);
      await repo.add(project);
      setProjects(existing => [project, ...existing]);
      setImportName(''); setImportFile(null); setSourceCrsConfirmed(false); if (importInput.current) importInput.current.value = '';
      setMessage({ kind: 'success', key: 'geojsonImportSuccess' });
    } catch { setMessage({ kind: 'error', key: 'geojsonImportError' }); }
    finally { setBusy(false); }
  };
  const checkBackup = async (file: File) => {
    if (busy) return;
    setBusy(true); setMessage(null); setCheckResult(null);
    try {
      const projects = parseBackup(await readUtf8File(file, MAX_BACKUP_BYTES));
      // This is a point-in-time preview, not a reservation: restore must still
      // reject conflicts atomically in case another tab changes the database.
      let conflicts: number | null = null;
      try { if (repository.current) conflicts = await repository.current.countExisting(projects.map(project => project.id)); }
      catch { /* File validation succeeded; report the conflict check as unavailable. */ }
      setCheckResult({ kind: 'success', count: projects.length, conflicts });
    } catch { setCheckResult({ kind: 'error' }); }
    finally { setBusy(false); }
  };
  const restoreBackup = async (file: File) => {
    const repo = repository.current;
    if (!repo || busy) return;
    setBusy(true); setMessage(null); setCheckResult(null);
    let restored = false;
    try {
      const data = parseBackup(await readUtf8File(file, MAX_BACKUP_BYTES));
      if (!window.confirm(t('restoreConfirm', { count: data.length }))) return;
      await repo.restore(data); restored = true;
      const updated = await repo.listReadable();
      setProjects(updated.projects); setInvalidCount(updated.invalidCount); setMessage({ kind: 'success', key: 'restoreSuccess' });
    } catch { setMessage({ kind: 'error', key: restored ? 'restoreRefreshError' : 'restoreError' }); }
    finally { setBusy(false); }
  };
  return <section className="projects-card" aria-labelledby="local-projects-title">
    <h2 id="local-projects-title">{t('localProjects')}</h2><p>{t('projectsDescription')}</p>
    {state === 'loading' && <p role="status">{t('projectsLoading')}</p>}
    {state === 'unavailable' && <p role="alert" className="project-error">{t('projectsUnavailable')}</p>}
    {state === 'ready' && <>
      {invalidCount > 0 && <div>
        <p role="alert" className="project-error">{t('invalidStoredProjects', { count: invalidCount })}</p>
        <p id="diagnostic-hint" className="project-hint">{t('diagnosticHint')}</p>
        <button type="button" disabled={busy} aria-describedby="diagnostic-hint" onClick={() => { void downloadUnreadableDiagnostic(); }}>{t('diagnosticDownload')}</button>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="project-name">{t('projectName')}</label><input id="project-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required />
        <button type="submit" disabled={busy || !ready || inProgress || !features.length || !name.trim()}>{t('saveCopy')}</button>
      </form>
      <p className="project-hint">{t('saveCopyHint')}</p>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'project-error' : 'project-success'}>{t(message.key)}</p>}
      <div className="geojson-import"><h3>{t('geojsonImportTitle')}</h3><p id="geojson-import-hint">{t('geojsonImportHint')}</p>
        <form onSubmit={event => { event.preventDefault(); void importFileAsProject(); }}>
          <label htmlFor="import-project-name">{t('geojsonImportName')}</label><input id="import-project-name" value={importName} onChange={event => setImportName(event.target.value)} maxLength={120} required />
          <label htmlFor="geojson-file">{t('geojsonImportFile')}</label><input ref={importInput} id="geojson-file" type="file" accept=".geojson,.json,application/geo+json,application/json" aria-describedby="geojson-import-hint" aria-required="true" onChange={event => { setImportFile(event.target.files?.[0] ?? null); setSourceCrsConfirmed(false); }} />
          <label className="crs-confirm"><input type="checkbox" checked={sourceCrsConfirmed} onChange={event => setSourceCrsConfirmed(event.target.checked)} required />{t('geojsonCrsConfirm')}</label>
          <button type="submit" disabled={busy || !importName.trim() || !importFile || !sourceCrsConfirmed}>{t('geojsonImportAction')}</button>
        </form>
      </div>
      <div className="backup-controls"><button type="button" disabled={busy || !projects.length || invalidCount > 0} onClick={() => { void downloadBackup(); }}>{t('downloadBackup')}</button><label htmlFor="restore-backup">{t('restoreBackup')}</label><input id="restore-backup" type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void restoreBackup(file); }} /></div>
      <div className="backup-controls"><label htmlFor="check-backup">{t('checkBackup')}</label><input id="check-backup" type="file" accept=".json,application/json" aria-describedby="check-backup-hint" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void checkBackup(file); }} /></div>
      <p id="check-backup-hint" className="project-hint">{t('backupCheckHint')}</p>
      {checkResult?.kind === 'error' && <p role="alert" className="project-error">{t('backupCheckError')}</p>}
      {checkResult?.kind === 'success' && <div role="status"><p className="project-success">{t('backupCheckSuccess', { count: checkResult.count })}</p><p className={checkResult.conflicts === 0 ? 'project-hint' : 'project-error'}>{checkResult.conflicts === null ? t('backupConflictUnavailable') : checkResult.conflicts === 0 ? t('backupNoConflicts') : t('backupConflicts', { count: checkResult.conflicts })}</p></div>}
      <p className="project-hint">{t('backupHint')}</p>
      <div className="report-controls"><label htmlFor="report-language">{t('reportLanguage')}</label><select id="report-language" value={reportLanguage} onChange={event => setReportLanguage(event.target.value as ReportLanguage)}><option value="en">English</option><option value="bn" disabled>বাংলা</option></select><p>{t('reportHint')}</p></div>
      {edit && <form className="project-edit" onSubmit={event => { event.preventDefault(); void saveProjectAction(); }}><label htmlFor="edit-project-name">{t(edit.action === 'rename' ? 'renameProjectLabel' : 'duplicateProjectLabel')}</label><input id="edit-project-name" maxLength={120} required value={edit.name} onChange={event => setEdit({ ...edit, name: event.target.value })}/><button type="submit" disabled={busy || !edit.name.trim()}>{t('confirmProjectAction')}</button><button type="button" disabled={busy} onClick={() => setEdit(null)}>{t('cancelProjectAction')}</button></form>}
      <h3>{t('savedProjects')}</h3><button type="button" disabled={busy} onClick={() => { void refreshProjects(); }}>{t('refreshProjects')}</button>
      {!projects.length ? <p>{t(invalidCount > 0 ? 'noReadableProjects' : 'noSavedProjects')}</p> : <ul>{projects.map(project => <li key={project.id}><div><strong>{project.name}</strong><small>{new Intl.DateTimeFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(project.createdAt))}</small></div><div className="project-actions"><button type="button" disabled={busy || !ready || inProgress || features.length > 0} onClick={() => { void open(project); }} aria-label={t('openProjectNamed', { name: project.name })}>{t('openProject')}</button><button type="button" disabled={busy} onClick={() => setEdit({ project, action: 'rename', name: project.name })} aria-label={t('renameProjectNamed', { name: project.name })}>{t('renameProject')}</button><button type="button" disabled={busy} onClick={() => setEdit({ project, action: 'duplicate', name: `${project.name.slice(0, 100)} ${t('copySuffix')}` })} aria-label={t('duplicateProjectNamed', { name: project.name })}>{t('duplicateProject')}</button><button type="button" disabled={busy} onClick={() => { void downloadReport(project); }} aria-label={t('downloadReportNamed', { name: project.name })}>{t('downloadReport')}</button><button type="button" disabled={busy} onClick={() => { void downloadProjectBackup(project); }} aria-label={t('backupProjectNamed', { name: project.name })}>{t('backupProject')}</button><button type="button" disabled={busy} onClick={() => { void downloadProject(project); }} aria-label={t('exportGeoJSONNamed', { name: project.name })}>{t('exportGeoJSON')}</button><button type="button" disabled={busy} onClick={() => { void remove(project); }} aria-label={t('deleteProjectNamed', { name: project.name })}>{t('delete')}</button></div></li>)}</ul>}
      {features.length > 0 || inProgress ? <p className="project-hint">{t('openEmptyHint')}</p> : null}
    </>}
  </section>;
}
