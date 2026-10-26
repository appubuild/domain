# DomainFits Dynamic CMS

এই প্রজেক্টটি মূল static সাইটের বিকল্প নয়; এটি আলাদা `domain_fit_dynamic/` সাবডিরেক্টরিতে চলা PHP/MySQL সংস্করণ। মূল repository root-এর HTML, CSS, JavaScript ও Capacitor offline bundle এই CMS থেকে আলাদা থাকবে। Dynamic CMS-এ ঢোকার public path সাধারণত `/domain_fit_dynamic/`।

## প্রয়োজনীয় পরিবেশ

- PHP 8.1 বা পরবর্তী সংস্করণ; `PDO`, `pdo_mysql`, `fileinfo` চালু থাকতে হবে। `ext-dom` rich-text ও custom ad markup-এর safe sanitization-এর জন্য দরকার; rich content sanitizer না পেলে নিরাপদে plain-text fallback করে। Gemini key Admin থেকে encrypted করে রাখতে `openssl` extension ও কমপক্ষে ৩২ অক্ষরের `APP_SECRET` দরকার; environment variable দিয়ে key দিলে DB encryption দরকার হয় না।
- MySQL 8 অথবা MariaDB 10.6 বা পরবর্তী সংস্করণ।
- Apache `mod_rewrite` ও `.htaccess` override অনুমোদিত; HTTPS ব্যবহার করুন।
- কোনো Composer, Tailwind CDN বা Font Awesome CDN runtime dependency নেই। সব UI asset স্থানীয় `assets/` কপি থেকে লোড হয়।

## প্রথমবার স্থাপন

1. Hosting panel-এ নতুন MySQL database ও dedicated database user তৈরি করুন। Initial import-এর জন্য database-এ table create/index permission দিন; runtime-এ প্রয়োজনের অতিরিক্ত privilege দেবেন না।
2. phpMyAdmin থেকে ওই database নির্বাচন করে `database.sql` import করুন। এতে generator wordbank/category seed, ৩২টি published article, ২০টি Day 31–50 draft, relational post-category schema, 2L–6L word metadata এবং default-off ad placements তৈরি হবে। কোনো default admin/password, AdSense publisher ID, GA4 ID বা GTM ID তৈরি হয় না।
3. Existing CMS database-এ code update করলে database পুনরায় import করবেন না। আগে backup নিন, তারপর migration একবার চালান:
   ```bash
   cd /path/to/public_html/domain_fit_dynamic
   php scripts/migrate-enterprise-cms.php
   ```
   Script idempotent; free-text post categories relational IDs-এ backfill করে, পুরোনো `blog_posts.category` string অক্ষত রাখে এবং ad/wordbank columns যোগ করে। `database.sql`-এর fresh install-এও একই command চালানো নিরাপদ।
4. `domain_fit_dynamic/.env` ফাইল খুলে নিজের তথ্য দিন; `.env.example` একই folder-এ নমুনা হিসেবে আছে। GitHub থেকে deploy করলে server-এ `.env.example` কপি করে `.env` নাম দিন, তারপর `.env` সম্পাদনা করুন। এই CMS-এর local loader ফাইলটি পড়ে; hosting panel-এর environment variable দিলে সেটি `.env`-এর মানের ওপর অগ্রাধিকার পাবে।
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` — hosting panel-এর MySQL database অংশ থেকে নিন।
   - `APP_SECRET` — কমপক্ষে ৩২টি random byte/character-এর অনন্য secret; admin-login rate limit এর ওপর নির্ভর করে।
   - `ANALYTICS_SALT` — `APP_SECRET` থেকে আলাদা অনন্য secret; optional daily approximate visitor digest-এর জন্য। এটি না থাকলেও aggregate page-view event গণনা করা যায়।
   - `APP_BASE_PATH=/domain_fit_dynamic`; app যদি website root-এ থাকে, `APP_BASE_PATH=` খালি রাখুন। Folder/path ভিন্ন হলে সঠিক public path দিন।
   - `SITE_ORIGIN=https://আপনার-প্রকৃত-ডোমেইন` (শেষে `/` ছাড়া); canonical URL ও sitemap-এর জন্য এটি দিন।
   - `GEMINI_API_KEY` optional; server environment-এ দিলে API key browser-এ যায় না। Admin Settings থেকেও key দেওয়া যায়—সেটি `APP_SECRET` দিয়ে AES-256-GCM encrypted অবস্থায় database-এ থাকে। `GEMINI_MODEL` optional; default `gemini-2.5-flash`।

   `.env` Git-এ ignore করা এবং `.htaccess` দিয়ে web থেকে block করা। Server-এ permission সম্ভব হলে `600` দিন। `.env` বা database password commit/share করবেন না। `config/environment.example` পুরোনো hosting-variable তালিকা হিসেবেও রাখা হয়েছে; local file হলো project root-এর `.env`।
5. SSH-এর interactive terminal-এ চালান:

   ```bash
   cd /path/to/public_html/domain_fit_dynamic
   php scripts/create-admin.php
   ```

   Script email, display name ও password terminal-এ নেয়, password hash করে এবং প্রথম Super Administrator তৈরি করে। কোনো web installer বা default login নেই।
6. `uploads/`, `storage/cache/` এবং `storage/logs/` PHP process-এর জন্য writable করুন। Directory listing বন্ধ, runtime storage web থেকে block এবং upload folder-এ PHP execution নিষিদ্ধ `.htaccess`-এ নির্ধারিত।
7. `/domain_fit_dynamic/admin/` খুলে login করে Site settings, Navigation menus, Contact inbox, page/post content এবং privacy information review করুন। Production origin ও backup যাচাই করুন।

PHP error log: Hosting File Manager-এ CMS folder → `storage/` → `logs/` → `php-error.log`। প্রথম PHP request-এ ফাইলটি তৈরি হবে; না হলে hosting account-এর PHP process-এর জন্য `storage/logs/` writable করুন। `storage/` ও `storage/logs/`-এর `.htaccess` ফাইল HTTP access block করে—log-টি browser-এ খোলা যাবে না, File Manager বা hosting-এর private log viewer ব্যবহার করুন। Log file Git-এ commit হয় না।

### Public URL ও API

- Homepage: `/domain_fit_dynamic/`
- Generator: `/domain_fit_dynamic/tools/domain-generator`
- Blog archive: `/domain_fit_dynamic/blog/`
- Blog post: `/domain_fit_dynamic/blog/{slug}`
- CMS page: `/domain_fit_dynamic/pages/{slug}`
- Contact form: `/domain_fit_dynamic/pages/contact`
- Generator API: `POST /domain_fit_dynamic/api/generate` (JSON body-তে `root`, `extension`, `lengths`, `placement`, `count`, `strict`, `brandable`, `category` ইত্যাদি)
- Wordbank API: `GET /domain_fit_dynamic/api/wordbank`
- Sitemap ও robots: `/domain_fit_dynamic/sitemap.xml`, `/domain_fit_dynamic/robots.txt`
- Safe ads.txt endpoint: `/domain_fit_dynamic/ads.txt`
- Affiliate redirect: `/domain_fit_dynamic/go/{slug}`

`.htaccess` থেকে clean URL route হয়: `/tools/domain-generator`, `/blog/`, `/blog/{slug}`, `/about` ও `/pages/about`, `/contact` ও `/pages/contact`, `/privacy-policy`, `/admin/` ও `/admin/login`, `/admin/dashboard`, `/admin/site-settings` এবং admin modules। Direct `.php` URL-এ GET/HEAD request এলে স্থায়ী 301 redirect হয়ে extensionless URL-এ যায়; query string রাখা হয়। Forms clean path-এ submit করে। Site subdirectory থেকে অন্য path-এ স্থানান্তর করলে `APP_BASE_PATH` ও `SITE_ORIGIN` deployment path অনুযায়ী বদলান।

## Content, review gate ও wordbank

- Admin-এর Posts ও Pages editor responsive দুই-column publishing workspace; স্থানীয়ভাবে bundled Quill editor-এ H1–H4, code block, quote, table ও inline image upload/clipboard paste আছে। Toolbar scroll করলে `top:64px`-এ sticky থাকে। Editor-এর HTML server-side sanitize হয়; upload JPEG/PNG/WebP, সর্বোচ্চ ৫ MB, MIME ও image signature যাচাই করা হয়।
- Existing free-text `blog_posts.category` অক্ষত রেখে `categories` ও `blog_post_categories` relational tables যোগ হয়েছে। Migration পুরোনো category value backfill করে; editor থেকে category ID select বা inline create করা যায় এবং public blog filter একাধিক category সমর্থন করে.
- Existing static content-এর ৩২টি প্রকাশিত article database-এ seed করা হয়। Editorial Day 31–50 (২০টি post) `draft` থাকে এবং sitemap/public query-তে আসে না। CMS-এ তাদের `published` বা `scheduled` করতে হলে আলাদা editorial review checkbox দিয়ে gate স্পষ্টভাবে clear করতে হয়। Scheduled post প্রকাশ করতে hosting cron-এ `php scripts/publish-scheduled.php` চালাতে পারেন; gate-clear নয় এমন day 31–50 post cron-ও প্রকাশ করবে না।
- Domain brain-এ curated/brandable/long-partner শব্দ সক্রিয়/নিষ্ক্রিয়, human-review flag, category keyword এবং preferred term সম্পাদনা করা যায়। Review flag হলো সম্পাদকীয় নোট; এটি dictionary, availability বা trademark certification নয়। Review-only mode default-off।
- Gemini workflow niche ও 3–5 seed keyword থেকে 2L–6L JSON preview তৈরি করে; নির্বাচিত term bulk insert করলে সেগুলো `brandable`, `source=gemini`, `verification_status=unverified` এবং human-review flag off থাকে। Model-এর English claim verification নয়; preview থেকে insert স্পষ্টভাবে admin-কে করতে হয়।
- Generator browser-এ result তৈরি করে; API-ও server-side suggestion দেয়। কোনো route domain availability, registrar price, trademark, company name বা social handle যাচাই করে না।

## Ads, analytics ও privacy

- Responsive AdSense placements, size presets, desktop/tablet/mobile toggles, safe ads.txt editor, GA4 ও GTM default-এ blank/off। কেবল প্রকৃত account-issued publisher/ad-unit ID এবং enable switch থাকলেই web slot render হয়। Custom ad HTML sanitize হয়; ad manager-এ JavaScript/iframe/event handlers চলে না—approved vendor scripts privileged Site Settings injection-এ configure করতে হয়। CMS নিজের analytics-এ AdSense ad-click track করে না; Native Capacitor offline bundle-এ ad থাকে না।
- Site Settings-এর header/footer code injection blank by default এবং settings permission-এ সীমাবদ্ধ। Code public browser-এ চলে—শুধু vendor-issued integration code দিন, password/private key নয়। Gemini key server-side AES-256-GCM encrypted করে রাখা যায়; `GEMINI_API_KEY` environment variable থাকলে সেটি precedence পায়.
- First-party page-view/generator-run tracking off by default। চালু করলে event type ও path সংরক্ষিত হয়; root keyword রাখা হয় না। `ANALYTICS_SALT` সেট করা থাকলে approximate daily visitor digest লেখা হয়, raw IP নয়। Hosting provider-এর server logs আলাদা হতে পারে।
- Contact form submission database inbox-এ থাকে; default-এ automatic email পাঠানো হয় না। Admin inbox থেকে CSV export ও mail client দিয়ে manual reply করা যায়। PII retention period, privacy-policy controller/contact details, third-party consent ও local-law requirements deployment অনুযায়ী site owner-কে review/নির্ধারণ করতে হবে। এই template legal advice বা legal compliance guarantee নয়।
- Affiliate redirect click count AdSense ad-click থেকে আলাদা; destination URL admin-এ HTTPS হতে হয়।

## Backup, cache ও rollout

- MySQL database-এর নিয়মিত encrypted backup নিন; `uploads/`-এর logo/hero/featured images-ও backup করুন।
- Public wordbank, homepage/blog data ও sitemap file cache ব্যবহার করে; content/settings update করলে CMS cache invalidate করে। Cache folder web থেকে blocked।
- CMS code ও assets এই সাবডিরেক্টরির বাইরে লেখে না। Static fallback ও native app bundle আলাদা। Native app-এর offline copy CMS website update-এ স্বয়ংক্রিয়ভাবে বদলায় না; native app-এ update আনতে আলাদা build/release প্রয়োজন।
- Hostinger বা target environment-এ deploy করার পর PHP lint, `database.sql` import, admin login, form submit/export, post publish/draft gate, clean URL, sitemap, upload permission এবং valid configured ad slot পরীক্ষা করুন। এই development sandbox-এ PHP/MySQL runtime নেই; তাই live PHP lint ও database integration test এখানে চালানো সম্ভব হয়নি।
