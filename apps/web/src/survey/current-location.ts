import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export type LocationFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';
export type CurrentLocation = { latitude: number; longitude: number; accuracy: number; timestamp: number };

class LocationRequestFailure extends Error {
  constructor(readonly kind: LocationFailure) { super(kind); }
}

function isGranted(status: { location: string; coarseLocation: string }): boolean {
  return status.location === 'granted' || status.coarseLocation === 'granted';
}

export async function requestCurrentLocation(): Promise<CurrentLocation> {
  if (Capacitor.isNativePlatform()) {
    let permission = await Geolocation.checkPermissions();
    if (!isGranted(permission)) {
      permission = await Geolocation.requestPermissions({ permissions: ['location'] });
    }
    if (!isGranted(permission)) throw new LocationRequestFailure('denied');
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };
  }

  if (!navigator.geolocation) throw new LocationRequestFailure('unsupported');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export function classifyLocationFailure(error: unknown): LocationFailure {
  if (error instanceof LocationRequestFailure) return error.kind;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code: unknown }).code
    : undefined;
  if (code === 1 || code === 'OS-PLUG-GLOC-0003') return 'denied';
  if (code === 3 || code === 'OS-PLUG-GLOC-0010') return 'timeout';
  return 'unavailable';
}
