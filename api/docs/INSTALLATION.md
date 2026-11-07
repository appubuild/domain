# Safe Home Network API — Installation & Hosting Guide

This guide covers cPanel / Hostinger shared hosting (Apache or LiteSpeed, PHP 8.1+, MySQL 8+)
and the two supported deployment layouts.

---

## 1. Requirements

| Component | Minimum | Notes |
| --- | --- | --- |
| PHP | 8.1 | 8.2 or 8.3 recommended. Extensions: `pdo_mysql`, `mbstring`, `json`, `fileinfo`, `curl` (optional, lead webhook), `gd`/`imagick` (optional, image dimensions are read with `getimagesize`) |
| MySQL / MariaDB | MySQL 8.0 / MariaDB 10.5 | `utf8mb4` + InnoDB. Only MySQL 8 features used are `CHECK`-free, `JSON` columns and `ON DUPLICATE KEY` |
| Apache modules | `mod_rewrite`, `mod_headers` | `mod_authz_core` for the deny rules. LiteSpeed supports all three |
| HTTPS | required | Session cookies are `Secure` by default |
| Disk | ~10 MB code + uploads | Upload limit 5 MB per file by default |

Check the PHP version from cPanel → **Select PHP Version**, and enable the extensions from
**Extensions**. The API refuses to boot on PHP < 8.1 and answers with a JSON error.

---

## 2. Upload the files

Two layouts work. **Layout A is recommended** because it keeps secrets outside the web root.

### Layout A — API in `public_html/api`, secrets one level up

```
/home/USER/
├── .env                     ← secrets live here (outside public_html)
├── storage/                 ← optional writable folder (or use api/storage)
└── public_html/
    ├── index.html           ← built frontend (dist/)
    ├── assets/
    ├── uploads/             ← copy of api/uploads (served by the web server)
    └── api/                 ← the contents of this `api/` folder
        ├── index.php
        ├── .htaccess
        ├── controllers/ models/ …
        └── uploads/         ← can be symlinked or left unused (see §6)
```

### Layout B — everything inside the API folder

```
public_html/api/
├── .env                     ← must be denied by .htaccess (already configured)
├── storage/
└── …
```

Upload `api/` as a ZIP through **cPanel → File Manager** and extract. Keep the folder name `api`:
the shipped `.htaccess` uses `RewriteBase /api/`.

If you must deploy at a different path (e.g. `/backend`), edit `RewriteBase` in
`api/.htaccess` and the `RedirectMatch` prefix, then set `VITE_API_BASE_URL` accordingly.

---

## 3. Create the database

1. cPanel → **MySQL Databases** → create a database (e.g. `shn_api`) and a user with a long password.
2. Add the user to the database with **ALL PRIVILEGES** (needed for the initial import only; after
   import you can drop `CREATE`, `ALTER`, `DROP` if your host lets you).
3. Open **phpMyAdmin** → select the database → **Import** → choose `database/safehomenetwork.sql`
   → set *Character set of the file* to `utf-8` → **Go**.

The import file runs in this order:

1. `SET NAMES utf8mb4`, foreign-key checks off
2. drops any older copies of the 22 tables (safe on a fresh database, destructive on re-import)
3. creates the schema with indexes, foreign keys and unique constraints
4. inserts the seeded content (5 categories, 15 services, 10 phone groups, 20 numbers,
   12 pages, 6 posts, 8 homepage sections, 12 FAQs, 33 settings, 1 SEO row, 1 admin)

If your host limits upload size, import `database/schema.sql` and `database/seed.sql` separately.

**Seed data you must change after the first login**

| Item | Seeded value | Where to change |
| --- | --- | --- |
| Admin email / password | `info@safehomenetwork.com` / `Sa123456` | Admin → Profile → Change password (or SQL, see below) |
| Contact email | `support@safehomenetwork.com` | Admin → Settings |
| Analytics / verification IDs | empty | Admin → Settings → Integrations |

If sign-in is locked or the seeded hash does not match, this restores the documented
password `Sa123456` (change it from Profile immediately afterwards):

```sql
UPDATE admins
   SET password_hash = '$2y$12$O.mAyi0e.szDnNHbiL.sZ.Q4k66zoaUBJUNwBtn0.LJ9MSo/5IMoC',
       failed_attempts = 0,
       locked_until = NULL,
       status = 'active'
 WHERE email = 'info@safehomenetwork.com';
DELETE FROM rate_limits;
```

`php -r "var_dump(password_verify('Sa123456', '$2y$12$O.mAyi0e.szDnNHbiL.sZ.Q4k66zoaUBJUNwBtn0.LJ9MSo/5IMoC'));"`
prints `true` — the hash above is verified.

Generate a new password hash without a shell:

```sql
-- Run in phpMyAdmin → SQL after generating the hash with any bcrypt tool,
-- or temporarily set APP_DEBUG=true and use POST /v1/auth/password/forgot.
UPDATE admins
   SET password_hash = '$2y$12$REPLACE_WITH_A_REAL_HASH',
       password_changed_at = UTC_TIMESTAMP()
 WHERE email = 'info@safehomenetwork.com';
```

### 3a. Optional: sample analytics for a preview

The admin panel starts with empty charts, because every figure is measured — there is
no built-in fake data any more. If you need a populated dashboard for a walkthrough or a
client preview, import **`database/sample-analytics.sql`** (phpMyAdmin → Import):

* ~2,700 page views, 1,500 unique visitors, 676 service clicks and 202 call clicks over the
  last 30 days (dates are relative to `CURDATE()`, so import any time)
* 10 leads in **Leads & Support**, 78 connected calls and $407.55 of revenue
* realistic source / device / landing-page split, and the `analytics_daily` rollup rebuilt

The rows are invented, not measured, and each one carries a marker so it can be deleted in
one step: `analytics_events.visitor_id` starts with `demo0000`, `leads.reference` starts with
`SMPL-` (emails use `@example.com`), `call_records.external_call_id` starts with
`sample-call-`, and `revenue_records.source` is `SAMPLE-PREVIEW`.

**Remove it before launch.** Import `database/sample-analytics-remove.sql`: it deletes only
the marked rows, rebuilds the daily rollup, and ends with a report showing `0` left behind.
Prefer not to show invented revenue at all? Delete section 6 of the sample file before
importing, and the revenue card stays at `$0.00`.

---

## 4. Configure `.env`

Copy `api/.env.example` to `.env` (Layout A: the repository root, one level above `public_html`)
and fill in the values:

```ini
APP_ENV=production
APP_DEBUG=false
APP_URL=https://safehomenetwork.com/api
SITE_URL=https://safehomenetwork.com
APP_KEY=            # leave empty once; the API generates storage/app.key

DB_HOST=localhost
DB_NAME=cpaneluser_shn
DB_USER=cpaneluser_shn
DB_PASSWORD=…

CORS_ALLOWED_ORIGINS=https://safehomenetwork.com,https://www.safehomenetwork.com
COOKIE_SECURE=true
```

Notes:

* `APP_KEY` — 64 hex characters. Generate with
  `php -r "echo bin2hex(random_bytes(32));"` or let the API create it (needs a writable
  `api/storage/`). Changing it later invalidates CSRF tokens and password-reset links.
* `COOKIE_SECURE=true` requires HTTPS. Set it to `false` **only** while testing on plain HTTP.
* `CORS_ALLOWED_ORIGINS` must list the exact origins (scheme + host, no trailing slash). The API
  echoes one of these back; it never sends `*` with credentials.

---

## 5. Set permissions

```text
api/            755 (files 644)
api/storage/    775  ← writable, holds app.key + php-error.log
api/uploads/    775  ← writable, holds uploaded images
```

In cPanel File Manager: right-click → **Change Permissions**. Do **not** use 777.

---

## 6. Uploads directory

The API writes to `api/uploads/library/YYYY/MM/` and returns URLs under `/api/uploads/...`.
Every `.php`-like file in that folder is denied execution by `api/uploads/.htaccess`.

If your host serves `public_html/api/uploads` fine, nothing else is needed. To keep uploads
outside the API folder, point the built frontend at them:

```ini
UPLOAD_PATH=/home/USER/public_html/uploads
UPLOAD_URL=/uploads
```

and copy `api/uploads/.htaccess` into that folder.

---

## 7. HTTPS, CORS and cookies

1. Enable **AutoSSL** / Let's Encrypt in cPanel and force HTTPS.
2. Confirm `COOKIE_SECURE=true` and that `SITE_URL` matches the HTTPS origin.
3. Add the frontend origin(s) to `CORS_ALLOWED_ORIGINS`.
4. If the frontend is served from the same origin as the API (`https://site.com` + `/api`),
   CORS is irrelevant for normal requests — the allow-list still matters for local development.

---

## 8. Verify the install

```bash
curl -s https://safehomenetwork.com/api/v1/health
```

Expected:

```json
{"data":{"status":"ok","version":"1.0.0","php":"8.2.x","database":"connected","time":"…"}}
```

* `503` + `"database":"unavailable"` → credentials or database name are wrong.
* `500` + `php_version_unsupported` → switch the PHP version in cPanel.
* `404` on every path → `mod_rewrite` is off or `RewriteBase` does not match the folder.
* `403` on `/api/v1/health` → a leftover host rule; check `.htaccess` order.

Then check the public content and sign in:

```bash
curl -s https://safehomenetwork.com/api/v1/services | head -c 400
curl -s -X POST https://safehomenetwork.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"info@safehomenetwork.com","password":"Sa123456"}'
```

---

## 9. Optional cron jobs

| Job | Command | Frequency |
| --- | --- | --- |
| Prune old analytics events / rate-limit rows | `php /home/USER/public_html/api/tools/maintenance.php` | daily |
| Rebuild the daily rollup | called automatically by the admin "Rebuild" action | as needed |

`tools/maintenance.php` keeps the tables bounded; it is safe to run manually.

---

## 10. Frontend connection

Build the site with the API enabled:

```bash
VITE_API_BASE_URL=https://safehomenetwork.com/api npm run build
```

Then upload `dist/` to `public_html/`. See `docs/API-INTEGRATION.md` for what changes in the UI
and what happens when the variable is absent.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `500 database credentials are not configured` | `.env` missing or not readable | Create `.env`; check `APP_ENV`; see `api/storage/logs/php-error.log` |
| Login returns `429` / “Too many failed attempts. Try again in N seconds.” | Account lockout after 5 wrong passwords (per account) or the IP throttle | Wait 15 minutes, or clear it in phpMyAdmin: `UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE email = 'you@example.com'; DELETE FROM rate_limits;` |
| Login says the password is incorrect but you are sure it is right | The stored hash is not the seeded one, or the browser autofilled an old password | Compare `SELECT password_hash FROM admins WHERE email = '…';` with `database/seed.sql`, and set a known hash (see below) |
| Login succeeds but the admin console bounces back | Third-party cookies blocked between different origins | Serve the frontend and API on the same origin, or allow the cookie in the browser |
| `403 CSRF token` on every save | CSRF cookie not readable (wrong `COOKIE_DOMAIN`) or site is HTTP | Set `COOKIE_DOMAIN` empty; use HTTPS |
| `403 This origin is not allowed` | Frontend origin missing from the allow-list | Add it to `CORS_ALLOWED_ORIGINS` |
| Uploads fail with 500 | Folder not writable | `chmod 775 api/uploads` (and `library/`) |
| Images 404 after upload | `UPLOAD_URL` mismatch | Set `UPLOAD_URL=/api/uploads` (or where you copied the folder) |
| Snippet rejected on save | The snippet is not on the allow-list | See `docs/SECURITY.md` → script policy |

Logs: `api/storage/logs/php-error.log`. Nothing sensitive is written there — no passwords,
no raw IP addresses (only HMAC fingerprints).
