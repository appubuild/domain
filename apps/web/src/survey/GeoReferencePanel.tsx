import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Map as MapInstance } from 'maplibre-gl';
import { parseOverlayBounds } from './georeference';
import { referenceImageDimensions } from './reference-image';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
type Overlay = { id: string; url: string };
const removeOverlay = (map: MapInstance, id: string) => {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
};
export function GeoReferencePanel({ getMap, ready, inProgress }: { getMap: () => MapInstance | null; ready: boolean; inProgress: boolean }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [bounds, setBounds] = useState({ west: '', east: '', south: '', north: '' });
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<'invalid' | 'failed' | 'success' | 'drawing' | null>(null);
  const overlay = useRef<Overlay | null>(null);
  const sequence = useRef(0);
  const drawing = useRef(inProgress);
  drawing.current = inProgress;
  useEffect(() => () => {
    sequence.current++;
    const old = overlay.current;
    const map = getMap();
    if (old) { try { if (map) removeOverlay(map, old.id); } catch { /* Map may already be gone. */ } URL.revokeObjectURL(old.url); }
  // The map instance remains stable for the lifetime of this component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const map = getMap();
    if (!ready || !map) return;
    let disposed = false;
    const subscription = map.on('error', event => {
      if (!('sourceId' in event) || event.sourceId !== overlay.current?.id) return;
      queueMicrotask(() => {
        if (disposed) return;
        const broken = overlay.current;
        if (!broken || broken.id !== event.sourceId) return;
        try { removeOverlay(map, broken.id); } catch { /* Map may be unavailable. */ }
        URL.revokeObjectURL(broken.url); overlay.current = null; setActive(false); setMessage('failed');
      });
    });
    return () => { disposed = true; subscription.unsubscribe(); };
  // getMap points to the stable SurveyPage ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const remove = () => {
    const previous = overlay.current;
    if (!previous || busy) return;
    try { const map = getMap(); if (map) removeOverlay(map, previous.id); }
    catch { setMessage('failed'); return; }
    URL.revokeObjectURL(previous.url); overlay.current = null; setActive(false); setMessage(null);
  };
  const add = async () => {
    const map = getMap();
    if (!map || !ready || inProgress || busy || !file) return;
    let coordinates: ReturnType<typeof parseOverlayBounds>;
    try { coordinates = parseOverlayBounds(bounds); }
    catch { setMessage('invalid'); return; }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg'].includes(file.type)) { setMessage('invalid'); return; }
    const token = ++sequence.current;
    setBusy(true); setMessage(null);
    let url: string | null = null;
    try {
      referenceImageDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
      url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Image decode failed')); image.src = url!; });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Image dimensions unsupported');
      if (token !== sequence.current) return;
      if (drawing.current) { setMessage('drawing'); return; }
      const id = `geo-reference-${crypto.randomUUID()}`;
      try {
        map.addSource(id, { type: 'image', url, coordinates });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.65, 'raster-fade-duration': 0 } }, 'grid');
        if (!map.getSource(id) || !map.getLayer(id)) throw new Error('Map rejected the image layer');
      } catch (error) { try { removeOverlay(map, id); } catch { /* Preserve original error. */ } throw error; }
      const old = overlay.current;
      overlay.current = { id, url }; url = null;
      if (old) { removeOverlay(map, old.id); URL.revokeObjectURL(old.url); }
      setActive(true); setMessage('success');
      map.fitBounds([coordinates[3], coordinates[1]], { padding: 48, maxZoom: 17, duration: 0 });
    } catch { if (token === sequence.current) setMessage('failed'); }
    finally { if (url) URL.revokeObjectURL(url); if (token === sequence.current) setBusy(false); }
  };
  return <section className="location-card" aria-labelledby="georef-title">
    <h2 id="georef-title">{t('georefTitle')}</h2><p>{t('georefHint')}</p>
    <form className="georef-form" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label htmlFor="georef-image">{t('georefImage')}</label><input id="georef-image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => setFile(event.currentTarget.files?.[0] ?? null)} />
      <div className="georef-bounds">{(['west', 'east', 'south', 'north'] as const).map(key => <label key={key} htmlFor={`georef-${key}`}>{t(`georef_${key}`)}<input id={`georef-${key}`} inputMode="decimal" disabled={busy} value={bounds[key]} onChange={event => setBounds(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
      <div className="location-actions"><button type="submit" disabled={!ready || inProgress || busy || !file}>{busy ? t('georefLoading') : t('georefApply')}</button><button type="button" disabled={!active || busy} onClick={remove}>{t('georefRemove')}</button></div>
    </form>
    {message && <p role={message === 'success' ? 'status' : 'alert'} className={message === 'success' ? '' : 'location-error'}>{t(`georefMessage_${message}`)}</p>}
    {inProgress && <p>{t('georefFinishDrawing')}</p>}
  </section>;
}
