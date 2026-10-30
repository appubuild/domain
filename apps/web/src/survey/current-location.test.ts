import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { classifyLocationFailure, requestCurrentLocation } from './current-location';

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getCurrentPosition: vi.fn(),
  },
}));

describe('current location provider', () => {
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.mocked(Geolocation.checkPermissions).mockReset();
    vi.mocked(Geolocation.requestPermissions).mockReset();
    vi.mocked(Geolocation.getCurrentPosition).mockReset();
  });

  it('requests Android location permission only through the native request path', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    vi.mocked(Geolocation.requestPermissions).mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue({
      timestamp: 1_700_000_000_000,
      coords: { latitude: 23.5, longitude: 90.1, accuracy: 8, altitude: null, altitudeAccuracy: null, speed: null, heading: null, magneticHeading: null, trueHeading: null, headingAccuracy: null, course: null },
    });

    await expect(requestCurrentLocation()).resolves.toEqual({ latitude: 23.5, longitude: 90.1, accuracy: 8, timestamp: 1_700_000_000_000 });
    expect(Geolocation.requestPermissions).toHaveBeenCalledWith({ permissions: ['location'] });
    expect(Geolocation.getCurrentPosition).toHaveBeenCalledWith({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });

  it('uses approximate Android permission if granted and does not request again', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue({ location: 'prompt', coarseLocation: 'granted' });
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue({
      timestamp: 1_700_000_000_000,
      coords: { latitude: 23.5, longitude: 90.1, accuracy: 900, altitude: null, altitudeAccuracy: null, speed: null, heading: null, magneticHeading: null, trueHeading: null, headingAccuracy: null, course: null },
    });

    await expect(requestCurrentLocation()).resolves.toMatchObject({ accuracy: 900 });
    expect(Geolocation.requestPermissions).not.toHaveBeenCalled();
  });

  it('does not request a native fix when Android permission is denied', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Geolocation.checkPermissions).mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    vi.mocked(Geolocation.requestPermissions).mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });

    await expect(requestCurrentLocation()).rejects.toMatchObject({ message: 'denied' });
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('classifies browser and native permission/timeout errors', () => {
    expect(classifyLocationFailure({ code: 1 })).toBe('denied');
    expect(classifyLocationFailure({ code: 3 })).toBe('timeout');
    expect(classifyLocationFailure({ code: 'OS-PLUG-GLOC-0003' })).toBe('denied');
    expect(classifyLocationFailure({ code: 'OS-PLUG-GLOC-0010' })).toBe('timeout');
    expect(classifyLocationFailure(new Error('unexpected'))).toBe('unavailable');
  });
});
