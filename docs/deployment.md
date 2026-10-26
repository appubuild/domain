# Deployment

DomainFits is a **static export**. `npm run build` writes a self-contained `out/` directory;
whatever host you use must be able to serve HTML files and, ideally, rewrite rules.

```
out/
├── index.html                     # /
├── generator/index.html           # /generator/
├── industries/…                   # directory pages (17 industries)
├── blog/…                         # index + articles
├── about/ contact/ faq/ …         # CMS pages
├── admin/…                        # admin SPA routes (auth-gated, noindex)
├── 404.html
├── _next/                         # hashed CSS/JS chunks
├── robots.txt
├── sitemap.xml
├── .htaccess                      # Apache rules (generated)
├── _redirects                     # Netlify / Cloudflare Pages (generated)
└── redirects.json                 # audit copy of the compiled rules
```

---

## 1. Environment

Copy `.env.example` to `.env.local` (or export the variables in CI) **before** building. All
values are public and inlined at build time.

| Variable | Required | Effect when missing |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | For SEO | Canonicals, Open Graph URLs and sitemap entries are omitted; the build logs a warning |
| `NEXT_PUBLIC_SITE_NAME` | No | Falls back to `DomainFits` |
| `NEXT_PUBLIC_SUPABASE_URL` | For CMS/admin | Site builds from the offline content pack; admin shows "not configured" |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For CMS/admin | Same as above |
| `NEXT_PUBLIC_DATA_BACKEND` | No | `local` when Supabase is absent |
| `NEXT_PUBLIC_AVAILABILITY_FN_URL` | No | Availability runs directly against RDAP from the browser |
| `NEXT_PUBLIC_ALLOW_LOCAL_STORE` | No | `false`; never enable in production |

Secrets — service-role keys, registrar keys, AI provider keys — must never appear here. They
belong in Supabase Edge Function secrets. See [`security.md`](security.md).

The canonical origin must match exactly where the site is served, including `https://` and
excluding a trailing slash. A mismatch splits canonical signals, so rebuild after any host change.

---

## 2. Shared hosting (Apache + PHP, no Node)

1. `npm ci && npm run build`
2. Upload the **contents** of `out/` to `public_html/` (or a subdirectory).
3. Confirm hidden files were transferred — `.htaccess` is easy to miss and without it you lose
   redirects, the 404 handler and directory-index hardening.
4. Set the document root to the uploaded folder. Do not upload `src/`, `node_modules/` or `supabase/`.

`out/.htaccess` contains:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  # canonical host + protocol (only when NEXT_PUBLIC_APP_URL is https)
  RewriteCond %{HTTPS} off [OR]
  RewriteCond %{HTTP_HOST} !^example\.com$ [NC]
  RewriteRule ^ https://example.com%{REQUEST_URI} [R=301,L]
  # database redirects, e.g.
  RewriteRule ^old-page/?$ /new-page/ [R=301,L]
</IfModule>

ErrorDocument 404 /404.html
DirectoryIndex index.html
Options -Indexes
```

Trailing slashes are part of the URL contract (`trailingSlash: true`). `/about` is served from
`about/index.html`; Apache's `mod_dir` issues the `/about` → `/about/` redirect automatically.
If `mod_rewrite` is unavailable on your plan, the site still serves correctly but the redirects
and canonical-host consolidation do nothing — check with your host.

### Deploying into a subdirectory

Set `NEXT_PUBLIC_APP_URL=https://example.com/domainfits` **and** add `basePath: "/domainfits"`
to `next.config.ts` before building. Without the base path the asset URLs will 404.

---

## 3. Netlify / Cloudflare Pages

- Build command: `npm run build`
- Publish directory: `out`
- Use `out/_redirects` (already generated) instead of `.htaccess`.

Both hosts apply `_redirects` before serving files, so database redirects work without Apache.

---

## 4. Supabase

```bash
supabase login
supabase link --project-ref <ref>
supabase db push --include-seed     # migrations 0001–0006 + seed data
```

Then:

1. Authentication → create your admin user; disable public sign-ups unless needed.
2. SQL editor: `insert into public.user_roles (user_id, role_id) values ('<uuid>', 'admin');`
3. Copy the project URL and **anon** key into `.env.local`, rebuild.

RLS is enabled on all 44 tables, so the anon key is safe in the browser. Verify with:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and rowsecurity = false;   -- must return zero rows
```

### Edge Functions (optional)

- **Availability proxy** — centralises RDAP calls, applies rate limits and stores results in
  `availability_cache`. Set `NEXT_PUBLIC_AVAILABILITY_FN_URL` to its URL.
- **AI content studio** — drafts only, never auto-publishes. Requires a provider key stored as a
  function secret; the feature stays off until `feature_flags.ai_content_studio = true`.

Deploy with `supabase functions deploy <name> --no-verify-jwt` only where a function is truly
public; anything that writes must verify the caller's JWT and role.

---

## 5. Going live checklist

- [ ] `NEXT_PUBLIC_APP_URL` set to the final origin, then rebuilt
- [ ] `out/.htaccess` present and `https` + canonical host resolve with one 301 hop
- [ ] `robots.txt` allows crawling and disallows `/admin/`
- [ ] `sitemap.xml` lists absolute URLs (view source — an empty `<urlset>` means the origin is unset)
- [ ] submitted sitemap in Search Console
- [ ] admin sign-in works and a non-admin account is correctly refused
- [ ] redirects from the admin table reach the live site after a rebuild
- [ ] ad slots stay disabled until a publisher ID and consent flow exist
- [ ] previous `out/` kept as the rollback artifact

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Asset 404s, unstyled page | Uploaded into a subdirectory without `basePath` | See §2 |
| `/about` 404 | Only `about.html` uploaded, or `DirectoryIndex` overridden | Upload `about/index.html`; check `.htaccess` |
| Redirects do nothing | `mod_rewrite` disabled, or `.htaccess` not uploaded | Ask host; verify with `curl -I` |
| Sitemap empty | `NEXT_PUBLIC_APP_URL` missing at build time | Set it and rebuild |
| Admin shows "not configured" | Supabase env vars absent from the build | Set both vars, rebuild |
| Admin shows "no administrator role" | Signed in without `user_roles` row | Insert the row in SQL, reload |
| Content edits do not appear | Static export serves bytes baked at build time | Rebuild and re-upload |
| Dev server 500s with `Cannot find module './NNN.js'` | `npm run build` ran while `next dev` was live and rewrote `.next`; dev and build share that directory | Stop the dev server, `npm run clean`, then restart — or run the build after stopping it |

---

## 7. Rollback

The previous `out/` directory is a complete, independent release. Keep the last known-good copy;
restoring it is a file copy, not a migration. Database rollback is a Supabase backup restore —
take one before `db push` and before bulk content changes.
