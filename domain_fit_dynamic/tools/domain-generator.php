<?php
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/domain-brain.php';
require_once __DIR__ . '/../includes/ads-helper.php';
$pdo = db();
$bank = get_generator_wordbank($pdo);
$page_title = 'Domain Name Generator for Brandable Startup Ideas | ' . setting($pdo, 'site_title', 'DomainFits');
$page_description = 'Explore domain-name ideas with a curated word list or creative syllables. Filter and export a shortlist; registration availability and trademark status are not checked.';
$canonical_url = 'tools/domain-generator';
$generatorMode = setting($pdo, 'generator_controls_mode', 'drawer') === 'accordion' ? 'accordion' : 'drawer';
$rootInput = $_GET['root'] ?? 'Pay';
$rootSeed = preg_replace('/[^a-z0-9-]/i', '', is_scalar($rootInput) ? (string) $rootInput : 'Pay') ?: 'Pay';
$rootSeed = substr($rootSeed, 0, 40);
$structured_data = [
  '@context' => 'https://schema.org',
  '@type' => 'WebApplication',
  'name' => 'DomainFits Domain Name Generator',
  'applicationCategory' => 'BusinessApplication',
  'operatingSystem' => 'Any',
  'description' => $page_description,
  'isAccessibleForFree' => true,
  'url' => absolute_public_url(app_url('tools/domain-generator')),
];
require __DIR__ . '/../includes/header.php';
?>
<?= render_ad_slot($pdo, 'header_banner') ?>
  <main id="main-content" class="page-main generator-main" data-controls-mode="drawer">
    <div class="container">
      <section class="generator-intro">
        <p class="eyebrow">Free browser-based naming tool</p>
        <h1>Domain Name Generator for Brandable Startup Ideas</h1>
        <p>Use this keyword-based startup name finder to explore combinations with a curated word list or creative syllables, then filter and export the ideas worth checking. Suggestions are generated locally in your browser and are not live availability results.</p>
      </section>

      <div class="notice notice-warning" role="note"><strong>Important:</strong> This tool does not check domain registration, registrar pricing, trademarks, business names, or social handles. Verify every promising name independently before using it.</div>

      <section class="generator-panel" id="generator" aria-label="Domain name generator controls">
        <button class="generator-settings-accordion-toggle" id="generatorSettingsAccordionToggle" type="button" aria-expanded="true" aria-controls="generatorSettingsBody">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/></svg>
          <span>Generation settings</span><span data-settings-toggle-state>Expanded</span>
        </button>
        <div class="settings-drawer-header">
          <div><p class="eyebrow">Tune your ideas</p><h2 id="settingsDrawerTitle">Generation settings</h2></div>
          <button class="settings-drawer-close" id="generatorSettingsClose" type="button" aria-label="Close generation settings" title="Close settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="generator-settings-body" id="generatorSettingsBody">
          <div class="generator-settings-content">
        <div class="controls-grid">
          <div class="field">
            <label class="control-label" for="rootInput">Root keyword <span class="control-hint" id="semanticDetectedBadge">General brand</span></label>
            <input class="control-input" type="text" id="rootInput" value="<?= e($rootSeed) ?>" maxlength="40" autocomplete="off" placeholder="e.g. Pay, Bloom, Cloud">
            <span class="control-hint">Use a short idea, product, audience, or benefit.</span>
          </div>
          <div class="field">
            <label class="control-label" for="brainModeSelect">Niche / industry category</label>
            <select class="control-select" id="brainModeSelect">
              <option value="smart" selected>Auto-detect from keyword</option>
              <?php foreach (($bank['categories'] ?? []) as $category): if ($category['key'] === 'smart') continue; ?>
                <option value="<?= e($category['key']) ?>"><?= e($category['label']) ?></option>
              <?php endforeach; ?>
              <option value="dictionary_pure">General word pool</option>
            </select>
            <span class="control-hint">Choose a niche to prioritize relevant suggestions, or let the root keyword guide the word pool.</span>
          </div>
          <div class="field">
            <label class="control-label" for="countPresetSelect">Target ideas</label>
            <div class="tld-field">
              <select class="control-select" id="countPresetSelect" aria-label="Choose a preset result count">
                <option value="100">100</option><option value="250">250</option><option value="500" selected>500</option><option value="750">750</option><option value="1000">1,000</option><option value="custom">Custom</option>
              </select>
              <input class="control-input" type="number" id="customCountInput" value="500" min="10" max="2000" aria-label="Custom target ideas count">
            </div>
            <span class="control-hint">Strict mode may return fewer if the selected list runs out.</span>
          </div>
          <div class="field">
            <label class="control-label" for="extInput">Domain extension</label>
            <div class="tld-field">
              <input class="control-input" type="text" id="extInput" value=".com" maxlength="64" aria-label="Domain extension" placeholder=".com">
              <div class="tld-shortcuts" aria-label="Extension shortcuts">
                <button type="button" data-extension=".com">.com</button><button type="button" data-extension=".ai">.ai</button><button type="button" data-extension=".io">.io</button><button type="button" data-extension=".net">.net</button>
              </div>
            </div>
            <span class="control-hint">Extension availability is not checked.</span>
          </div>
        </div>

        <div class="mode-switches" role="group" aria-label="Generation modes">
          <div class="mode-control-card strict-banner is-strict" id="strictBanner">
            <label class="mode-control-copy" for="strictDictToggle">
              <strong id="strictModeLabel">Curated word-list</strong>
              <span class="mode-badge" id="strictStatusBadge">Curated</span>
            </label>
            <label class="switch" aria-labelledby="strictModeLabel" title="Switch off to allow invented syllables">
              <input type="checkbox" id="strictDictToggle" checked aria-describedby="strictDescText">
              <span class="switch-track" aria-hidden="true"></span>
            </label>
            <span class="visually-hidden" id="strictDescText">Uses the included curated word list. Switching off allows invented and synthetic words; the list is not dictionary or trademark certification.</span>
          </div>
          <div class="mode-control-card brandable-mode-panel" id="brandableModePanel">
            <label class="mode-control-copy" for="brandableModeToggle">
              <strong id="brandableModeLabel">Brandable Mode</strong>
              <span class="mode-badge" id="brandableModeBadge">Off</span>
            </label>
            <label class="switch" aria-labelledby="brandableModeLabel" title="Add suffix and word-splice ideas">
              <input type="checkbox" id="brandableModeToggle" aria-describedby="brandableModeDesc">
              <span class="switch-track" aria-hidden="true"></span>
            </label>
            <span class="visually-hidden" id="brandableModeDesc">Adds modern suffix, morphology, and short portmanteau patterns while retaining the standard generator when switched off.</span>
          </div>
        </div>
        <p class="mode-controls-hint">Curated uses the built-in list; turn it off to allow invented words. Brandable adds modern suffix and splice ideas.</p>

        <div class="filter-panel">
          <div class="filter-heading"><h2>Partner word length</h2><span id="activeLengthDesc">Filter: 3 partner letters</span></div>
          <div class="length-options">
            <label class="length-option"><input type="checkbox" id="lenAll"><span class="length-badge" id="lenAllBadge"><span class="length-icon" id="lenAllIcon" aria-hidden="true">□</span>All lengths</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len2" value="2"><span class="length-badge" id="len2Badge"><span class="length-icon icon-box" aria-hidden="true">□</span>2 letters</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len3" value="3" checked><span class="length-badge is-selected" id="len3Badge"><span class="length-icon icon-box" aria-hidden="true">✓</span>3 letters</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len4" value="4"><span class="length-badge" id="len4Badge"><span class="length-icon icon-box" aria-hidden="true">□</span>4 letters</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len5" value="5"><span class="length-badge" id="len5Badge"><span class="length-icon icon-box" aria-hidden="true">□</span>5 letters</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len6" value="6"><span class="length-badge" id="len6Badge"><span class="length-icon icon-box" aria-hidden="true">□</span>6 letters</span></label>
            <label class="length-option"><input type="checkbox" class="len-checkbox" id="len7" value="7"><span class="length-badge" id="len7Badge"><span class="length-icon icon-box" aria-hidden="true">□</span>7+ letters</span></label>
          </div>
          <p class="control-hint">Filters and result badges count the partner word only, excluding your root keyword. The 7+ option includes words with seven or more letters; hover or focus a result to see the complete domain-label length, excluding its extension.</p>
        </div>

        <div class="generator-actions">
          <div class="field"><label class="control-label" for="placementSelect">Keyword placement</label><select class="control-select" id="placementSelect"><option value="both" selected>Root first and last</option><option value="prefix">Root first</option><option value="suffix">Root last</option></select></div>
          <label class="inline-check"><input type="checkbox" id="camelCaseToggle" checked><span>Use readable capitalization</span></label>
          <button class="button button-primary generate-button" id="generateBtn" type="button"><span id="syncIcon" aria-hidden="true">↻</span> Generate ideas</button>
        </div>
          </div>
        </div>
      </section>
      <button class="settings-drawer-backdrop" id="settingsBackdrop" type="button" aria-label="Close generation settings" hidden></button>

      <section id="generatedResults" tabindex="-1" aria-label="Generated domain ideas">
        <div class="generator-toolbar">
          <div class="search-wrap"><label class="control-label" for="inSearchInput">Filter this batch</label><input class="search-input" id="inSearchInput" type="search" placeholder="Search generated ideas…" autocomplete="off"></div>
          <div class="toolbar-meta"><span>Showing <strong id="visibleCounter">0</strong> of <strong id="totalCounter">0</strong> ideas</span></div>
          <div class="toolbar-buttons" aria-label="Export generated ideas">
            <button class="utility-button icon-action" id="copyAllTopBtn" type="button" aria-label="Copy all 0 generated ideas" title="Copy all generated ideas">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg><span class="action-count-badge" id="btnCountBadge">0</span>
            </button>
            <button class="utility-button icon-action" id="exportTxtBtn" type="button" aria-label="Download TXT shortlist" title="Download TXT">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>
            </button>
            <button class="utility-button icon-action" id="exportCsvBtn" type="button" aria-label="Download CSV shortlist" title="Download CSV">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16m6-16v16M3 15h18"/></svg>
            </button>
          </div>
        </div>
        <p class="result-note" id="resultCountNote" aria-live="polite">Generate a batch to see ideas. Domain availability is not verified.</p>
        <div class="domain-grid" id="domainGrid" aria-live="polite"></div>
      </section>
      <?= render_ad_slot($pdo, 'generator_inline') ?>
      <div class="export-speed-dial" id="exportSpeedDial">
        <div class="export-menu" id="exportSpeedMenu" role="group" aria-label="Export domain ideas" hidden>
          <button class="export-menu-option" id="copyAllMobileBtn" type="button" aria-label="Copy all 0 generated ideas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg><span>Copy All</span><span class="mobile-count-badge" id="mobileBtnCountBadge">0</span></button>
          <button class="export-menu-option" id="exportTxtMobileBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg><span>Download TXT</span></button>
          <button class="export-menu-option" id="exportCsvMobileBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16m6-16v16M3 15h18"/></svg><span>Download CSV</span></button>
        </div>
        <button class="export-menu-toggle" id="exportMenuToggle" type="button" aria-label="Open export menu" aria-expanded="false" aria-controls="exportSpeedMenu" title="Export ideas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 16v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg></button>
      </div>
      <button class="controls-fab" id="generatorSettingsFab" type="button" aria-label="Open generation settings" aria-expanded="false" aria-controls="generator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/></svg><span class="visually-hidden">Settings</span></button>
      <div class="toast" id="toast" role="status" aria-live="polite"><span id="toastMsg">Copied.</span></div>

      <section class="generator-content article-body" aria-labelledby="guide-title">
        <h2 id="guide-title">How to find and refine brandable domain ideas</h2>
        <p>Start with a meaningful root word rather than a generic prompt. A seed that describes your customer, product benefit, or brand character usually creates a more focused first batch. Try a few roots instead of relying on a single keyword, then compare root-first and root-last patterns. The word-length filter is a simple way to explore different rhythms: short partners may feel compact, while longer ones can add context.</p>
        <p>The curated mode uses a fixed vocabulary included with this page; it does not consult a live dictionary. Creative mode can add invented syllables, which may be useful for brainstorming but still need careful review. Use the search field to narrow the current results, copy individual names by clicking a result, or save a TXT/CSV shortlist for discussion.</p>
        <h2>Before you register a name</h2>
        <ul><li>Check the exact domain and extension with a registrar, including renewal and premium pricing.</li><li>Search trademark records and existing businesses in the places and categories where you plan to operate.</li><li>Say the name aloud and check whether another person can spell it after hearing it.</li><li>Review the meaning, pronunciation, and potential confusion in your audience's languages.</li></ul>
        <h2>Need an AI domain name generator or an available domain checker?</h2>
        <p>People use both phrases when looking for business names, but this tool does not use a live AI model and it does not check domain availability. It is a browser-based startup name finder for brainstorming. For a real business name search, review official company and trademark records in the places where you plan to operate. Check the exact domain with a registrar, then review the result with a qualified adviser if the name has commercial value. Read our <a href="<?= e(app_url('pages/disclaimer.html')) ?>">disclaimer</a> and <a href="<?= e(app_url('pages/terms-and-conditions.html')) ?>">terms</a> before relying on any output.</p>
      </section>
    </div>
  </main>

<script>window.DOMAINFIT_WORD_BANK = <?= json_encode($bank, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR) ?>; window.DOMAINFIT_SITE_CONFIG = { generatorControlsMode: <?= json_encode($generatorMode) ?> }; window.DOMAINFIT_CONFIG = { basePath: <?= json_encode(app_base_path()) ?>, analyticsEnabled: <?= json_encode((bool) setting($pdo, 'site_analytics_enabled', false)) ?> };</script>
<script src="<?= e(asset_url('js/domain-generator-data.js')) ?>" defer></script>
<script src="<?= e(asset_url('js/domain-generator.js')) ?>" defer></script>
<?php require __DIR__ . '/../includes/footer.php'; ?>
