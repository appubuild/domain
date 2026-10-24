import { MarketplaceConfigItem, MarketplaceId } from './types/domain';

/**
 * ============================================================================
 * CENTRALIZED DOMAIN & LEAD CAPTURE CONFIGURATION (`src/config.ts`)
 * ============================================================================
 * Edit this single file to update the domain name, pricing, WhatsApp number,
 * recipient email, marketplace checkout URLs, and the Google Sheets / Webhook
 * endpoint across the entire VigoChat.com application.
 *
 * ----------------------------------------------------------------------------
 * 1-CLICK GOOGLE SHEETS WEBHOOK SETUP INSTRUCTIONS (বাংলা ও English গাইড):
 * ----------------------------------------------------------------------------
 * ধাপ ১: একটি নতুন Google Sheet খুলুন (https://sheets.new) এবং প্রথম ট্যাবের নাম দিন "Leads"।
 * ধাপ ২: প্রথম সারিতে (Row 1: A1 থেকে I1) এই হেডারগুলো লিখুন:
 *    Timestamp | Reference ID | Domain Name | Full Name | Email | Offer Amount (USD) | Deal Type | Marketplace | Message
 * ধাপ ৩: উপরের মেনু থেকে "Extensions" -> "Apps Script"-এ ক্লিক করুন।
 * ধাপ ৪: সেখানে থাকা কোড মুছে নিচের `GOOGLE_APPS_SCRIPT_SNIPPET` কোডটি পেস্ট করে Save (Ctrl+S) করুন।
 * ধাপ ৫: ডানপাশে উপরে "Deploy" -> "New deployment"-এ ক্লিক করুন:
 *    - Select type (গিয়ার আইকন): "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (অবশ্যই Anyone সিলেক্ট করবেন)
 * ধাপ ৬: "Deploy" বাটনে ক্লিক করে Permission Allow করুন এবং যে "Web app URL" (`https://script.google.com/macros/s/.../exec`) পাবেন সেটি কপি করে নিচের `SITE_CONFIG.formSubmission.webhookUrl`-এ বসিয়ে দিন!
 * ============================================================================
 */

export const GOOGLE_APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads')
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // 1. Save Lead Row to Google Sheet
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

    // 2. Optional: Send Instant Email Notification to Domain Owner
    // Uncomment the 5 lines below and put your Gmail to receive instant email alerts:
    /*
    MailApp.sendEmail({
      to: "acquisitions@vigochat.com",
      subject: "New Domain Offer for " + data.domainName + ": $" + data.offerAmount,
      body: "Name: " + data.fullName + "\\nEmail: " + data.email + "\\nOffer: $" + data.offerAmount + "\\nDeal: " + data.dealType + "\\nMarketplace: " + data.preferredMarketplace + "\\nMessage: " + data.message
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
}`;

export const SITE_CONFIG = {
  // 1. Core Domain Metadata
  domainName: 'vigochat.com',
  displayDomain: 'VigoChat.com',
  brandPrefix: 'VigoChat',
  tld: '.com',
  appPreviewDomain: 'app.vigochat.com',
  phoneticSpelling: 'Vi-go-Chat',
  ipaPronunciation: '/ˈviː.ɡoʊ.tʃæt/',
  speechSynthesisText:
    'Vigo Chat dot com. Next generation conversations start here.',

  // 2. Valuation & Deal Pricing
  pricing: {
    binPrice: 24800,
    minOffer: 9500,
    defaultInvestorOffer: 18500,
    currency: 'USD',
    defaultLeaseMonths: 24,
    leaseTermOptions: [6, 12, 18, 24] as const,
    quickOfferPresets: [
      { label: '$15,000', value: '15000' },
      { label: '$19,500', value: '19500' },
      { label: '$24,800 (BIN)', value: '24800' },
      { label: 'Lease $1,033/mo', value: '1033/mo (24m)' },
    ],
  },

  // 3. WhatsApp Direct Contact Settings (Phone number with country code + template)
  whatsapp: {
    phoneNumber: '+15550198472',
    defaultMessageTemplate:
      'Hello, I am interested in acquiring vigochat.com.',
  },

  // 4. Direct Email Contact Settings
  email: {
    recipientEmail: 'acquisitions@vigochat.com',
    defaultSubject: 'Acquisition Inquiry: vigochat.com',
    offerSubjectPrefix: 'Acquisition Inquiry: vigochat.com',
    defaultMessageBody:
      'Hello, I am interested in acquiring vigochat.com. Please share the Escrow.com transaction link or next steps.',
  },

  // 5. Webhook / Form Relay Endpoint (Google Apps Script Web App URL / Formspree / Make)
  formSubmission: {
    /**
     * Replace this URL with your live Google Apps Script Web App `/exec` URL
     * or any webhook endpoint (Formspree, Make.com, Zapier, n8n, Slack incoming webhook).
     */
    webhookUrl:
      'https://script.google.com/macros/s/AKfycbz_VIGOCHAT_SHEET_WEBHOOK_ENDPOINT/exec',
    requestTimeoutMs: 9000,
    /**
     * When `allowDemoRelayFallback` is true and the placeholder URL above has not
     * been replaced yet, the form executes the real fetch attempt and gracefully
     * completes into the verified confirmation screen while logging the exact
     * JSON payload so you can test the full buyer funnel out-of-the-box.
     */
    allowDemoRelayFallback: true,
  },

  // 6. Verified Marketplace Links
  marketplaces: {
    escrow: {
      id: 'escrow',
      name: 'Escrow.com Direct',
      shortName: 'Escrow.com',
      subtitle: 'Official Licensed Domain Escrow',
      badge: '0% Buyer Markup • Recommended',
      protectionText: '100% Escrow Protected • ISO 27001 Certified',
      transferSpeed: 'Same-Day Registrar Push',
      feeNote:
        'Lowest total cost — save up to 15% vs third-party marketplace commissions',
      url: 'https://www.escrow.com/domains',
      accent: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/40',
      featured: true,
    },
    dan: {
      id: 'dan',
      name: 'Dan.com (GoDaddy)',
      shortName: 'Dan.com',
      subtitle: 'Automated Domain Checkout & Lease Engine',
      badge: 'Automated Lease-to-Own',
      protectionText: 'Backed by GoDaddy Transfer Guarantee',
      transferSpeed: 'Instant Automated Handover',
      feeNote:
        'Supports instant Buy-It-Now checkout and automated monthly Lease-to-Own',
      url: 'https://dan.com/buy-domain/vigochat.com',
      accent: 'from-sky-500/20 to-indigo-500/10 border-sky-500/40',
    },
    atom: {
      id: 'atom',
      name: 'Atom (Squadhelp)',
      shortName: 'Atom',
      subtitle: 'Premier Startup Brand Marketplace',
      badge: 'Verified Brand Listing',
      protectionText: 'Atom Escrow + Free Logo & Brand Perks',
      transferSpeed: 'Instant Automated Transfer',
      feeNote:
        'Instant card/wire/crypto checkout + flexible Lease-to-Own protection',
      url: 'https://www.atom.com/name/vigochat.com',
      accent: 'from-indigo-500/20 to-violet-500/10 border-indigo-500/40',
    },
    godaddy: {
      id: 'godaddy',
      name: 'GoDaddy Auctions / BuyNow',
      shortName: 'GoDaddy',
      subtitle: 'World’s Largest Registrar Network',
      badge: 'Fast Transfer Enabled',
      protectionText: 'GoDaddy Verified Ownership & Guarantee',
      transferSpeed: 'Instant Account Push',
      feeNote: 'Instant push to your corporate GoDaddy domain portfolio',
      url: 'https://www.godaddy.com/domainsearch/find?domainToCheck=vigochat.com',
      accent: 'from-cyan-500/20 to-sky-500/10 border-cyan-500/40',
    },
    afternic: {
      id: 'afternic',
      name: 'Afternic DLS Network',
      shortName: 'Afternic',
      subtitle: 'Global Registrar Fast-Transfer Partner',
      badge: 'Global DLS Network',
      protectionText: 'Protected by GoDaddy / Afternic Escrow',
      transferSpeed: 'Automated MLS Transfer',
      feeNote: '100+ partner registrar fast-transfer network worldwide',
      url: 'https://www.afternic.com/domain/vigochat.com',
      accent: 'from-violet-500/20 to-fuchsia-500/10 border-violet-500/40',
    },
    sedo: {
      id: 'sedo',
      name: 'Sedo.com Marketplace',
      shortName: 'Sedo',
      subtitle: 'European & Global Domain Exchange',
      badge: 'EU & Global Escrow',
      protectionText: 'Dedicated Sedo Transfer Specialist',
      transferSpeed: '24–48h Verified Handover',
      feeNote: 'Multi-currency USD / EUR / GBP wire & corporate VAT invoicing',
      url: 'https://sedo.com/search/details/?domain=vigochat.com',
      accent: 'from-amber-500/20 to-orange-500/10 border-amber-500/40',
    },
  } as Record<MarketplaceId, MarketplaceConfigItem>,

  // 7. Navigation Links (Used by Header & Off-Canvas Side Drawer)
  navigationLinks: [
    {
      label: 'Live Demo',
      href: '#hero-demo',
      badge: 'Interactive AI',
      description: 'Test real-time multi-persona chat & telemetry',
    },
    {
      label: 'Use Cases',
      href: '#use-cases',
      badge: '4 Industries',
      description: 'AI Support, Web3, Team Collab & Telehealth',
    },
    {
      label: 'Brand Metrics',
      href: '#brand-matrix',
      badge: 'Valuation',
      description: '8-Letter .COM scorecard, radio test & comps',
    },
    {
      label: 'Acquisition / Escrow',
      href: '#acquire',
      badge: 'Buy / Lease',
      description: 'Outright BIN, Lease-to-Own calculator & marketplaces',
    },
    {
      label: 'Buyer FAQ',
      href: '#faq',
      badge: 'Escrow Info',
      description: 'Transfer security, DNS rights & billing answers',
    },
  ],
};

/**
 * Helper: Build a formatted WhatsApp click-to-chat URL from `SITE_CONFIG.whatsapp`
 */
export function buildWhatsAppUrl(customMessage?: string): string {
  const digitsOnly = SITE_CONFIG.whatsapp.phoneNumber.replace(/[^0-9]/g, '');
  const message = customMessage || SITE_CONFIG.whatsapp.defaultMessageTemplate;
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

/**
 * Helper: Build a formatted `mailto:` link from `SITE_CONFIG.email`
 */
export function buildMailtoUrl(params?: {
  subject?: string;
  body?: string;
}): string {
  const subject = encodeURIComponent(
    params?.subject || SITE_CONFIG.email.defaultSubject
  );
  const body = encodeURIComponent(
    params?.body || SITE_CONFIG.email.defaultMessageBody
  );
  return `mailto:${SITE_CONFIG.email.recipientEmail}?subject=${subject}&body=${body}`;
}

export default SITE_CONFIG;
