/* Domain generator interactions and rendering. Original word data is loaded first. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LENGTHS = [2, 3, 4, 5, 6, 7];
  const MAX_RESULTS = 2000;
  const controlsMode = window.DOMAINFITS_SITE_CONFIG?.generatorControlsMode === 'accordion' ? 'accordion' : 'drawer';
  let allGeneratedDomains = [];
  let displayedDomains = [];
  let toastTimer;
  let generationTimer;
  let lastStrictMode = null;
  let lastBrandableMode = null;

  const ONSETS = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'qu', 'r', 's', 't', 'v', 'w', 'x', 'y', 'z', 'bl', 'br', 'ch', 'cl', 'cr', 'fl', 'gl', 'pr', 'st', 'tr'];
  const NUCLEI = ['a', 'e', 'i', 'o', 'u'];
  const CODAS = ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'x'];

  const CATEGORY_LABELS = {
    fintech: 'FinTech & Crypto',
    tech_ai: 'AI & Tech',
    ecommerce: 'E-Commerce',
    health_bio: 'Health & Bio',
    creative_media: 'Creative & Media',
    minimal_short: 'Minimal / Short',
    saas_action: 'SaaS & Productivity',
    smart: 'General brand'
  };
  const CATEGORY_PREFERRED_WORDS = {
    fintech: ['cash', 'bank', 'coin', 'fund', 'pay', 'card', 'safe', 'mint', 'wallet', 'vault', 'credit', 'trust', 'market', 'payout', 'loan', 'earn', 'flow', 'save', 'wealth', 'money', 'crypto', 'quantum', 'venture'],
    tech_ai: ['byte', 'code', 'data', 'node', 'mesh', 'grid', 'core', 'tech', 'cloud', 'script', 'vector', 'neural', 'server', 'signal', 'matrix', 'engine', 'model', 'robot', 'logic', 'pixel', 'quantum', 'network', 'digital'],
    ecommerce: ['shop', 'cart', 'sell', 'store', 'deal', 'sale', 'market', 'retail', 'order', 'brand', 'buy', 'commerce', 'catalog', 'checkout', 'merchant', 'marketplace'],
    health_bio: ['care', 'health', 'well', 'bio', 'med', 'gene', 'cell', 'vita', 'heal', 'pulse', 'flora', 'renew', 'nature', 'clinic', 'patient', 'vital', 'wellness', 'therapy', 'medical'],
    creative_media: ['art', 'draw', 'film', 'tune', 'song', 'story', 'pixel', 'design', 'craft', 'media', 'canvas', 'studio', 'visual', 'motion', 'create', 'express', 'creative'],
    minimal_short: ['go', 'up', 'on', 'to', 'ox', 'ai', 'io', 'id', 'net', 'key', 'hub', 'pay', 'bit', 'bio', 'zen', 'lux', 'vex', 'orb', 'ion', 'arc'],
    saas_action: ['work', 'task', 'flow', 'team', 'lead', 'run', 'grow', 'jump', 'dash', 'lift', 'sync', 'track', 'form', 'desk', 'hire', 'meet', 'boost', 'focus', 'build', 'sprint', 'workflow', 'platform']
  };
  const BRANDABLE_MORPHEMES = ['ly', 'io', 'ify', 'eer', 'via', 'nest', 'tify', 'ora', 'nova', 'able', 'wise', 'ster', 'flow', 'labs', 'works', 'verse', 'scape', 'pilot', 'mint', 'forge', 'hub', 'base', 'mode', 'sync', 'mesh', 'mate', 'craft', 'tech', 'zone', 'loop'];

  function sanitizeRoot(value) {
    const normalized = String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
    return normalized || 'pay';
  }

  function normalizeExtension(value) {
    let extension = String(value || '.com').trim().toLowerCase();
    extension = extension.replace(/^\.+/, '').replace(/[^a-z0-9.-]/g, '').replace(/\.{2,}/g, '.');
    extension = extension.replace(/^[.-]+|[.-]+$/g, '');
    const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
    return extension && extension.length <= 63 && valid.test(extension) ? `.${extension}` : '.com';
  }

  function formatWord(word, camelCase) {
    if (!word) return '';
    const lower = String(word).toLowerCase();
    if (!camelCase) return lower;
    return lower.split('-').map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '').join('-');
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function synthesizeBrandableWord(targetLength, seenWords) {
    for (let attempts = 0; attempts < 500; attempts += 1) {
      let candidate = '';
      if (targetLength === 2) {
        candidate = ONSETS[Math.floor(Math.random() * 15)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)];
      } else if (targetLength === 3) {
        candidate = ONSETS[Math.floor(Math.random() * 20)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)] + CODAS[Math.floor(Math.random() * CODAS.length)];
      } else if (targetLength === 4) {
        candidate = ONSETS[Math.floor(Math.random() * 10)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)] + ONSETS[Math.floor(Math.random() * 10)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)];
      } else {
        candidate = (ONSETS[Math.floor(Math.random() * 10)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)] + CODAS[Math.floor(Math.random() * CODAS.length)] + ONSETS[Math.floor(Math.random() * 10)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)] + NUCLEI[Math.floor(Math.random() * NUCLEI.length)]).slice(0, targetLength);
      }
      if (candidate.length === targetLength && !seenWords.has(candidate)) {
        seenWords.add(candidate);
        return candidate;
      }
    }
    return null;
  }

  function synthesizeLongPartnerWord(targetLength, seenWords) {
    for (let attempts = 0; attempts < 500; attempts += 1) {
      let candidate = '';
      while (candidate.length < targetLength) {
        const onset = ONSETS[Math.floor(Math.random() * ONSETS.length)];
        const vowel = NUCLEI[Math.floor(Math.random() * NUCLEI.length)];
        const coda = CODAS[Math.floor(Math.random() * CODAS.length)];
        candidate += `${onset}${vowel}${coda}`;
      }
      candidate = candidate.slice(0, targetLength);
      if (candidate.length === targetLength && !seenWords.has(candidate)) {
        seenWords.add(candidate);
        return candidate;
      }
    }
    return null;
  }

  function selectedLengths() {
    return Array.from(document.querySelectorAll('.len-checkbox:checked'), (checkbox) => Number(checkbox.value));
  }

  function getDetectedCategory(root) {
    const normalized = String(root || '').toLowerCase().trim();
    if (!normalized) return 'smart';
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((keyword) => normalized === keyword || normalized.includes(keyword))) return category;
    }
    return 'smart';
  }

  function activeCategory(root) {
    const selection = $('brainModeSelect').value;
    if (selection === 'smart') return getDetectedCategory(root);
    return selection === 'dictionary_pure' ? 'smart' : selection;
  }

  function updateCategoryBadge() {
    const root = $('rootInput').value.trim();
    const category = activeCategory(root);
    $('semanticDetectedBadge').textContent = CATEGORY_LABELS[category] || 'General word list';
  }

  function updateStrictUI() {
    const toggle = $('strictDictToggle');
    const isStrict = toggle.checked;
    $('strictBanner').classList.toggle('is-creative', !isStrict);
    $('strictStatusBadge').textContent = isStrict ? 'On' : 'Off';
    $('strictStatusBadge').setAttribute('aria-label', isStrict ? 'Curated words only' : 'Creative words allowed');
    toggle.setAttribute('aria-label', isStrict
      ? 'Curated word-list mode on; switch off to allow invented words'
      : 'Curated word-list mode off; invented words are allowed');
    $('strictDescText').textContent = isStrict
      ? 'Uses the included curated list, not a dictionary or trademark certification.'
      : 'Allows invented and synthetic words alongside the included list.';
  }

  function updateBrandableUI() {
    const toggle = $('brandableModeToggle');
    const enabled = toggle.checked;
    $('brandableModePanel').classList.toggle('is-active', enabled);
    $('brandableModeBadge').textContent = enabled ? 'On' : 'Off';
    $('brandableModeBadge').setAttribute('aria-label', `Brandable Mode ${enabled ? 'on' : 'off'}`);
    toggle.setAttribute('aria-label', `Brandable Mode ${enabled ? 'on' : 'off'}`);
  }

  function handleStrictModeToggle() {
    updateStrictUI();
    const isStrict = $('strictDictToggle').checked;
    if (isStrict === lastStrictMode) return;
    lastStrictMode = isStrict;
    runGeneration();
  }

  function handleBrandableModeToggle() {
    updateBrandableUI();
    const isBrandable = $('brandableModeToggle').checked;
    if (isBrandable === lastBrandableMode) return;
    lastBrandableMode = isBrandable;
    runGeneration();
  }

  function syncRestoredModeState() {
    updateStrictUI();
    updateBrandableUI();
    const isStrict = $('strictDictToggle').checked;
    const isBrandable = $('brandableModeToggle').checked;
    if (isStrict === lastStrictMode && isBrandable === lastBrandableMode) return;
    lastStrictMode = isStrict;
    lastBrandableMode = isBrandable;
    runGeneration();
  }

  function setPanelInert(panel, inert) {
    panel.inert = inert;
    if (inert) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
  }

  function setAccordionExpanded(expanded) {
    const panel = $('generator');
    const toggle = $('generatorSettingsAccordionToggle');
    const body = $('generatorSettingsBody');
    panel.classList.toggle('is-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.querySelector('[data-settings-toggle-state]').textContent = expanded ? 'Expanded' : 'Show settings';
    body.setAttribute('aria-hidden', String(!expanded));
    setPanelInert(body, !expanded);
  }

  function closeExportMenu() {
    const menu = $('exportSpeedMenu');
    const toggle = $('exportMenuToggle');
    if (!menu || !toggle) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open export menu');
  }

  function openSettingsDrawer() {
    const panel = $('generator');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'settingsDrawerTitle');
    panel.setAttribute('aria-modal', 'true');
    setPanelInert(panel, false);
    $('settingsBackdrop').hidden = false;
    $('generatorSettingsFab').setAttribute('aria-expanded', 'true');
    $('generatorSettingsFab').setAttribute('aria-label', 'Close generation settings');
    document.body?.classList.add('generator-drawer-open');
    closeExportMenu();
    const focusCloseButton = () => $('generatorSettingsClose').focus();
    if (window.requestAnimationFrame) window.requestAnimationFrame(focusCloseButton);
    else focusCloseButton();
  }

  function closeSettingsDrawer({ restoreFocus = true } = {}) {
    const panel = $('generator');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-labelledby');
    setPanelInert(panel, true);
    $('settingsBackdrop').hidden = true;
    $('generatorSettingsFab').setAttribute('aria-expanded', 'false');
    $('generatorSettingsFab').setAttribute('aria-label', 'Open generation settings');
    document.body?.classList.remove('generator-drawer-open');
    if (restoreFocus) $('generatorSettingsFab').focus();
  }

  function setupControlsExperience() {
    const main = $('main-content');
    const panel = $('generator');
    main.dataset.controlsMode = controlsMode;
    if (controlsMode === 'accordion') {
      panel.classList.remove('is-open');
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('aria-labelledby');
      panel.setAttribute('aria-hidden', 'false');
      setPanelInert(panel, false);
      $('settingsBackdrop').hidden = true;
      $('generatorSettingsFab').hidden = true;
      setAccordionExpanded(true);
      return;
    }

    $('generatorSettingsAccordionToggle').hidden = true;
    closeSettingsDrawer({ restoreFocus: false });
  }

  function updateExportCount() {
    const count = allGeneratedDomains.length;
    ['btnCountBadge', 'mobileBtnCountBadge'].forEach((id) => {
      const badge = $(id);
      if (badge) badge.textContent = String(count);
    });
    const copyLabel = `Copy all ${count} generated ideas`;
    ['copyAllTopBtn', 'copyAllMobileBtn'].forEach((id) => {
      const button = $(id);
      if (button) {
        button.setAttribute('aria-label', copyLabel);
        button.title = copyLabel;
      }
    });
  }

  function generateFromSettings() {
    if (controlsMode === 'drawer') closeSettingsDrawer({ restoreFocus: false });
    closeExportMenu();
    runGeneration(true);
    if (controlsMode === 'drawer') {
      const results = $('generatedResults');
      results.focus({ preventScroll: true });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function updateCheckboxUI() {
    let selected = selectedLengths();
    if (selected.length === 0) {
      $('len3').checked = true;
      selected = [3];
    }
    const allSelected = selected.length === LENGTHS.length;
    $('lenAll').checked = allSelected;
    $('lenAllBadge').classList.toggle('is-selected', allSelected);
    $('lenAllIcon').textContent = allSelected ? '✓' : '□';

    LENGTHS.forEach((length) => {
      const checkbox = $(`len${length}`);
      const badge = $(`len${length}Badge`);
      badge.classList.toggle('is-selected', checkbox.checked);
      badge.querySelector('.icon-box').textContent = checkbox.checked ? '✓' : '□';
    });

    const describeLength = (length) => length === 7 ? '7+ letters' : `${length} letters`;
    const description = allSelected
      ? 'Filter: all partner word lengths (2+ letters)'
      : `Filter: ${selected.slice().sort((a, b) => a - b).map(describeLength).join(', ')}`;
    $('activeLengthDesc').textContent = description;
  }

  function candidatesForLength(source, length) {
    if (length !== 7) return source[length] || [];
    return [...Object.values(source).flat(), ...LONG_PARTNER_WORDS];
  }

  function matchesSelectedLength(word, length) {
    return length === 7 ? word.length >= 7 : word.length === length;
  }

  function buildWordPool(lengths, neededWords, isStrict) {
    const pool = [];
    const seen = new Set();
    const addCandidates = (source, length) => {
      candidatesForLength(source, length).forEach((word) => {
        if (matchesSelectedLength(word, length) && !seen.has(word)) {
          seen.add(word);
          pool.push(word);
        }
      });
    };

    lengths.forEach((length) => addCandidates(VERIFIED_DICTIONARY, length));

    if (!isStrict) {
      lengths.forEach((length) => addCandidates(CREATIVE_BRANDABLES, length));
      let misses = 0;
      while (pool.length < neededWords && misses < 100) {
        const length = lengths[Math.floor(Math.random() * lengths.length)];
        const word = length === 7
          ? synthesizeLongPartnerWord(7 + Math.floor(Math.random() * 4), seen)
          : synthesizeBrandableWord(length, seen);
        if (word) pool.push(word);
        else misses += 1;
      }
    }
    return pool;
  }

  function prioritizeCandidates(words, category) {
    const preferred = new Set(CATEGORY_PREFERRED_WORDS[category] || []);
    if (preferred.size === 0) return shuffle([...words]);
    const first = shuffle(words.filter((word) => preferred.has(word)));
    const remaining = shuffle(words.filter((word) => !preferred.has(word)));
    return first.concat(remaining);
  }

  function generateDomains(root, extension, placement, lengths, targetCount, camelCase, isStrict, category) {
    const cleanRoot = sanitizeRoot(root);
    const cleanExtension = normalizeExtension(extension);
    const wordTarget = placement === 'both' ? Math.ceil(targetCount / 2) : targetCount;
    const words = prioritizeCandidates(buildWordPool(lengths, wordTarget, isStrict), category);
    const domains = [];
    const seen = new Set();
    const rootLower = cleanRoot.toLowerCase();

    const addDomain = (word, isPrefix) => {
      if (word.toLowerCase() === rootLower) return;
      const combo = isPrefix ? `${rootLower}${word.toLowerCase()}` : `${word.toLowerCase()}${rootLower}`;
      if (seen.has(combo) || combo.length > 63) return;
      seen.add(combo);
      const prettyRoot = formatWord(cleanRoot, camelCase);
      const prettyWord = formatWord(word, camelCase);
      const domain = `${isPrefix ? prettyRoot + prettyWord : prettyWord + prettyRoot}${cleanExtension}`;
      domains.push({
        id: domains.length + 1,
        domain,
        rawCombo: combo,
        tld: cleanExtension,
        rootPart: cleanRoot,
        partnerPart: word,
        length: word.length,
        isPrefix
      });
    };

    for (const word of words) {
      if (placement === 'prefix' || placement === 'both') addDomain(word, true);
      if (placement === 'suffix' || placement === 'both') addDomain(word, false);
      if (domains.length >= targetCount) break;
    }
    return shuffle(domains).slice(0, targetCount).map((item, index) => ({ ...item, id: index + 1 }));
  }

  function generateBrandableDomains(root, extension, placement, lengths, targetCount, camelCase, isStrict, category) {
    const cleanRoot = sanitizeRoot(root);
    const rootLower = cleanRoot.toLowerCase();
    const cleanExtension = normalizeExtension(extension);
    const sourceWords = buildWordPool(lengths, targetCount, isStrict);
    const morphs = BRANDABLE_MORPHEMES.filter((word) => lengths.some((length) => matchesSelectedLength(word, length)));
    const preferredWords = prioritizeCandidates(sourceWords, category);
    const morphSet = new Set(morphs);
    const partners = [...morphs, ...preferredWords.filter((word) => !morphSet.has(word))];
    const rootFirst = placement === 'prefix' || placement === 'both';
    const rootLast = placement === 'suffix' || placement === 'both';
    const domains = [];
    const seen = new Set();

    const addLabel = (rawLabel, partner, isPrefix) => {
      const label = String(rawLabel).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      if (!label || label === rootLower || label.length > 63 || seen.has(label)) return;
      seen.add(label);
      domains.push({
        id: domains.length + 1,
        domain: `${formatWord(label, camelCase)}${cleanExtension}`,
        rawCombo: label,
        tld: cleanExtension,
        rootPart: cleanRoot,
        partnerPart: partner,
        length: partner.length,
        isPrefix,
        isBrandable: true,
        brandableLabel: label
      });
    };

    const makeRootFirstBlend = (partner) => {
      const overlapLimit = Math.min(4, rootLower.length - 1, partner.length - 1);
      for (let overlap = overlapLimit; overlap >= 2; overlap -= 1) {
        if (rootLower.endsWith(partner.slice(0, overlap))) {
          addLabel(`${rootLower}${partner.slice(overlap)}`, partner, true);
          return;
        }
      }
      if (rootLower.length >= 4 && partner.length >= 4) {
        const rootKeep = Math.max(2, Math.ceil(rootLower.length * 0.72));
        const partnerStart = Math.max(1, Math.floor(partner.length * 0.42));
        addLabel(`${rootLower.slice(0, rootKeep)}${partner.slice(partnerStart)}`, partner, true);
      }
    };

    const makeRootLastBlend = (partner) => {
      if (partner.length >= 4 && rootLower.length >= 4) {
        const partnerKeep = Math.max(2, Math.ceil(partner.length * 0.72));
        const rootStart = Math.max(1, Math.floor(rootLower.length * 0.28));
        addLabel(`${partner.slice(0, partnerKeep)}${rootLower.slice(rootStart)}`, partner, false);
      }
    };

    for (const partnerValue of partners) {
      const partner = String(partnerValue).toLowerCase();
      if (rootFirst) {
        addLabel(`${rootLower}${partner}`, partner, true);
        makeRootFirstBlend(partner);
      }
      if (rootLast) {
        addLabel(`${partner}${rootLower}`, partner, false);
        makeRootLastBlend(partner);
      }
    }
    return domains.slice(0, targetCount).map((item, index) => ({ ...item, id: index + 1 }));
  }

  function updateResultNote(targetCount) {
    const generated = allGeneratedDomains.length;
    const isStrict = $('strictDictToggle').checked;
    let message = `${generated} idea${generated === 1 ? '' : 's'} generated. Availability and trademark status are not checked.`;
    if (generated < targetCount) {
      message = isStrict
        ? `Generated ${generated} of ${targetCount} requested ideas. The selected curated word list did not contain enough unique combinations; switch to creative mode or select more word lengths for more results.`
        : `Generated ${generated} of ${targetCount} requested ideas. Try a different keyword, placement, or word-length combination.`;
      message += ' Availability and trademark status are not checked.';
    }
    $('resultCountNote').textContent = message;
  }

  function runGeneration(animate = false) {
    const root = sanitizeRoot($('rootInput').value);
    const extension = normalizeExtension($('extInput').value);
    const placement = $('placementSelect').value;
    const camelCase = $('camelCaseToggle').checked;
    const isStrict = $('strictDictToggle').checked;
    const lengths = selectedLengths();
    const requested = Math.max(10, Math.min(MAX_RESULTS, Number.parseInt($('customCountInput').value, 10) || 500));
    $('customCountInput').value = String(requested);
    $('extInput').value = extension;
    const category = activeCategory(root);

    const selectedLengthsForRun = lengths.length ? lengths : [3];
    const brandableMode = $('brandableModeToggle').checked;
    allGeneratedDomains = brandableMode
      ? generateBrandableDomains(root, extension, placement, selectedLengthsForRun, requested, camelCase, isStrict, category)
      : generateDomains(root, extension, placement, selectedLengthsForRun, requested, camelCase, isStrict, category);
    updateExportCount();
    updateResultNote(requested);
    applyInstantSearch();

    if (animate) {
      $('syncIcon').classList.remove('is-spinning');
      void $('syncIcon').offsetWidth;
      $('syncIcon').classList.add('is-spinning');
      showToast(`${allGeneratedDomains.length} domain ideas generated.`);
    }
  }

  function updateNamingStyle() {
    const camelCase = $('camelCaseToggle').checked;
    allGeneratedDomains.forEach((domain) => {
      if (domain.isBrandable) {
        domain.domain = `${formatWord(domain.brandableLabel, camelCase)}${domain.tld}`;
        return;
      }
      const root = formatWord(domain.rootPart, camelCase);
      const partner = formatWord(domain.partnerPart, camelCase);
      domain.domain = `${domain.isPrefix ? root + partner : partner + root}${domain.tld}`;
    });
    applyInstantSearch();
  }

  function applyInstantSearch() {
    const query = $('inSearchInput').value.trim().toLowerCase();
    displayedDomains = query
      ? allGeneratedDomains.filter((item) => item.domain.toLowerCase().includes(query))
      : [...allGeneratedDomains];
    $('visibleCounter').textContent = String(displayedDomains.length);
    $('totalCounter').textContent = String(allGeneratedDomains.length);
    renderCards();
  }

  function renderCards() {
    const grid = $('domainGrid');
    grid.classList.add('is-updating');
    const finishTransition = () => {
      const nextFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
      nextFrame(() => grid.classList.remove('is-updating'));
    };
    if (displayedDomains.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = allGeneratedDomains.length ? 'No domain ideas match this filter. Try another keyword.' : 'No ideas are available for these settings. Select more word lengths or allow creative mode.';
      grid.replaceChildren(empty);
      finishTransition();
      return;
    }

    const fragment = document.createDocumentFragment();
    const isStrict = $('strictDictToggle').checked;
    displayedDomains.forEach((item, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'domain-card';
      card.dataset.domain = item.domain;
      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = `${index + 1}. ${item.domain}`;
      const meta = document.createElement('span');
      meta.className = 'domain-card-meta';
      const partnerLength = Math.max(2, Math.floor(Number(item.length) || String(item.partnerPart || '').length || 2));
      const labelLength = String(item.rawCombo || item.domain.split('.')[0] || '').length;
      const partnerKind = item.isBrandable ? 'partner component' : 'partner word';
      const lengthTier = partnerLength >= 6 ? 6 : partnerLength;
      card.title = `Copy ${item.domain}. ${partnerKind}: ${partnerLength} letters. Total domain label: ${labelLength} characters (root keyword included; extension excluded).`;
      card.setAttribute('aria-label', `Copy ${item.domain}; ${partnerKind} has ${partnerLength} letters; total domain label has ${labelLength} characters, excluding the extension`);
      const lengthLabel = lengthTier === 6 ? '6L+' : `${partnerLength}L`;
      const length = document.createElement('span');
      length.className = `length-pill length-pill--${lengthTier}`;
      length.dataset.labelLength = String(labelLength);
      length.dataset.partnerLength = String(partnerLength);
      length.title = `${partnerKind}: ${partnerLength} letters. Total domain label: ${labelLength} characters (root keyword included; extension excluded).`;
      length.setAttribute('aria-label', `${lengthLabel} ${partnerKind}; ${partnerLength} letters. Total domain label: ${labelLength} characters, excluding the extension`);
      const lengthIcon = document.createElement('span');
      lengthIcon.className = 'length-pill-icon';
      lengthIcon.setAttribute('aria-hidden', 'true');
      lengthIcon.textContent = ({ 2: '✦', 3: '◈', 4: '◆', 5: '▰', 6: '↗' })[lengthTier];
      const lengthText = document.createElement('span');
      lengthText.textContent = lengthLabel;
      length.append(lengthIcon, lengthText);
      meta.append(length);
      if (isStrict) {
        const mark = document.createElement('span');
        mark.className = 'verified-mark';
        mark.textContent = '•';
        mark.title = 'Built-in curated word list; not a dictionary verification';
        mark.setAttribute('aria-label', 'Curated word-list mode');
        meta.append(mark);
      }
      card.append(name, meta);
      fragment.append(card);
    });
    grid.replaceChildren(fragment);
    finishTransition();
  }

  async function copyTextToClipboard(text, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard permission is unavailable.');
      }
      showToast(successMessage);
    } catch (error) {
      showToast('Could not copy. Please select and copy the text manually.');
    }
  }

  function copyAllDomains() {
    if (!allGeneratedDomains.length) {
      showToast('Generate a batch before copying.');
      return;
    }
    copyTextToClipboard(allGeneratedDomains.map((item) => item.domain).join('\n'), `Copied ${allGeneratedDomains.length} domain ideas.`);
  }

  function showToast(message) {
    const toast = $('toast');
    $('toastMsg').textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  function csvCell(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTxt() {
    if (!allGeneratedDomains.length) {
      showToast('Generate a batch before exporting.');
      return;
    }
    const filename = `domain-ideas-${sanitizeRoot($('rootInput').value)}-${allGeneratedDomains.length}.txt`;
    downloadBlob(new Blob([allGeneratedDomains.map((item) => item.domain).join('\n')], { type: 'text/plain;charset=utf-8' }), filename);
    showToast('TXT shortlist downloaded.');
  }

  function exportCsv() {
    if (!allGeneratedDomains.length) {
      showToast('Generate a batch before exporting.');
      return;
    }
    const rows = [['ID', 'Domain', 'Root keyword', 'Partner word / component', 'Partner length', 'Placement', 'Extension']];
    allGeneratedDomains.forEach((item, index) => rows.push([
      String(index + 1), item.domain, item.rootPart, item.partnerPart, String(item.length), item.isPrefix ? 'Root first' : 'Root last', item.tld
    ]));
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const filename = `domain-ideas-${sanitizeRoot($('rootInput').value)}-${allGeneratedDomains.length}.csv`;
    downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), filename);
    showToast('CSV shortlist downloaded.');
  }

  function scheduleGeneration() {
    window.clearTimeout(generationTimer);
    generationTimer = window.setTimeout(() => {
      updateCategoryBadge();
      runGeneration();
    }, 120);
  }

  function bindEvents() {
    $('rootInput').addEventListener('input', scheduleGeneration);
    $('rootInput').addEventListener('blur', () => {
      $('rootInput').value = sanitizeRoot($('rootInput').value);
      updateCategoryBadge();
      runGeneration();
    });
    $('brainModeSelect').addEventListener('change', () => {
      updateCategoryBadge();
      runGeneration();
    });
    $('countPresetSelect').addEventListener('change', () => {
      const preset = $('countPresetSelect').value;
      if (preset === 'custom') {
        $('customCountInput').focus();
      } else {
        $('customCountInput').value = preset;
      }
      runGeneration();
    });
    $('customCountInput').addEventListener('change', () => runGeneration());
    $('extInput').addEventListener('input', scheduleGeneration);
    $('extInput').addEventListener('blur', () => runGeneration());
    $('placementSelect').addEventListener('change', () => runGeneration());
    $('camelCaseToggle').addEventListener('change', updateNamingStyle);
    $('strictDictToggle').addEventListener('input', handleStrictModeToggle);
    $('strictDictToggle').addEventListener('change', handleStrictModeToggle);
    $('brandableModeToggle').addEventListener('input', handleBrandableModeToggle);
    $('brandableModeToggle').addEventListener('change', handleBrandableModeToggle);
    window.addEventListener('pageshow', syncRestoredModeState);
    $('lenAll').addEventListener('change', () => {
      LENGTHS.forEach((length) => { $(`len${length}`).checked = $('lenAll').checked; });
      updateCheckboxUI();
      runGeneration();
    });
    document.querySelectorAll('.len-checkbox').forEach((checkbox) => checkbox.addEventListener('change', () => {
      updateCheckboxUI();
      runGeneration();
    }));
    $('inSearchInput').addEventListener('input', applyInstantSearch);
    $('generateBtn').addEventListener('click', generateFromSettings);
    $('generatorSettingsAccordionToggle').addEventListener('click', () => {
      const expanded = $('generatorSettingsAccordionToggle').getAttribute('aria-expanded') !== 'true';
      setAccordionExpanded(expanded);
    });
    $('generatorSettingsFab').addEventListener('click', () => {
      if ($('generator').classList.contains('is-open')) closeSettingsDrawer();
      else openSettingsDrawer();
    });
    $('generatorSettingsClose').addEventListener('click', () => closeSettingsDrawer());
    $('settingsBackdrop').addEventListener('click', () => closeSettingsDrawer());
    $('exportMenuToggle').addEventListener('click', () => {
      const menu = $('exportSpeedMenu');
      const open = menu.hidden;
      menu.hidden = !open;
      $('exportMenuToggle').setAttribute('aria-expanded', String(open));
      $('exportMenuToggle').setAttribute('aria-label', open ? 'Close export menu' : 'Open export menu');
    });
    $('copyAllTopBtn').addEventListener('click', copyAllDomains);
    $('copyAllMobileBtn').addEventListener('click', () => { closeExportMenu(); copyAllDomains(); });
    $('exportTxtBtn').addEventListener('click', exportTxt);
    $('exportTxtMobileBtn').addEventListener('click', () => { closeExportMenu(); exportTxt(); });
    $('exportCsvBtn').addEventListener('click', exportCsv);
    $('exportCsvMobileBtn').addEventListener('click', () => { closeExportMenu(); exportCsv(); });
    window.addEventListener('keydown', (event) => {
      const drawerOpen = controlsMode === 'drawer' && $('generator').classList.contains('is-open');
      if (event.key === 'Escape') {
        if (drawerOpen) closeSettingsDrawer();
        closeExportMenu();
        return;
      }
      if (event.key !== 'Tab' || !drawerOpen) return;

      const panel = $('generator');
      if (typeof panel.querySelectorAll !== 'function') return;
      const focusable = Array.from(panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener('click', (event) => {
      const dial = $('exportSpeedDial');
      if (typeof dial.contains === 'function' && !dial.contains(event.target) && !$('exportSpeedMenu').hidden) closeExportMenu();
    });
    $('domainGrid').addEventListener('click', (event) => {
      const card = event.target.closest('button[data-domain]');
      if (card) copyTextToClipboard(card.dataset.domain, `Copied ${card.dataset.domain}.`);
    });
    document.querySelectorAll('[data-extension]').forEach((button) => button.addEventListener('click', () => {
      $('extInput').value = button.dataset.extension;
      runGeneration();
    }));
  }

  function init() {
    setupControlsExperience();
    bindEvents();
    updateCheckboxUI();
    updateStrictUI();
    updateBrandableUI();
    updateCategoryBadge();
    lastStrictMode = $('strictDictToggle').checked;
    lastBrandableMode = $('brandableModeToggle').checked;
    runGeneration();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
