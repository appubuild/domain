# DomainFits Dynamic CMS — সেটিংস সেভ ফিক্স ও Plugin/Extension System

এই নথি শুধু `domain_fit_dynamic/` PHP application-এর জন্য। Root-এর static HTML/CSS/JS, Capacitor offline bundle বা native build-এ কোনো পরিবর্তন করা হয়নি।

## ১) Site Settings auto-blanking: audit ও fix

### কোড অডিটে যা নিশ্চিত হয়েছে

`admin/settings.php`-এ form `POST` এবং `multipart/form-data` ব্যবহার করে; screenshot-এর field name-গুলো controller-এর key-এর সঙ্গে মেলে:

| UI field | POST name | `site_settings.setting_key` |
| --- | --- | --- |
| Hero heading | `hero_title` | `hero_title` |
| Hero description | `hero_subtitle` | `hero_subtitle` |
| Primary button label | `hero_cta` | `hero_cta` |
| Secondary link label | `hero_secondary` | `hero_secondary` |
| Footer description | `footer_text` | `footer_text` |
| Copyright line | `copyright_text` | `copyright_text` |

এই settings আলাদা relational columns নয়; `site_settings` table-এর `setting_key` + JSON `value_json` row-এ রাখা হয়। `save_setting()`-এর PDO prepared `INSERT ... ON DUPLICATE KEY UPDATE` এই keys-ও লিখতে পারে। `database.sql`-এ JSON column এবং homepage defaults আছে। ফলে এই source tree-তে field-name mismatch, missing SQL column বা dynamic-column mapping omission পাওয়া যায়নি।

### blank হয়ে যাওয়ার code-level failure path

Save transaction-এ upload/validation/DB ত্রুটি হলে controller error দেখাত, কিন্তু form পুনরায় render করার সময় database-এর আগের মান পড়ত। আগে database-এ মান blank থাকলে, submitted text থাকা সত্ত্বেও error page-এ আবার blank দেখা যেত—এতে ব্যর্থ save-কে “auto-blanking” মনে হতে পারত। Production DB/log/runtime-এ access না থাকায় screenshot একা থেকে নির্দিষ্ট live MySQL/hosting failure প্রমাণ করা সম্ভব নয়।

### করা hardening

- Form action এখন পরিষ্কার canonical route `/admin/site-settings`-এ; POST, multipart ও `name` mapping অপরিবর্তিত/স্পষ্ট।
- Server payload-এ প্রত্যাশিত field না এলে কোনো setting overwrite হয় না; `post_max_size`-এর কারণে সম্পূর্ণ body না এলে আলাদা error দেখায়।
- Validation, upload বা DB save error-এর পর submitted text fields form-এ রাখা হয়; stale DB data দিয়ে ঢেকে ফেলা হয় না।
- Commit-এর আগে লেখা JSON rows-কে PDO দিয়ে পুনরায় পড়ে submitted value-র সঙ্গে মিলিয়ে দেখা হয়; mismatch হলে transaction rollback হয়।
- Public setting in-memory cache `save_setting()`-এর পর invalidate হয়, যাতে একই request-এ পুরোনো মান না আসে।
- PDO error private `storage/logs/php-error.log`-এ লেখা হয়; log HTTP access থেকে block করা।

### Live hosting-এ নিশ্চিত করার তালিকা

1. Save করার পর লাল notice থাকলে তার অর্থ দেখে `storage/logs/php-error.log` File Manager/hosting private log viewer দিয়ে পরীক্ষা করুন; log browser-এ খুলবেন না।
2. Hosting PHP settings-এ `post_max_size` যেন `upload_max_filesize`-এর চেয়ে বড় হয়; 5 MB CMS image upload-এর জন্য উপযুক্ত margin রাখুন।
3. phpMyAdmin-এ `site_settings` table-এ `hero_title`, `hero_subtitle`, `hero_cta`, ইত্যাদি key-এর `value_json` row আছে কি না দেখুন। JSON string হিসেবে value উদ্ধৃতিচিহ্নসহ থাকতে পারে।
4. Hosting database user-এ `site_settings`-এর `SELECT`, `INSERT`, `UPDATE` অনুমতি এবং MySQL/MariaDB JSON support যাচাই করুন।
5. নতুন code deploy করার পর session/CSRF token ঠিক আছে কি না নিশ্চিত করতে login করে settings page refresh করুন; তারপর text-only save দিয়ে পরীক্ষা করুন।

## ২) Core plugin architecture

### Directory ও lifecycle

- Installed PHP code: `domain_fit_dynamic/storage/extensions/<slug>/` — app-এর private storage; parent ও extension directory HTTP থেকে denied।
- Registry/options: `cms_extensions` table; status `inactive|active`, per-extension `options_json`, installer/version metadata।
- Package manifest: `plugin.json`; entry PHP file-এর path manifest-এ থাকে। Loader status, slug, API version, manifest path ও real filesystem path পরীক্ষা করে, normal request-এ শুধু সক্রিয় extension include হয়। Inactive extension code explicit Super Admin uninstall action-এ cleanup hook-এর জন্য সাময়িক include হতে পারে।
- Admin: `/admin/extensions`; ZIP upload, validate/install, activate, deactivate, settings route, maintenance action এবং uninstall। Upload/maintenance/settings actions CSRF-protected এবং existing `manage_settings` permission-এ সীমাবদ্ধ (বর্তমান seed roles-এ এটি Super Administrator-কে দেওয়া)।
- Runtime DB account-কে নতুন table বানানোর permission দিতে হয় না। Fresh install-এ `database.sql` table তৈরি করে; existing install-এ একবার phpMyAdmin migration দরকার।

### Hook API

সব API `includes/hooks.php`-এ request-scoped এবং `df_` prefix-সহ:

```php
// Action: callback return value উপেক্ষা হয়; errors log করে পরের hook চলতে থাকে.
df_add_action('public.head', 'my_plugin_head', 20, 2);

// Filter: প্রথম argument value; callback-এর return পরের filter পায়.
df_add_filter('response.html', 'my_plugin_html', 20, 2);
```

Core hook points: `database.connected`, `request.extensions_loaded`, `public.head`, `public.body.start`, `public.footer`, `response.html`, `asset.url`, `image.uploaded`, `admin.navigation_links`, `cache.clearing`, `extension.loaded`, `extension.activated`, `extension.deactivating`, `extension.deactivated`, `extension.uninstalling`, `extension.uninstalled`, `extension.serve_asset`, এবং `admin.extension.settings.<slug>` / `.save.<slug>` / `.task.<slug>`। Admin save/lifecycle actions strict mode-এ চালানো হয়, যাতে validation failure-কে success বলা না হয়।

Plugin setting helpers: `df_extension_options(PDO $pdo, string $slug)` ও `df_extension_save_options(PDO $pdo, string $slug, array $options)`। Output buffer দরকার হলে `df_start_response_buffer()` শুরু করুন; তারপর HTML `response.html` filter দিয়ে যায়। Default-এ core নিজে সব page buffer করে না।

### ZIP নিরাপত্তা ও সীমা

- একটিমাত্র top-level lowercase slug folder: `<slug>/plugin.json`, manifest-এ নির্দিষ্ট PHP entry file।
- ZIP 20 MB; সর্বোচ্চ 2,500 entries/2,000 files; প্রতি ফাইল 10 MB; মোট expanded data 60 MB।
- `extractTo()` ব্যবহার করা হয় না; path traversal, absolute path, backslash/drive path, duplicate path, Unix symlink এবং plugin-ভিতরের `.htaccess`/`.user.ini`/`php.ini`/`.env`/`web.config` reject করে। Private staging directory-তে প্রতিটি file hand-write করে manifest validate হওয়ার পর atomic rename ও registry-row transaction হয়; insert ব্যর্থ হলে staged/final plugin folder পরিষ্কার করার চেষ্টা করে।
- নতুন package একই slug-এর installed folder overwrite করে না। Upgrade করতে deactivate → uninstall → নতুন ZIP install করতে হবে।
- **গুরুত্বপূর্ণ:** private directory HTTP download থেকে রক্ষা করে, কিন্তু PHP extension runtime sandbox নয়। সক্রিয় PHP code CMS process-এর permissions পায়। কেবল বিশ্বস্ত ZIP দিন; plugin permission শুধু Super Administrator-দের দিন; আগে backup/staging-এ পরীক্ষা করুন। Apache/LiteSpeed-এ `.htaccess` প্রযোজ্য; Nginx-এ একই deny rules hosting configuration-এ যোগ করতে হবে। Browser দিয়ে `/domain_fit_dynamic/storage/`, `/domain_fit_dynamic/plugin-starters/` ও `/domain_fit_dynamic/migrations/` সরাসরি খুলে 403/404 নিশ্চিত না করে plugin install করবেন না.

### Existing database migration (phpMyAdmin; Terminal লাগে না)

Existing CMS database-এ শুধু একবার:

1. Hosting File Manager/Git deployment-এ `domain_fit_dynamic/migrations/20261030_extensions.sql` file রাখুন।
2. phpMyAdmin-এ CMS database নির্বাচন করে **Import** → ওই SQL file নির্বাচন → **Go** চাপুন। এটি শুধু `cms_extensions` registry table তৈরি করে; content/site settings পরিবর্তন করে না।
3. Admin → Extensions / Plugins reload করুন। Fresh `database.sql` import-এ migration পুনরায় দরকার নেই।

## ৩) Starter Optimizer extension

Source: `plugin-starters/speed-optimizer/`; ready-to-upload ZIP: `plugin-starters/speed-optimizer-1.0.0.zip`। Admin Extensions-এ ZIP upload করুন, তারপর আলাদাভাবে activate করে **Speed Optimizer** settings খুলুন। সব option default-এ OFF।

| Feature | বাস্তবায়ন ও guardrail |
| --- | --- |
| HTML minify | Optional conservative pass; script/style/pre/textarea/code/SVG preserve করে। |
| CSS/JS minify | Inline CSS/JS পৃথক toggle; local external `assets/css/` ও `assets/js/` versioned optimizer endpoint দিয়ে serve হয়। Remote vendor scripts (AdSense/GA4/GTM) rewrite হয় না। JS minifier conservative; template-literal বা ambiguous slash/division থাকা script byte-for-byte untouched থাকে; staging/browser interaction test আবশ্যক। |
| Lazy loading | `loading` না থাকা image-এ lazy; explicit eager/brand logo preserve। Local image-এ decoding hint optional। |
| Image dimension fitting | Local readable `uploads/`/`assets/img/` থেকে missing width/height যোগ করে CLS কমাতে সাহায্য করে। |
| WebP + fallback | GD `imagewebp()` থাকলে নতুন JPEG/PNG upload-এ WebP sibling তৈরি; original `src` রাখা হয়, valid WebP-কে `srcset` candidate করা হয়। Existing upload প্রতি batch-এ সর্বোচ্চ ১০টি; original কখনো মুছে না। |
| LCP | Site Settings-এ local hero image থাকলেই homepage-এ optional image preload/high priority hint। H1 LCP হলে এটি সেই text render delay নিজে থেকে ঠিক করে না। |
| Script/font | Local JS-এ অনুপস্থিত defer যোগ করা যায়; আলাদা option local ও inline CSS `@font-face`-এ `font-display:swap` যোগ করে। Remote code অপরিবর্তিত। |
| Compression | zlib `ob_gzhandler`/`gzencode` দিয়ে negotiated Gzip optional। Hosting আগে Gzip/Brotli দিলে PHP toggle বন্ধ রাখুন। |
| Cache | `storage/cache/speed-optimizer/`-এ file-based page cache; শুধু cookie/query-বিহীন anonymous GET homepage/blog/articles/public info pages। Admin/API/contact/form/query/cookie request excluded; CMS `cache_clear_all()` এটিকে purge করে। Asset endpoint versioned এবং 1-year immutable। |

Core dynamic extension architecture-এর জন্য PHP 8.1+ দরকার। Runtime support hostভেদে আলাদা: ZIP installer-এ PHP `ZipArchive`, image convert-এ GD + WebP, Gzip-এ zlib লাগে। Sandbox-এ PHP interpreter/MySQL/GD/ZipArchive ছিল না—তাই PHP runtime, image conversion, live DB write বা browser/Lighthouse runtime যাচাই করা যায়নি। Deploy-এর আগে hosting PHP Selector/Extensions panel ও staging site-এ পরীক্ষা করুন।
