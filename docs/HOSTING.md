# Hosting Guide — Safe Home Network

The site is a **static website**. There is no database, no PHP and no server-side
runtime. That means it can be hosted almost anywhere: shared cPanel hosting,
Netlify, Vercel, Cloudflare Pages, AWS S3, or a VPS.

Two things to know before you start:

1. **Build command:** `npm run build`
2. **Publish directory:** `dist/`

If you prefer not to run Node on your computer, you do not have to. Use the
pre-built `dist` package supplied alongside this guide and upload its contents
directly. Everything below works the same either way.

---

## Option A — cPanel / shared hosting (most common)

This is the classic "upload with File Manager or FTP" path.

### 1. Build (or use the ready-made dist package)

On your computer, in the project folder:

```bash
npm install
npm run build
```

You now have a `dist/` folder containing `index.html`, `assets/`, `images/`,
`sitemap.xml`, `robots.txt`, `favicon.svg` and `.htaccess`.

If you are using the supplied **dist ZIP**, simply unzip it — that folder *is*
the `dist` folder.

### 2. Upload

1. Log in to cPanel → **File Manager**.
2. Open `public_html` (or `public_html/yourdomain.com` if your host uses add-on
   domains that way).
3. Delete the host's default `index.html` / `default.html`, if present.
4. Upload the ZIP of `dist`, then use **Extract** in File Manager. Or upload the
   folder contents by FTP (FileZilla: host, username, password, port 21).
5. Make sure `index.html` sits **directly inside** `public_html` — not inside a
   nested `dist` folder. If it is nested, move the files up a level.

Your `.htaccess` must be uploaded too. File Manager hides dotfiles by default:
open **Settings** (top right) and enable **Show Hidden Files**.

### 3. Point your domain

- If the domain is registered elsewhere, set its nameservers to your host's, or
  add an **A record** pointing to your hosting IP.
- In cPanel, add the domain/subdomain under **Domains** and confirm the document
  root matches where you uploaded the files.

### 4. Enable SSL

In cPanel, open **SSL/TLS Status** and run **AutoSSL** (Let's Encrypt) for the
domain. The bundled `.htaccess` already redirects HTTP → HTTPS.

### 5. Verify the rewrite works

Visit each of these directly in the browser (do not navigate from the homepage —
type the URL and press Enter, or refresh the page):

- `https://yourdomain.com/services/roofing`
- `https://yourdomain.com/how-it-works`
- `https://yourdomain.com/privacy-policy`

Each should load normally. If you get a **404**, the rewrite rule is not running:
confirm `mod_rewrite` is enabled for your account (ask support), confirm
`.htaccess` is in `public_html`, and confirm it was not renamed to
`htaccess.txt`.

### 6. Caching tip after an update

`assets/*.js` and `assets/*.css` filenames contain a build hash, so they are
cached for a year safely. `index.html` is served fresh. When you upload a new
build, also clear your host's cache/CDN cache (cPanel → *LiteSpeed Cache* or
Cloudflare → *Purge Everything*).

---

## Option B — Netlify (drag-and-drop, free tier)

1. Go to app.netlify.com → **Add new site → Deploy manually**.
2. Drag the `dist` folder onto the page.
3. Add your domain under **Domain management → Add a domain**, then follow the
   DNS instructions. Netlify provisions SSL automatically.
4. `netlify.toml` is already in the project, so SPA rewrites and headers work.

For continuous deploys, connect the GitHub repo instead and set:
build command `npm run build`, publish directory `dist`.

---

## Option C — Vercel

1. Import the GitHub repo at vercel.com/new.
2. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
3. Add the domain under **Settings → Domains**. `vercel.json` already provides the
   SPA rewrite and cache/security headers.

CLI alternative: `npm i -g vercel && vercel --prod` from the project folder.

---

## Option D — Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Build command `npm run build`, output directory `dist`.
3. `public/_redirects` is included in the build, so deep links work.
4. Add a custom domain in the Pages project settings.

---

## Option E — AWS S3 + CloudFront

1. `aws s3 sync dist/ s3://your-bucket --delete`
2. Static website hosting is optional; CloudFront is recommended.
3. **Critical:** set the CloudFront custom error responses so a 403/404 returns
   `/index.html` with a **200** status, otherwise deep links break.
4. Request an ACM certificate for the domain and attach it to the distribution.

---

## After any deployment — launch checklist

1. **Search Console** — add the domain property at search.google.com/search-console,
   verify it, and submit `https://yourdomain.com/sitemap.xml`.
2. **robots.txt** — confirm `https://yourdomain.com/robots.txt` loads and points
   at the sitemap.
3. **Contact form** — works out of the box: submitting opens the visitor's email
   app with the message pre-filled and addressed to `SITE.contact.email`. To
   deliver straight from the page on cPanel hosting, the build already includes
   `contact.php` (edit the two addresses at the top, upload it with `dist/`, then
   build with `VITE_CONTACT_ENDPOINT=/contact.php`). Any other handler works too —
   set `VITE_CONTACT_ENDPOINT` to its URL (plus `VITE_SPAM_PROTECTION_SITE_KEY`
   if it needs a captcha) and rebuild.
4. **Service phone numbers** — already live in `src/data/serviceNumbers.ts`.
   `SITE.contact.phone` / `phoneDisplay` in `src/config/site.ts` are only for an
   optional company-wide line; leave them empty to show per-service numbers
   only.
5. **Coverage data** — `src/config/coverage.ts` ships empty, so the site never
   claims availability it cannot verify. Add verified records and rebuild.
6. **Public pages carry no setup notes** — launch reminders live in
   `docs/PRE-LAUNCH-CHECKLIST.md`, never on the site.

Every one of those items lives in the source project, so a rebuild is required
after changing them. If you are hosting the ready-made `dist` package without the
source, ask your developer to rebuild with the final values.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Homepage works, inner pages 404 | SPA rewrite missing | Upload `.htaccess`, enable `mod_rewrite`, or add the host's redirect rule |
| Blank white page | Files uploaded one level too deep, so `/assets/...` 404s | Move `index.html`, `assets/`, `images/` directly into `public_html` |
| Images missing | `images/` folder not uploaded | Upload the complete `dist` contents, keeping the folder structure |
| CSS looks unstyled | `assets/` folder missing or blocked | Re-upload `dist/assets`; check for a security plugin blocking hashed filenames |
| Contact form says "not configured" | `VITE_CONTACT_ENDPOINT` empty at build time | Set it in `.env`, run `npm run build`, re-upload |
| Mixed-content warnings | Site loaded over `http://` | Enable AutoSSL and keep the HTTPS redirect in `.htaccess` |
