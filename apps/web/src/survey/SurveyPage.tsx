import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router';
import { classifySnapshot } from './drawing-state';
import { ProjectsPanel } from './ProjectsPanel';
import { LocationPanel } from './LocationPanel';
import { GeoReferencePanel } from './GeoReferencePanel';
import { readMapCatalog } from './read-map-catalog';
import { osmProvider, type MapProvider } from '../../../../packages/map-catalog/src';
import type { LocalProject } from '../../../../packages/storage/src/projects';
import { CircleDot, MousePointer2, Pentagon, Redo2, Square, Spline, Trash2, Undo2, X } from 'lucide-react';
import type { Feature, LineString, Point, Polygon } from 'geojson';
import { convertArea, convertLength, measureGeometry, type AreaUnit, type LengthUnit, type Measurement } from '../../../../packages/survey-engine/src';
import 'maplibre-gl/dist/maplibre-gl.css';
import './survey.css';

type Geometry = Point | LineString | Polygon;
type DrawingFeature = Feature<Geometry, { mode: string }>;
type Tool = 'select' | 'polygon' | 'linestring' | 'point' | 'rectangle';
type Draw = import('terra-draw').TerraDraw;
type MapInstance = import('maplibre-gl').Map;

export function SurveyPage() {
  const { t, i18n } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const drawRef = useRef<Draw | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [features, setFeatures] = useState<DrawingFeature[]>([]);
  const [inProgress, setInProgress] = useState(false);
  const [selected, setSelected] = useState<string | number | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('m2');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('m');
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [basemap, setBasemap] = useState('grid');
  const [providers, setProviders] = useState<MapProvider[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [basemapError, setBasemapError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = window.setTimeout(() => {
      controller.abort();
      if (!disposed) setCatalogState('error');
    }, 8000);
    void (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}map-catalog.json`, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
        const config = await readMapCatalog(response);
        if (!controller.signal.aborted) {
          setProviders([...(config.allowCommunityOsm ? [osmProvider] : []), ...config.providers]);
          setCatalogState('ready');
        }
      } catch { if (!controller.signal.aborted) setCatalogState('error'); }
      finally { window.clearTimeout(timer); }
    })();
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let draw: Draw | undefined;
    let map: MapInstance | undefined;
    let initialized = false;
    void Promise.all([import('maplibre-gl'), import('terra-draw'), import('terra-draw-maplibre-gl-adapter')]).then(([ml, td, adapter]) => {
      if (disposed || !element.current) return;
      const grid: GeoJSON.Feature<LineString>[] = [];
      for (let lon = -180; lon <= 180; lon += 5) grid.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] } });
      for (let lat = -85; lat <= 85; lat += 5) grid.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180, lat], [0, lat], [180, lat]] } });
      map = new ml.Map({ container: element.current, center: [90.4, 23.8], zoom: 6, attributionControl: false, style: { version: 8, sources: { grid: { type: 'geojson', data: { type: 'FeatureCollection', features: grid } } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9efe6' } }, { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#c2d1bf', 'line-width': 1 } }] } });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: true }), 'top-right');
      map.on('mousemove', event => setPointer([event.lngLat.lng, event.lngLat.lat]));
      map.on('error', event => {
        if (disposed) return;
        // Tile failures must not disable or hide the drawing editor.
        if ('sourceId' in event && event.sourceId === 'catalog-tile') setBasemapError(true);
        else if (!initialized) setStatus('error');
      });
      map.on('load', () => {
        if (disposed || !map) return;
        try {
          const edit = { draggable: true, selfIntersectable: false, coordinates: { draggable: true, midpoints: true, deletable: true } };
          draw = new td.TerraDraw({ adapter: new adapter.TerraDrawMapLibreGLAdapter({ map }), modes: [new td.TerraDrawPointMode(), new td.TerraDrawLineStringMode(), new td.TerraDrawPolygonMode(), new td.TerraDrawRectangleMode(), new td.TerraDrawSelectMode({ keyEvents: { deselect: 'Escape', delete: null, rotate: null, scale: null }, flags: { point: { feature: { draggable: true } }, linestring: { feature: edit }, polygon: { feature: edit }, rectangle: { feature: edit } } })], undoRedo: { modeLevel: new td.TerraDrawModeUndoRedo(), sessionLevel: new td.TerraDrawSessionUndoRedo() } });
          drawRef.current = draw;
          const sync = () => {
            if (!draw || disposed) return;
            const snapshot = classifySnapshot(draw.getSnapshot());
            setFeatures(snapshot.complete as DrawingFeature[]);
            setInProgress(snapshot.inProgress);
            setHistory({ undo: draw.canUndo(), redo: draw.canRedo() });
          };
          draw.on('change', sync); draw.on('finish', sync); draw.on('history', sync);
          draw.on('select', id => setSelected(id)); draw.on('deselect', () => setSelected(null));
          draw.start(); draw.setMode('select'); sync(); initialized = true; setStatus('ready');
        } catch { setStatus('error'); }
      });
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; if (draw?.enabled) draw.stop(); map?.remove(); drawRef.current = null; mapRef.current = null; };
  }, []);
  const changeBasemap = (next: string) => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || next === basemap) return;
    setBasemapError(false);
    const provider = providers.find(item => item.id === next);
    if (next !== 'grid' && !provider) return;
    // Do not serve cached provider tiles when the browser reports offline.
    if (provider && !navigator.onLine) {
      if (basemap !== 'grid') changeBasemap('grid');
      setBasemapError(true); return;
    }
    try {
      if (map.getLayer('catalog-tile')) map.removeLayer('catalog-tile');
      if (map.getSource('catalog-tile')) map.removeSource('catalog-tile');
      if (provider) {
        map.addSource('catalog-tile', { type: 'raster', tiles: [provider.tileUrl], tileSize: provider.tileSize, maxzoom: provider.maxZoom });
        const overlayLayer = map.getStyle().layers.find(layer => layer.id.startsWith('geo-reference-'));
        map.addLayer({ id: 'catalog-tile', type: 'raster', source: 'catalog-tile' }, overlayLayer?.id ?? 'grid');
        map.setLayoutProperty('grid', 'visibility', 'none');
      } else {
        map.setLayoutProperty('grid', 'visibility', 'visible');
      }
      setBasemap(next);
    } catch {
      // Keep the drawing layers intact and return to the original offline grid.
      try {
        if (map.getLayer('catalog-tile')) map.removeLayer('catalog-tile');
        if (map.getSource('catalog-tile')) map.removeSource('catalog-tile');
        map.setLayoutProperty('grid', 'visibility', 'visible');
      } catch { /* Map may have been disposed. */ }
      setBasemap('grid'); setBasemapError(true);
    }
  };
  useEffect(() => {
    const onOffline = () => {
      if (basemap !== 'grid') { changeBasemap('grid'); setBasemapError(true); }
    };
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, [basemap, status]);
  const activeProvider = providers.find(provider => provider.id === basemap);
  const hasUnsavedWork = features.length > 0 || inProgress;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasUnsavedWork && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t('leaveSurveyConfirm'))) blocker.proceed(); else blocker.reset();
  }, [blocker, t]);
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedWork]);
  const switchTool = (next: Tool) => {
    const draw = drawRef.current;
    if (!draw || next === tool) return;
    if (inProgress && !window.confirm(t('discardDrawingConfirm'))) return;
    draw.setMode(next); setTool(next); setSelected(null);
    const snapshot = classifySnapshot(draw.getSnapshot());
    setFeatures(snapshot.complete as DrawingFeature[]); setInProgress(snapshot.inProgress);
    setHistory({ undo: draw.canUndo(), redo: draw.canRedo() });
  };
  const cancelDrawing = () => {
    const draw = drawRef.current;
    if (!draw || !inProgress || !window.confirm(t('discardDrawingConfirm'))) return;
    draw.setMode('select'); setTool('select'); setSelected(null);
    const snapshot = classifySnapshot(draw.getSnapshot());
    setFeatures(snapshot.complete as DrawingFeature[]); setInProgress(snapshot.inProgress);
    setHistory({ undo: draw.canUndo(), redo: draw.canRedo() });
  };
  const openProject = (project: LocalProject) => {
    const draw = drawRef.current;
    if (!draw || classifySnapshot(draw.getSnapshot()).complete.length || classifySnapshot(draw.getSnapshot()).inProgress) throw new Error('Editor must be empty');
    try {
      // Keep the engine mode in sync with the toolbar before loading a copy.
      draw.setMode('select'); setTool('select'); setSelected(null);
      const results = draw.addFeatures(project.features);
      if (results.length !== project.features.length || results.some(result => !result.valid)) throw new Error('Editor rejected a feature');
      draw.clearUndoRedoHistory();
      setAreaUnit(project.areaUnit); setLengthUnit(project.lengthUnit);
      const snapshot = classifySnapshot(draw.getSnapshot());
      setFeatures(snapshot.complete as DrawingFeature[]); setInProgress(snapshot.inProgress);
      setHistory({ undo: draw.canUndo(), redo: draw.canRedo() });
      const positions = project.features.flatMap(feature => {
        const g = feature.geometry;
        return g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0];
      });
      if (positions.length && mapRef.current) {
        const bounds = positions.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
        mapRef.current.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 48, maxZoom: 17, duration: 0 });
      }
    } catch (error) { draw.clear(); draw.clearUndoRedoHistory(); throw error; }
  };
  const selectedFeature = features.find(f => f.id === selected);
  const result: Measurement | undefined = selectedFeature ? measureGeometry(selectedFeature.geometry) : undefined;
  const formatter = new Intl.NumberFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 3 });
  const coordinateFormatter = new Intl.NumberFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 6 });
  const tools = [{ id: 'select', icon: MousePointer2 }, { id: 'polygon', icon: Pentagon }, { id: 'linestring', icon: Spline }, { id: 'rectangle', icon: Square }, { id: 'point', icon: CircleDot }] as const;
  return <div className="survey-page"><header className="survey-heading"><div><div className="section-label">{t('surveyWorkspace')}</div><h1>{t('surveyTitle')}</h1><p>{t('surveyIntro')}</p></div><span className="survey-badge">{t('temporarySession')}</span></header>
    <div className="survey-notice" role="note"><strong>{t('noBasemapTitle')}</strong> {t('noBasemapDescription')} <strong>{t('unsavedTitle')}</strong> {t('unsavedDescription')}</div>
    <div className="survey-layout"><section className="map-card" aria-label={t('mapRegion')}>
      <div className="draw-toolbar" role="toolbar" aria-label={t('drawingTools')}>
        {tools.map(({ id, icon: Icon }) => <button key={id} type="button" disabled={status !== 'ready'} aria-pressed={tool === id} onClick={() => switchTool(id)}><Icon size={16} aria-hidden="true"/>{t(`tool_${id}`)}</button>)}
        <button type="button" disabled={!inProgress} onClick={cancelDrawing}><X size={16} aria-hidden="true"/>{t('cancelDrawing')}</button>
        <span className="tool-separator" aria-hidden="true"/>
        <button type="button" disabled={!history.undo} onClick={() => drawRef.current?.undo()}><Undo2 size={16} aria-hidden="true"/>{t('undo')}</button>
        <button type="button" disabled={!history.redo} onClick={() => drawRef.current?.redo()}><Redo2 size={16} aria-hidden="true"/>{t('redo')}</button>
        <button type="button" disabled={selected === null} onClick={() => { if (selected !== null && window.confirm(t('deleteConfirm'))) { drawRef.current?.removeFeatures([selected]); setSelected(null); } }}><Trash2 size={16} aria-hidden="true"/>{t('delete')}</button>
      </div>
      <div className="basemap-controls"><label htmlFor="basemap-select">{t('basemapLabel')}</label><select id="basemap-select" value={basemap} disabled={status !== 'ready' || catalogState === 'loading'} onChange={e => changeBasemap(e.target.value)}><option value="grid">{t('basemapGrid')}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.id === 'osm' ? t('basemapOsm') : provider.name}</option>)}</select><p>{t('basemapPrivacy')}</p>{catalogState === 'error' && <p className="basemap-error" role="alert">{t('catalogError')}</p>}{basemapError && <p className="basemap-error" role="alert">{t('basemapError')}</p>}</div>
      <div className="map-frame"><div ref={element} className="survey-map" aria-label={t('mapRegion')} />{activeProvider && <div className="basemap-attribution">{activeProvider.id === 'osm' ? <>© <a href={activeProvider.attributionUrl} target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</> : <a href={activeProvider.attributionUrl} target="_blank" rel="noopener noreferrer">{activeProvider.attribution}</a>}</div>}{status !== 'ready' && <div className="map-state" role="status">{t(status === 'error' ? 'mapError' : 'mapLoading')}</div>}</div>
      <div className="map-footer"><span>{t('mapHelp')}</span><span>{pointer ? `${coordinateFormatter.format(pointer[1])}°, ${coordinateFormatter.format(pointer[0])}°` : t('coordinatesHint')}</span></div>
    </section>
    <aside className="survey-panel"><h2>{t('measurementTitle')}</h2><p>{t('measurementHint')}</p>
      <div className="unit-grid"><label>{t('areaUnit')}<select value={areaUnit} onChange={e => setAreaUnit(e.target.value as AreaUnit)}><option value="m2">{t('unit_m2')}</option><option value="ft2">{t('unit_ft2')}</option><option value="acre">{t('unit_acre')}</option><option value="hectare">{t('unit_hectare')}</option><option value="decimal">{t('unit_decimal')}</option></select></label><label>{t('lengthUnit')}<select value={lengthUnit} onChange={e => setLengthUnit(e.target.value as LengthUnit)}><option value="m">{t('unit_m')}</option><option value="ft">{t('unit_ft')}</option></select></label></div>
      {!selectedFeature && <div className="measurement-empty">{t('selectFeatureHint')}<br/><span>{t('featureCount', { count: features.length })}</span></div>}
      {result && !result.valid && <div className="measurement-error" role="alert">{t(`geometry_${result.reason}`)}</div>}
      {result?.valid && <div className="measurement-results">{result.areaSquareMeters !== null && <div><span>{t('area')}</span><strong>{formatter.format(convertArea(result.areaSquareMeters, areaUnit))} {t(`unit_${areaUnit}`)}</strong></div>}{result.lengthMeters !== null && <div><span>{selectedFeature?.geometry.type === 'Polygon' ? t('perimeter') : t('length')}</span><strong>{formatter.format(convertLength(result.lengthMeters, lengthUnit))} {t(`unit_${lengthUnit}`)}</strong></div>}{result.edgeLengthsMeters.length > 0 && <><h3>{t('edgeLengths')}</h3><ol>{result.edgeLengthsMeters.map((edge, i) => <li key={i}>{formatter.format(convertLength(edge, lengthUnit))} {t(`unit_${lengthUnit}`)}</li>)}</ol></>}<h3>{t('vertices')}</h3><ol>{result.coordinates.map((p, i) => <li key={i}>{coordinateFormatter.format(p[1])}°, {coordinateFormatter.format(p[0])}°</li>)}</ol></div>}
      <p className="measurement-method">{t('measurementMethod')}</p>
    </aside></div>
    <LocationPanel getMap={() => mapRef.current} ready={status === 'ready'} />
    <GeoReferencePanel getMap={() => mapRef.current} ready={status === 'ready'} inProgress={inProgress} />
    <ProjectsPanel features={features as import('terra-draw').GeoJSONStoreFeatures[]} inProgress={inProgress} ready={status === 'ready'} areaUnit={areaUnit} lengthUnit={lengthUnit} openProject={openProject} />
  </div>;
}
