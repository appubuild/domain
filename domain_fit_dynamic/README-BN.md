# DomainFits Dynamic CMS

এই প্রজেক্টটি মূল static সাইটের বিকল্প নয়; এটি আলাদা `domain_fit_dynamic/` সাবডিরেক্টরিতে চলা PHP/MySQL সংস্করণ। মূল repository root-এর HTML, CSS, JavaScript ও Capacitor offline bundle এই CMS থেকে আলাদা থাকবে। Dynamic CMS-এ ঢোকার public path সাধারণত `/domain_fit_dynamic/`।

## প্রয়োজনীয় পরিবেশ

- PHP 8.1 বা পরবর্তী সংস্করণ; `PDO`, `pdo_mysql`, `fileinfo` চালু থাকতে হবে। `ext-dom` চালু থাকলে rich-text sanitizer অনুমোদিত safe HTML বজায় রাখে; না থাকলে এটি নিরাপদে plain text-এ fallback করে।
- MySQL 8 অথবা MariaDB 10.6 বা পরবর্তী সংস্করণ।
- Apache `mod_rewrite` ও `.htaccess` override অনুমোদিত; HTTPS ব্যবহার করুন।
- কোনো Composer, Tailwind CDN বা Font Awesome CDN runtime dependency নেই। সব UI asset স্থানীয় `assets/` কপি থেকে লোড হয়।

## প্রথমবার স্থাপন

1. Hosting panel-এ নতুন MySQL database ও dedicated database user তৈরি করুন। Initial import-এর জন্য database-এ table create/index permission দিন; runtime-এ প্রয়োজনের অতিরিক্ত privilege দেবেন না।
2. phpMyAdmin থেকে ওই database নির্বাচন করে `database.sql` import করুন। এতে generator wordbank/category seed, ৩২টি published article, ২০টি Day 31–50 draft, কয়েকটি তথ্যপাতা এবং default-off ad slots তৈরি হবে। কোনো default admin/password, AdSense publisher ID, GA4 ID বা GTM ID তৈরি হয় না।
3. Hosting panel-এর PHP environment-এ `config/environment.example`-এর variable-গুলো নিজের তথ্য দিয়ে সেট করুন। Secret source control-এ রাখবেন না:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
   - `APP_SECRET` — কমপক্ষে ৩২টি random byte/character-এর অনন্য secret; admin-login rate limit এর ওপর নির্ভর করে।
   - `ANALYTICS_SALT` — `APP_SECRET` থেকে আলাদা অনন্য secret; optional daily approximate visitor digest-এর জন্য। এটি না থাকলেও aggregate page-view event গণনা করা যায়।
   - `APP_BASE_PATH=/domain_fit_dynamic`; app যদি website root-এ থাকে, এটি খালি string দিন। Folder/path ভিন্ন হলে সঠিক public path দিন।
   - `SITE_ORIGIN=https://আপনার-প্রকৃত-ডোমেইন` (শেষে `/` ছাড়া); canonical URL ও sitemap-এর জন্য এটি দিন।
4. SSH-এর interactive terminal-এ চালান:

   ```bash
   cd /path/to/public_html/domain_fit_dynamic
   php scripts/create-admin.php
   ```

   Script email, display name ও password terminal-এ নেয়, password hash করে এবং প্রথম Super Administrator তৈরি করে। কোনো web installer বা default login নেই।
5. `uploads/` ও `storage/cache/` directory PHP process-এর জন্য writable করুন। Directory listing বন্ধ এবং upload folder-এ PHP execution নিষিদ্ধ `.htaccess`-এ নির্ধারিত।
6. `/domain_fit_dynamic/admin/` খুলে login করে Site settings, Navigation menus, Contact inbox, page/post content এবং privacy information review করুন। Production origin ও backup যাচাই করুন।

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

`.htaccess` থেকে clean URL route হয়। Directory-তে সরাসরি `.php` URL-ও কাজ করতে পারে। Site subdirectory থেকে অন্য path-এ স্থানান্তর করলে `APP_BASE_PATH` ও `SITE_ORIGIN` একসঙ্গে বদলান।

## Content, review gate ও wordbank

- Admin-এর Posts অংশে title, slug, excerpt, rich-text body, category, tags, publish/schedule status, featured image, SEO title/description, canonical ও OpenGraph image নিয়ন্ত্রণ করা যায়। Safe-tag allowlist দিয়ে post/page HTML sanitize হয়; uploaded image JPEG/PNG/WebP, সর্বোচ্চ ৫ MB, MIME ও image signature যাচাই করা হয়।
- Existing static content-এর ৩২টি প্রকাশিত article database-এ seed করা হয়। Editorial Day 31–50 (২০টি post) `draft` থাকে এবং sitemap/public query-তে আসে না। CMS-এ তাদের `published` বা `scheduled` করতে হলে আলাদা editorial review checkbox দিয়ে gate স্পষ্টভাবে clear করতে হয়। Scheduled post প্রকাশ করতে hosting cron-এ `php scripts/publish-scheduled.php` চালাতে পারেন; gate-clear নয় এমন day 31–50 post cron-ও প্রকাশ করবে না।
- Domain brain-এ curated/brandable/long-partner শব্দ সক্রিয়/নিষ্ক্রিয়, human-review flag, category keyword এবং preferred term সম্পাদনা করা যায়। Review flag হলো সম্পাদকীয় নোট; এটি dictionary, availability বা trademark certification নয়। Review-only mode default-off।
- Generator browser-এ result তৈরি করে; API-ও server-side suggestion দেয়। কোনো route domain availability, registrar price, trademark, company name বা social handle যাচাই করে না।

## Ads, analytics ও privacy

- AdSense slot, global ads toggle, publisher/ad-unit ID, GA4, GTM এবং ads.txt default-এ blank/off। Admin থেকে কেবল প্রকৃত account-issued ID দিলে এবং toggle চালু করলে তবেই সংশ্লিষ্ট external script/rendering সক্রিয় হয়। Fake/test ID ব্যবহার করবেন না। CMS নিজের analytics-এ AdSense ad-click track করে না। Native Capacitor offline bundle এই PHP site's ad helper ব্যবহার করে না।
- First-party page-view/generator-run tracking off by default। চালু করলে event type ও path সংরক্ষিত হয়; root keyword রাখা হয় না। `ANALYTICS_SALT` সেট করা থাকলে approximate daily visitor digest লেখা হয়, raw IP নয়। Hosting provider-এর server logs আলাদা হতে পারে।
- Contact form submission database inbox-এ থাকে; default-এ automatic email পাঠানো হয় না। Admin inbox থেকে CSV export ও mail client দিয়ে manual reply করা যায়। PII retention period, privacy-policy controller/contact details, third-party consent ও local-law requirements deployment অনুযায়ী site owner-কে review/নির্ধারণ করতে হবে। এই template legal advice বা legal compliance guarantee নয়।
- Affiliate redirect click count AdSense ad-click থেকে আলাদা; destination URL admin-এ HTTPS হতে হয়।

## Backup, cache ও rollout

- MySQL database-এর নিয়মিত encrypted backup নিন; `uploads/`-এর logo/hero/featured images-ও backup করুন।
- Public wordbank, homepage/blog data ও sitemap file cache ব্যবহার করে; content/settings update করলে CMS cache invalidate করে। Cache folder web থেকে blocked।
- CMS code ও assets এই সাবডিরেক্টরির বাইরে লেখে না। Static fallback ও native app bundle আলাদা। Native app-এর offline copy CMS website update-এ স্বয়ংক্রিয়ভাবে বদলায় না; native app-এ update আনতে আলাদা build/release প্রয়োজন।
- Hostinger বা target environment-এ deploy করার পর PHP lint, `database.sql` import, admin login, form submit/export, post publish/draft gate, clean URL, sitemap, upload permission এবং valid configured ad slot পরীক্ষা করুন। এই development sandbox-এ PHP/MySQL runtime নেই; তাই live PHP lint ও database integration test এখানে চালানো সম্ভব হয়নি।
