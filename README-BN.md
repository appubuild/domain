# DomainFits — বাংলা সেটআপ ও প্রকাশ নির্দেশিকা

এই নথিতে থিম/PWA, জেনারেটর কন্ট্রোল, রেসপনসিভ অ্যাড, নেটিভ অ্যাপ এবং GitHub-এ কোড প্রকাশের ধাপ দেওয়া হয়েছে। এটি বর্তমান স্ট্যাটিক-সাইট আর্কিটেকচার বজায় রাখে—রানটাইমে কোনো UI framework, Tailwind CDN বা Font Awesome CDN প্রয়োজন নেই।

## ১. থিম কালার, মোবাইল ব্রাউজার ও PWA

থিম টগল করলে `assets/js/main.js`-এর `syncBrowserChrome()` ফাংশন `<meta name="theme-color">`-এর রং হালকা থিমে `#f7f8fc` এবং ডার্ক থিমে `#10121b` করে। Chrome-এ এটি ব্রাউজারের শীর্ষ UI এবং সমর্থিত ইনস্টলড PWA-র theme color-কে আপডেট করে। iOS-এর standalone status bar কাস্টম hex রং নেয় না; সেখানে সমর্থিত `default`/`black` style ব্যবহৃত হয়। Android Capacitor অ্যাপে native status/navigation bar আগের theme bridge দিয়ে একই থিমে sync হয়।

PWA-এর ফাইল:

- `manifest.webmanifest` — নাম, start URL, scope, display mode, প্রাথমিক theme/background color ও icon।
- `assets/img/pwa-192.png`, `assets/img/pwa-512.png` — ইনস্টল আইকন।
- `service-worker.js` — একই origin-এর পেজ/স্ট্যাটিক ফাইল network-first পদ্ধতিতে ক্যাশ করে; তৃতীয়-পক্ষের বিজ্ঞাপন/অ্যানালিটিক্স অনুরোধ intercept করে না।
- `offline.html` — আগে ক্যাশ না হওয়া পেজে অফলাইন fallback।
- `assets/js/pwa.js` — HTTPS (বা localhost) ওয়েব ব্রাউজারে service worker নিবন্ধন করে; Capacitor native app-এ নিবন্ধন এড়িয়ে যায়।

Service worker পরিবর্তন করে cache key আপডেট করলে `service-worker.js`-এর `CACHE_NAME`-এর version বাড়ান। Production-এ root domain deployment এবং HTTPS ব্যবহার করুন; এই স্ট্যাটিক সাইটের URL-গুলো root-relative।

## ২. জেনারেটর সেটিংস: Drawer অথবা Accordion

একটি কেন্দ্রীয় কনফিগ থেকে মোড বেছে নিন:

```js
// assets/js/site-config.js
window.DOMAINFITS_SITE_CONFIG = Object.freeze({
  generatorControlsMode: 'drawer' // 'drawer' অথবা 'accordion'
});
```

- `drawer` (বর্তমান ডিফল্ট): নিচের বাম পাশের Settings FAB থেকে সেটিংস Drawer/Bottom Sheet খোলে। Drawer-এর ভেতরে রুট keyword, niche, result count, extension, Curated/Brandable toggle, partner-length filter, placement এবং capitalization সেট করা যায়। **Generate ideas** চাপলে Drawer বন্ধ হয় এবং ফলাফল অংশে স্ক্রল করে।
- `accordion`: সেটিংস প্যানেল পেজের ওপরের দিকে থাকে; “Generation settings” বোতামে ট্যাপ করে মসৃণভাবে খুলুন/বন্ধ করুন।

মোড বদলাতে শুধু `assets/js/site-config.js`-এর মান বদলে সাইট পুনরায় deploy করুন। Generator-এর বর্তমান word list, filters এবং Brandable Mode-এর default-off আচরণ অপরিবর্তিত থাকে।

## ৩. Export UI

`tools/domain-generator.html`-এ desktop toolbar আইকন দিয়ে Copy All, TXT ও CSV export দেয়। Mobile-এ ডান পাশের Export FAB থেকে একই তিনটি অপশনের mini speed-dial খোলে। Copy All-এর badge-এ বর্তমান batch-এ তৈরি সব domain-এর সংখ্যা দেখায়—সার্চ ফিল্টার করা দৃশ্যমান ফলের সংখ্যা নয়। আইকনগুলো inline SVG; কোনো icon CDN ব্যবহার করা হয়নি।

## ৪. Platform detection ও native অ্যাপে AdSense বন্ধ রাখা

`assets/js/platform.js`-এর `window.DomainFitsPlatform.detect()` তিনটি অবস্থা জানায়: `capacitor-native`, `mobile-web` এবং `desktop-web`। Native অবস্থায় `assets/js/ad-manager.js` সব ad slot খালি/লুকানো রাখে এবং AdSense loader যোগ করে না। অতিরিক্ত সুরক্ষায় `npm run build` / `npm run cap:sync` চলার সময় `tools/build-app.mjs` অ্যাপের `www/assets/js/ads-config.js`-কে একটি খালি `enabled: false` কনফিগ এবং `www/assets/js/ad-manager.js`-কে native-safe no-op দিয়ে প্রতিস্থাপন করে; ফলে Android bundle-এ publisher ID, slot markup বা AdSense loader code ঢোকে না।

Mobile বা desktop browser-এ বিজ্ঞাপন স্বয়ংক্রিয়ভাবে চালু হবে **শুধু তখনই**, যখন কেন্দ্রীয় config-এ বৈধ AdSense publisher ID এবং অন্তত একটি আসল slot markup দেওয়া আছে। এই রিপোজিটরিতে কোনো publisher ID, ad-unit ID, CMP বা approval দাবি/নিশ্চয়তা দেওয়া হয়নি। EEA/UK/Switzerland-এ প্রযোজ্য consent/CMP, privacy disclosure এবং AdSense-এর বর্তমান নির্দেশনা production-এ নিজ দায়িত্বে যাচাই করুন।

## ৫. কেন্দ্রীয় Ad Slot সেটআপ — ধাপে ধাপে

সব বিজ্ঞাপন এক জায়গায় কনফিগার করুন: **`assets/js/ads-config.js`**। ফাইলটি খালি publisher ID ও খালি slot দিয়ে আসে; তাই কোনো বিজ্ঞাপন অনুরোধ হয় না। আসল, অনুমোদিত AdSense অ্যাকাউন্ট এবং সাইটের privacy/consent ব্যবস্থা প্রস্তুত না হওয়া পর্যন্ত এটি খালি রাখুন।

1. AdSense অ্যাকাউন্ট থেকে আপনার প্রকৃত `ca-pub-...` publisher ID নিন এবং `publisherId`-এ বসান। Placeholder বা অন্য কারও ID ব্যবহার করবেন না।
2. AdSense থেকে তিনটি responsive ad unit/slot তৈরি বা বেছে নিন। প্রত্যেক slot-এর কপি করা কোড থেকে শুধু `<ins class="adsbygoogle" ...></ins>` markup নিন—`<script>` loader বা `adsbygoogle.push()` snippet কপি করবেন না। সেন্ট্রাল manager loader একবার যোগ করে প্রতিটি সক্রিয় slot একবার initialize করে।
3. `enabled: true` রাখুন, তারপর সংশ্লিষ্ট `code` field-এ slot-এর markup পেস্ট করুন:
   - `header-banner` — সব পেজে সাইট navigation/header-এর পরে responsive banner।
   - `generator-inline` — Generator-এর ফলাফলের grid-এর পরে।
   - `article-inline` — Blog article-এর প্রথম পূর্ণ section-এর পরে, নিবন্ধের ভেতরে।
4. Markup-এ AdSense থেকে পাওয়া সঠিক `data-ad-client`, `data-ad-slot`, `data-ad-format="auto"` এবং `data-full-width-responsive="true"` মান দিন। `<ins>`-এর markup নিজেই central config-এ থাকবে; আলাদা পেজে code বসাবেন না।
5. `ads.txt`-এ আপনার অ্যাকাউন্টের সঠিক তথ্য AdSense-এর নির্দেশনা অনুযায়ী দিন। Consent/CMP এবং Privacy Policy-ও বাস্তব setup-এর সঙ্গে মিলিয়ে নিন।
6. `npm test` চালিয়ে স্থির সাইট ও Android bundle যাচাই করুন। তারপর staging/production web browser-এ ad request ও responsive layout পরীক্ষা করুন। Android/Capacitor app-এ AdSense request হওয়া উচিত নয়।

Slot markup উদাহরণ নয়—নিচের জায়গাগুলো ইচ্ছাকৃতভাবে ফাঁকা; AdSense UI-তে পাওয়া **আপনার আসল কোড/ID** বসাতে হবে:

```js
window.DOMAINFITS_AD_CONFIG = Object.freeze({
  enabled: true,
  publisherId: '', // AdSense থেকে পাওয়া ca-pub-... ID
  slots: Object.freeze({
    'header-banner': Object.freeze({ code: '' }),
    'generator-inline': Object.freeze({ code: '' }),
    'article-inline': Object.freeze({ code: '' })
  })
});
```

### Slot placement ও UX সতর্কতা

- Header banner navigation-এর নিচে, মূল action button থেকে আলাদা রাখা হয়েছে।
- Generator ad সম্পূর্ণ ফলাফলের পরে; settings FAB, Generate, Copy বা Download button-এর পাশে/উপরে নয়।
- Article ad প্রথম section-এর পর, paragraph-এর ভেতরে নয়। Article page-এ publication gate না খুললে ad manager অপেক্ষা করে; unpublished draft-এ বিজ্ঞাপন চালায় না।
- কোনো ad-কে navigation/control-এর মতো দেখাবেন না, click করতে উৎসাহ দেবেন না এবং ad-click-এর জন্য ব্যবহারকারীকে পুরস্কৃত করবেন না। Responsive layout বা slot placement কোনো নির্দিষ্ট click-through, conversion, আয়, approval বা policy ফল নিশ্চিত করে না।

## ৬. Google Search Console verification meta tag

1. Google Search Console-এ production property যোগ করে **HTML tag** verification পদ্ধতি বেছে নিন।
2. Search Console যে `<meta name="google-site-verification" content="...">` tag দেয়, সেটি **অক্ষরে অক্ষরে** কপি করুন—content value নিজে বানাবেন না।
3. `index.html` ফাইলের `<head>`-এর ভেতরে `Google Search Console verification` মন্তব্যের জায়গায় tag-টি বসান; `</head>`-এর পরে নয়। এটাই সাইটের home page-এর verification tag।
4. `index.html` deploy করে production homepage-এ view-source-এ tag দেখা যায় কি না পরীক্ষা করুন, তারপর Search Console-এ verify করুন। DNS verification বেছে নিলে Search Console-এ দেওয়া TXT record-টিই আপনার DNS provider-এ যোগ করুন।

`https://example.com` canonical/OG URL-গুলো production-এ বদলাতে হবে—verification tag বসালেই ওই placeholder URL-গুলো বদলায় না।

## ৭. লোকালি পরীক্ষা ও Android sync

Node.js 22+ এবং Python 3 প্রয়োজন।

```sh
npm install
npm test
npm run cap:sync
```

`npm test` local `www/` Android bundle তৈরি করে, UI/generator/ads/PWA ও blog checks চালায় এবং native bundle-এ AdSense disabled আছে কি না যাচাই করে। Android Studio/SDK/Java যথাযথভাবে ইনস্টল থাকলে এরপর Android Studio থেকে app build করুন। Web PWA পরীক্ষা করতে HTTPS staging ব্যবহার করুন, অথবা local dev-এ:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

`www/` build output Git-এ যোগ করবেন না; এটি `.gitignore`-এ আছে।

## ৮. GitHub-এ বর্তমান Arena branch-এ push

পরিবর্তন যাচাই করে শুধু বর্তমান branch `arena/8f9add47-domain`-এ commit ও push করুন:

```sh
git status
git add -A
git diff --cached --check
git commit -m "Add responsive PWA, generator controls, and ad management"
git push origin arena/8f9add47-domain
```

`git add` করার আগে `git status`/`git diff` দেখে নিন; generated `www/`, `node_modules/`, APK/AAB বা স্থানীয় credentials commit করবেন না।
