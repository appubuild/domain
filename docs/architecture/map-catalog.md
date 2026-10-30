# Phase 5 map catalog — experimental

The survey page starts with the local graticule. Users may explicitly select OpenStreetMap's standard raster tile service for online viewing. The selector changes only the basemap source/layer, not the drawing style or stored data. Attribution is visible on the map while the layer is selected. Switching back removes the source and restores the grid; preferences do not persist and no automatic tile requests occur on later visits. When the browser reports an offline event, the online source is removed and the app returns to grid; online layers cannot be selected while the browser reports offline. The browser online signal is only a hint and does not prove connectivity or detect every network failure. A tile error is reported without hiding or disabling the editor. A retry can be made by switching to grid and selecting the online layer again.

Online viewing sends tile requests, the viewed approximate map area, IP address and normal browser request information to OpenStreetMap's tile infrastructure. Users should not select it when that disclosure is inappropriate. Browser HTTP caching is outside this app's control. No tile prefetch, offline download, API key, secret, or server proxy is implemented. The offline grid is not an offline basemap. It is usable in an already loaded session without tile requests; the application is not an offline-first PWA and loading or reloading it without a network is not guaranteed. Local projects are separate from the basemap, and neither grid nor map is cadastral or a legal boundary reference.

This is an **experimental web preview**, not an approved production provider. OpenStreetMap's [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) requires visible attribution, correct URL, a valid browser Referer, honoring cache headers, and prohibits bulk download/offline use. The service is best-effort and may block access; the [licence FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ) distinguishes open data from the community tile service. Before production choose and review a provider appropriate to the actual commercial use and traffic, configure it without exposing secrets, check browser headers/cache and attribution, and validate provider access on deployed domains. Mobile/native identification and caching requirements are not implemented. No guarantee of service or offline map support is implied.

Tests intercept all OpenStreetMap tile requests with a local synthetic PNG or an artificial network failure; no automated test sends map traffic to the live community service. The sandbox cannot reach that host, so live tile rendering, actual caching and Referer behavior remain unverified. Chromium tests cover opt-in requests, attribution, unchanged exported geometry after switching, failure recovery, responsive layouts and automated accessibility. They do not establish cross-browser, native or physical-device compatibility.

## Deployment-owned provider catalog

`apps/web/public/map-catalog.json` is a **public**, versioned configuration. It ships with `allowCommunityOsm: true` and an empty provider list. The browser loads it from the app's own base path, not from a tile provider; the grid stays active until the user selects a provider. An invalid, missing, oversized (over 32 KiB), malformed UTF-8 or stalled configuration fails closed to grid with a translated message. Loading times out after eight seconds. Refreshing reloads the configuration and returns to grid; the selection is not persisted.

An operator may disable the community source and configure up to ten approved public raster providers. This example uses reserved documentation domains and **does not provide a working map**:

```json
{
  "version": 1,
  "allowCommunityOsm": false,
  "providers": [{
    "id": "approved-map",
    "name": "Approved map",
    "tileUrl": "https://tiles.example.com/{z}/{x}/{y}.png",
    "tileSize": 256,
    "maxZoom": 19,
    "attribution": "© Example provider",
    "attributionUrl": "https://example.com/attribution"
  }]
}
```

Publish the updated JSON at the same app base path and verify that the host serves the new file; deployment/CDN caches and immutable hosting may require a new deployment or invalidation. The app accepts a single HTTPS XYZ raster template with each `{z}`, `{x}`, `{y}` once in its path, 256- or 512-pixel tiles and maximum zoom 0–22. IDs are unique lowercase ASCII identifiers; `grid` and `osm` are reserved. Attribution is mandatory and rendered as a visible HTTPS link. Credentials, explicit ports, query strings, fragments, localhost (including trailing-dot forms), .local names and literal IPs are rejected by validation; HTTPS and syntax validation do **not** prove that a domain is public, safe, licensed, operational or policy-compliant.

**Never put API keys, tokens or other secrets in this public file or a URL path.** Query-string credentialed services, custom headers, WMS/WMTS, vector styles and an authenticated tile proxy are not implemented. Operator-provided names and attribution are displayed as configured; the operator is responsible for translations, provider terms, access, legal attribution and privacy. The sample provider shown in tests is mocked, not an actual agreement or provider integration. The live map host is outside this sandbox's permitted outbound hosts, so no live rendering, CORS, provider caching or deployment Referer has been verified.

### Protected-preview loading and map diagnostics

The catalog is a same-origin static file. Fetch it with `credentials: 'same-origin'` so authenticated users can load it from Vercel previews protected by deployment access control; cookies are not sent to cross-origin tile hosts. A regression test protects this policy. If the app reports that the drawing map itself could not load, that is a separate MapLibre initialization failure before the map's `load` event (often WebGL/GPU support or browser restrictions); a working catalog or tile provider cannot repair that. The app currently cannot expose the browser's underlying WebGL exception in its UI, so a direct-browser console/device check is needed to identify the exact cause.
