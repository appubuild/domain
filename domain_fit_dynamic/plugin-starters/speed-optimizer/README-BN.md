# Speed & Performance Optimizer — ZIP starter

এটি DomainFits Dynamic CMS-এর internal PHP extension starter; browser extension নয়। `plugin.json` ও `plugin.php` এই package-এর manifest/entry point। Admin → Extensions / Plugins-এ ZIP upload করে install, তারপর আলাদাভাবে activate করুন।

## প্রস্তাবিত চালুর ক্রম

1. Hosting-এর backup নিন এবং staging copy-তে ZIP install করুন।
2. Admin → Extensions → Speed Optimizer খুলুন। প্রথমে সব option বন্ধ রাখুন।
3. একবারে একটি toggle চালু করুন, save করুন, homepage/blog/admin forms এবং Lighthouse mobile পরীক্ষা করুন।
4. WebP ব্যবহারের আগে PHP GD-এর `imagewebp()` capability নিশ্চিত করুন। বিদ্যমান upload রূপান্তর করলে প্রতিবার সর্বোচ্চ ১০টি ফাইল process হয়; মূল JPEG/PNG মুছে ফেলা হয় না।
5. Gzip toggle কেবল PHP zlib দিয়ে negotiation করতে পারে—Hostinger/LiteSpeed/CDN আগে থেকেই Brotli/Gzip দিলে toggle বন্ধ রাখুন এবং double-compression পরীক্ষা করুন।
6. Page cache শুধু cookie/query-বিহীন public GET pages-এর জন্য; admin, API, contact/form pages, query pages এবং cookie-সহ request cache হয় না। TTL ও CMS cache-clear hook কার্যকর থাকে।

## Optimizer controls

- HTML minification: script/style/pre/textarea/code/SVG blocks-ийг preserve করে; tag-এর মাঝখানে একটিমাত্র whitespace রাখে।
- Inline CSS/JS এবং local external `assets/css/`, `assets/js/`-এর conservative minification পৃথক toggle-এ। আলাদা font option স্থানীয় ও inline `@font-face`-এ `font-display:swap` যোগ করে। JS template-literal বা ambiguous slash/division-সহ external file অক্ষত রাখা হয়; minification তবু staging-এ যাচাই করুন। Remote vendor scripts (AdSense/GA4/GTM) rewrite হয় না।
- Lazy loading: `loading` attribute অনুপস্থিত image-এ lazy; explicit `loading="eager"` অপরিবর্তিত। `uploads/brand` logo/hero lazy করা হয় না।
- Image dimensions: readable local uploads/assets image থেকে missing `width`/`height` যোগ করে।
- WebP: নতুন JPEG/PNG upload-এর sibling `.webp` তৈরি করে; original `src` fallback থাকে, valid WebP থাকলে HTML-এ `srcset` candidate যোগ হয়। Conversion GD+WebP support ছাড়া কাজ করবে না; বড় image memory limit-এ skip হতে পারে।
- LCP: Site Settings-এ local hero image থাকলে homepage `<head>`-এ preload link যোগ করে।
- Local JS defer: কেবল local `assets/js/` script-এ, যদি আগে `async`, `defer` বা `type="module"` না থাকে।
- File page cache: storage-এর private directory-তে bounded anonymous HTML cache; user cookies, form/CSRF, admin/API বা query page cache করে না। Host-level cache rules-এর purge/TTL আলাদা হতে পারে।

## Runtime requirements / safe limitations

- ZIP installer: PHP `ZipArchive`; WebP: GD `imagewebp`; Gzip: PHP zlib/`ob_gzhandler` বা `gzencode`। এগুলো hosting configuration অনুযায়ী বদলায়।
- PHP extension isolated filesystem directory-তে থাকে, কিন্তু **PHP process থেকে sandbox করা নয়**। Extension code পুরো app-এর permission পায়। কেবল trusted ZIP ইনস্টল করুন।
- Runtime plugin update overwrite সমর্থিত নয়: আগে deactivate → uninstall → নতুন ZIP install করুন। Uninstall saved extension settings এবং plugin files মুছে দেয়; plugin নিজের তৈরি অতিরিক্ত user data থাকলে আগে backup নিন।
- এই optimizer browser extension নয় এবং live Lighthouse score/CWV/hosting capability-এর নিশ্চয়তা দেয় না। Lighthouse-এ প্রতিটি toggle-এর ফল independently যাচাই করুন।
