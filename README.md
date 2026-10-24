# VigoChat.com — Premium Domain Acquisition & Interactive AI Chat Showcase

A production-ready, dual-purpose domain showcase and SaaS landing page built for **`vigochat.com`**.

1. **Interactive AI & Messaging Product Showcase**: Demonstrates the domain's real-world category power with a live multi-persona AI chat simulator, latency/sentiment telemetry, voice pronunciation test, and a 4-industry interactive switcher (*AI Support, Web3 Community, Enterprise Team Chat, Telehealth*).
2. **High-Converting Domain Acquisition Funnel**: Features a centralized configuration file (`src/config.ts`), 3 flexible deal structures (*Buy Outright, Interactive Lease-to-Own Calculator, Custom Offer*), verified marketplace integrations (*Escrow.com, Dan.com, Atom, GoDaddy, Afternic, Sedo*), and an asynchronous **Lead Capture Webhook Modal** with instant WhatsApp and Email fallbacks.

---

## 🇧🇩 বাংলা গাইড: কিভাবে আপনার Real Data এবং Lead Capture (Google Sheets) সেটআপ করবেন

এই প্রজেক্টের সব তথ্য **একটি মাত্র ফাইলে (`src/config.ts`)** রাখা হয়েছে। আপনাকে কোডের ভেতরে অন্য কোনো ফাইল পরিবর্তন করতে হবে না।

### ১. আপনার নিজের তথ্য (Real Data) কোথায় এবং কিভাবে বসাবেন?

প্রজেক্টের `src/config.ts` ফাইলটি ওপেন করুন। সেখানে নিচের অংশগুলো আপনার নিজের তথ্য দিয়ে পরিবর্তন করুন:

#### ক) ডোমেইনের নাম ও উচ্চারণ (`Core Domain Metadata`)
```ts
domainName: 'vigochat.com',
displayDomain: 'VigoChat.com',
brandPrefix: 'VigoChat',
tld: '.com',
```

#### খ) ডোমেইনের দাম ও কিস্তির হিসাব (`pricing`)
```ts
pricing: {
  binPrice: 24800,              // আপনার Buy-It-Now (এককালীন) মূল্য (USD)
  minOffer: 9500,               // সর্বনিম্ন অফার মূল্য (USD)
  defaultInvestorOffer: 18500,  // ডিফল্ট কাস্টম অফার (USD)
  currency: 'USD',
  defaultLeaseMonths: 24,       // ডিফল্ট কিস্তির মেয়াদ (মাস)
  leaseTermOptions: [6, 12, 18, 24] as const,
}
```
> **নোট:** আপনি `binPrice` পরিবর্তন করলে পুরো ওয়েবসাইটের সব বাটন, ক্যালকুলেটর এবং মডালের মাসিক কিস্তির হিসাব স্বয়ংক্রিয়ভাবে আপডেট হয়ে যাবে!

#### গ) আপনার আসল WhatsApp নম্বর (`whatsapp`)
```ts
whatsapp: {
  phoneNumber: '+8801700000000', // আপনার আসল WhatsApp নম্বর (দেশের কোডসহ, যেমন +880 বা +1)
  defaultMessageTemplate: 'Hello, I am interested in acquiring vigochat.com.',
},
```

#### ঘ) আপনার আসল ইমেইল অ্যাড্রেস (`email`)
```ts
email: {
  recipientEmail: 'yourname@yourdomain.com', // যে ইমেইলে আপনি বায়ারের মেইল পেতে চান
  defaultSubject: 'Acquisition Inquiry: vigochat.com',
  offerSubjectPrefix: 'Acquisition Inquiry: vigochat.com',
  defaultMessageBody: 'Hello, I am interested in acquiring vigochat.com...',
},
```

#### ঙ) আপনার মার্কেটপ্লেস লিংকসমূহ (`marketplaces`)
`src/config.ts`-এর `marketplaces` অংশে আপনার আসল **Dan.com, Atom, Sedo, Afternic, GoDaddy** অথবা **Escrow.com**-এর লিস্টিং লিংক বসিয়ে দিন:
```ts
dan: {
  // ...
  url: 'https://dan.com/buy-domain/vigochat.com', // আপনার আসল লিস্টিং লিংক
},
```

---

### ২. কিভাবে ফ্রি Google Sheets Lead Capture Integration করবেন? (ধাপে ধাপে)

যখন কোনো ক্রেতা (Buyer) ওয়েবসাইটের **"Make an Offer / Acquire Domain"** ফর্মে নাম, ইমেইল এবং অফার অ্যামাউন্ট দিয়ে সাবমিট করবেন, তখন সেটি সরাসরি আপনার **Google Sheet**-এ সেভ হবে এবং চাইলে আপনার ইমেইলেও সাথে সাথে নোটিফিকেশন যাবে।

#### ধাপ ১: নতুন Google Sheet তৈরি করুন
১. ব্রাউজারে [https://sheets.new](https://sheets.new) লিংকে গিয়ে একটি নতুন Google Sheet খুলুন।
২. নিচের প্রথম ট্যাবটির (Sheet1) নাম রিনেম করে **`Leads`** দিন।
৩. প্রথম সারিতে (**Row 1: A1 থেকে I1 পর্যন্ত**) নিচের ৯টি কলামের নাম লিখুন:
   - `A1`: **Timestamp**
   - `B1`: **Reference ID**
   - `C1`: **Domain Name**
   - `D1`: **Full Name**
   - `E1`: **Email**
   - `F1`: **Offer Amount (USD)**
   - `G1`: **Deal Type**
   - `H1`: **Marketplace**
   - `I1`: **Message**

#### ধাপ ২: Google Apps Script যুক্ত করুন
১. আপনার Google Sheet-এর উপরের মেনু থেকে **Extensions → Apps Script**-এ ক্লিক করুন।
২. সেখানে থাকা ডিফল্ট কোডটুকু মুছে নিচের সম্পূর্ণ কোডটি পেস্ট করুন:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads')
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // ১. গুগল শিটে নতুন রো (Row) হিসেবে বায়ারের তথ্য যোগ করা
    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.referenceId || '',
      data.domainName || 'vigochat.com',
      data.fullName || '',
      data.email || '',
      data.offerAmount || '',
      data.dealType || '',
      data.preferredMarketplace || '',
      data.message || ''
    ]);

    // ২. (ঐচ্ছিক) সাথে সাথে আপনার ইমেইলে নোটিফিকেশন পেতে নিচের কোডের কমেন্ট (/* */) তুলে আপনার ইমেইল দিন:
    /*
    MailApp.sendEmail({
      to: "your-email@gmail.com",
      subject: "New Domain Offer for " + data.domainName + ": $" + data.offerAmount,
      body: "Buyer Name: " + data.fullName + "\nBuyer Email: " + data.email + "\nOffer Amount: $" + data.offerAmount + "\nDeal Type: " + data.dealType + "\nPreferred Marketplace: " + data.preferredMarketplace + "\nMessage: " + data.message
    });
    */

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", received: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```
৩. `Ctrl + S` চেপে প্রজেক্টটি **Save** করুন।

#### ধাপ ৩: Web App হিসেবে Deploy করুন
১. Apps Script পেজের ডানপাশে উপরে **Deploy → New deployment** বাটনে ক্লিক করুন।
২. বামপাশে **Select type** (গিয়ার আইকন)-এ ক্লিক করে **Web app** সিলেক্ট করুন।
৩. নিচের মতো সেটিংস দিন:
   - **Description**: `VigoChat Lead Capture Webhook`
   - **Execute as**: `Me`
   - **Who has access**: **`Anyone`** *(এটি অবশ্যই Anyone দিতে হবে, না হলে ওয়েবসাইট থেকে ডাটা ঢুকবে না)*
৪. **Deploy** বাটনে ক্লিক করুন।
৫. প্রথমবার **Authorize access** চাইলে আপনার Google Account সিলেক্ট করে **Advanced → Go to Untitled project (unsafe) → Allow** ক্লিক করে পারমিশন দিন।
৬. এরপর আপনি একটি **Web app URL** পাবেন (দেখতে এমন: `https://script.google.com/macros/s/AKfycb.../exec`)। সেটি **Copy** করুন।

#### ধাপ ৪: Web App URL-টি `src/config.ts`-এ বসিয়ে দিন
`src/config.ts` ফাইলের `formSubmission` অংশে আপনার কপি করা লিংকটি পেস্ট করে দিন:
```ts
formSubmission: {
  webhookUrl: 'https://script.google.com/macros/s/আপনার_আসল_লিঙ্ক_এখানে_বসান/exec',
  requestTimeoutMs: 9000,
  allowDemoRelayFallback: false, // আসল লিংক বসানোর পর এটি false করে দিতে পারেন
},
```
ব্যস! এখন যে কেউ আপনার সাইটে অফার সাবমিট করলেই তাৎক্ষণিকভাবে আপনার Google Sheet-এ চলে আসবে।

---

## 🛠️ Tech Stack & Local Development

- **Framework**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS (`darkMode: 'class'` with full Light & Dark mode support)
- **Animations & Icons**: Framer Motion + Lucide React

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build production bundle
npm run build
```
