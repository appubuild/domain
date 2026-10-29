# Land Expert

A professional land surveying and land management workspace, under phased development. Phases 4–7 remain partial; Phases 8–9 tenant administration and licensing foundations have started. This is not a complete survey application.

## Development

Requires Node.js 22 and npm. Run `npm install`, then `npm run dev`. Run `npm run typecheck`, `npm test`, and `npm run build` for verification. Browser tests require `npx playwright install chromium` followed by `npm run test:e2e`.

See [phase status](docs/phase-status.md), [foundation architecture](docs/architecture/foundation.md), [survey engine](docs/architecture/survey-engine.md), and [local projects](docs/architecture/local-projects.md) plus [tenant administration](docs/architecture/tenant-administration.md) for scope and limitations. Drawing sessions have no imagery or autosave. Validated project copies can be saved in this browser, imported/exported as GeoJSON, and transferred via bounded backup/restore. Imported source CRS must be verified by the user. Core workflows are exercised in headless Chromium; physical devices, other browsers and broader recovery scenarios remain unverified. Bengali PDF is disabled due to a known Unicode extraction failure; the regression test currently fails.

Phase 4 remains incomplete. Experimental English-only PDF reports have strict name and size limitations; Bengali PDF export is disabled due to a known Unicode extraction defect. See [local project and report limitations](docs/architecture/local-projects.md).
