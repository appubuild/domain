import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Map as MapInstance } from 'maplibre-gl';
import { classifyLocationFailure, requestCurrentLocation, type LocationFailure } from './current-location';

const MAX_AGE_MS = 60_000;
const MERCATOR_LIMIT = 85.05112878;
type Fix = { latitude: number; longitude: number; accuracy: number; timestamp: number };
type LocationError = LocationFailure | 'invalid';

export function LocationPanel({ getMap, ready }: { getMap: () => MapInstance | null; ready: boolean }) {
  const { t, i18n } = useTranslation();
  const [fix, setFix] = useState<Fix | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LocationError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!fix) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [fix]);
  const locate = () => {
    if (pending) return;
    setError(null); setFix(null);
    const request = ++generation.current;
    setPending(true);
    void requestCurrentLocation().then(position => {
      if (request !== generation.current) return;
      const { latitude, longitude, accuracy, timestamp } = position;
      if (![latitude, longitude, accuracy, timestamp].every(Number.isFinite) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy < 0 || timestamp <= 0 || timestamp > Date.now() + 5000) {
        setError('invalid');
      } else { setFix({ latitude, longitude, accuracy, timestamp }); setNow(Date.now()); }
    }).catch(failure => {
      if (request === generation.current) setError(classifyLocationFailure(failure));
    }).finally(() => {
      if (request === generation.current) setPending(false);
    });
  };
  const clear = () => { generation.current++; setPending(false); setFix(null); setError(null); };
  const stale = fix !== null && now - fix.timestamp > MAX_AGE_MS;
  const formatter = new Intl.NumberFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 6 });
  return <section className="location-card" aria-labelledby="location-title">
    <h2 id="location-title">{t('gpsTitle')}</h2><p>{t('gpsPrivacy')}</p>
    <div className="location-actions"><button type="button" onClick={locate} disabled={pending}>{t('gpsLocate')}</button><button type="button" onClick={clear} disabled={!pending && !fix && !error}>{pending ? t('gpsCancel') : t('gpsClear')}</button></div>
    {pending && <p role="status">{t('gpsPending')}</p>}
    {error && <p role="alert" className="location-error">{t(`gpsError_${error}`)}</p>}
    {fix && <div className="gps-result" role="status">
      <p>{t('gpsCoordinates')}: <strong>{formatter.format(fix.latitude)}°, {formatter.format(fix.longitude)}°</strong></p>
      <p>{t('gpsAccuracy', { accuracy: formatter.format(fix.accuracy) })}</p>
      <p>{t('gpsRecorded')}: {new Intl.DateTimeFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(fix.timestamp))}</p>
      {stale && <p className="location-error">{t('gpsStale')}</p>}
      {Math.abs(fix.latitude) > MERCATOR_LIMIT && <p className="location-error">{t('gpsOutsideMap')}</p>}
      <button type="button" disabled={!ready || stale || Math.abs(fix.latitude) > MERCATOR_LIMIT} onClick={() => {
        // Re-check freshness at click time, not only on the interval-driven render.
        if (Date.now() - fix.timestamp <= MAX_AGE_MS && Math.abs(fix.latitude) <= MERCATOR_LIMIT) getMap()?.easeTo({ center: [fix.longitude, fix.latitude], zoom: 15 });
        else setNow(Date.now());
      }}>{t('gpsCenter')}</button>
    </div>}
  </section>;
}
