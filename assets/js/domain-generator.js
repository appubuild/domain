/* Domain generator interactions and rendering. Original word data is loaded first. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LENGTHS = [2, 3, 4, 5, 6];
  const MAX_RESULTS = 2000;
  let allGeneratedDomains = [];
  let displayedDomains = [];
  let toastTimer;
  let generationTimer;

  const ONSETS = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'qu', 'r', 's', 't', 'v', 'w', 'x', 'y', 'z', 'bl', 'br', 'ch', 'cl', 'cr', 'fl', 'gl', 'pr', 'st', 'tr'];
  const NUCLEI = ['a', 'e', 'i', 'o', 'u'];
  const CODAS = ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'x'];

  const CATEGORY_LABELS = {
    fintech: 'Fintech / payments',
    tech_ai: 'Technology / AI',
    saas_action: 'SaaS / productivity',
    smart: 'General brand'
  };
  const CATEGORY_PREFERRED_WORDS = {
    fintech: ['cash', 'bank', 'coin', 'fund', 'pay', 'card', 'safe', 'mint', 'wallet', 'vault', 'credit', 'trust', 'market', 'payout', 'loan', 'earn', 'flow', 'save', 'wealth', 'money'],
    tech_ai: ['byte', 'code', 'data', 'node', 'mesh', 'grid', 'core', 'tech', 'cloud', 'script', 'vector', 'neural', 'server', 'signal', 'matrix', 'engine', 'model', 'robot', 'logic', 'pixel'],
    saas_action: ['work', 'task', 'flow', 'team', 'lead', 'run', 'grow', 'jump', 'dash', 'lift', 'sync', 'track', 'form', 'desk', 'hire', 'meet', 'boost', 'focus', 'build', 'sprint']
  };

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
    const isStrict = $('strictDictToggle').checked;
    $('strictBanner').classList.toggle('is-creative', !isStrict);
    $('strictIconBadge').textContent = isStrict ? '✓' : '✦';
    $('strictStatusBadge').textContent = isStrict ? 'Curated list' : 'Creative allowed';
    $('strictDescText').textContent = isStrict
      ? 'Uses the built-in word list only. The list is curated for this tool but is not a dictionary or trademark certification.'
      : 'Adds invented and synthetic brandable syllables to the built-in list. Review every suggestion for pronunciation, meaning, and existing use.';
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

    const description = allSelected
      ? 'Filter: all lengths (2–6 letters)'
      : `Filter: ${selected.slice().sort((a, b) => a - b).map((length) => `${length} letters`).join(', ')}`;
    $('activeLengthDesc').textContent = description;
  }

  function buildWordPool(lengths, neededWords, isStrict) {
    const pool = [];
    const seen = new Set();
    lengths.forEach((length) => {
      (VERIFIED_DICTIONARY[length] || []).forEach((word) => {
        if (word.length === length && !seen.has(word)) {
          seen.add(word);
          pool.push(word);
        }
      });
    });

    if (!isStrict) {
      lengths.forEach((length) => {
        (CREATIVE_BRANDABLES[length] || []).forEach((word) => {
          if (word.length === length && !seen.has(word)) {
            seen.add(word);
            pool.push(word);
          }
        });
      });
      let misses = 0;
      while (pool.length < neededWords && misses < 100) {
        const length = lengths[Math.floor(Math.random() * lengths.length)];
        const word = synthesizeBrandableWord(length, seen);
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

    allGeneratedDomains = generateDomains(root, extension, placement, lengths.length ? lengths : [3], requested, camelCase, isStrict, category);
    $('btnCountBadge').textContent = String(allGeneratedDomains.length);
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
      card.title = `Copy ${item.domain}`;
      card.setAttribute('aria-label', `Copy ${item.domain}`);

      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = `${index + 1}. ${item.domain}`;
      const meta = document.createElement('span');
      meta.className = 'domain-card-meta';
      const length = document.createElement('span');
      length.className = 'length-pill';
      length.textContent = `${item.length}L`;
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
    const rows = [['ID', 'Domain', 'Root keyword', 'Matching word', 'Word length', 'Placement', 'Extension']];
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
    $('strictDictToggle').addEventListener('change', () => {
      updateStrictUI();
      runGeneration();
    });
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
    $('generateBtn').addEventListener('click', () => runGeneration(true));
    $('copyAllTopBtn').addEventListener('click', copyAllDomains);
    $('exportTxtBtn').addEventListener('click', exportTxt);
    $('exportCsvBtn').addEventListener('click', exportCsv);
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
    bindEvents();
    updateCheckboxUI();
    updateStrictUI();
    updateCategoryBadge();
    runGeneration();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
