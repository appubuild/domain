/* Local admin enhancements for responsive ad previews and reviewed Gemini wordbank insertion. */
(() => {
  'use strict';

  const adPresets = ['responsive','leaderboard','mobile_banner','medium_rectangle','billboard','skyscraper'];
  document.querySelectorAll('[data-ad-manager-card]').forEach((card) => {
    const select = card.querySelector('[data-ad-size-select]');
    const preview = card.querySelector('[data-ad-preview]');
    if (!select || !preview) return;
    const updatePreview = () => {
      preview.classList.remove(...adPresets.map((preset) => `ad-size--${preset}`));
      const preset = adPresets.includes(select.value) ? select.value : 'responsive';
      preview.classList.add(`ad-size--${preset}`);
      const hint = preview.querySelector('small');
      if (hint) hint.textContent = `${preset.replaceAll('_',' ')} · IDs required`;
    };
    select.addEventListener('change', updatePreview);
    updatePreview();
  });

  const widget = document.querySelector('[data-gemini-generator]');
  if (!widget) return;
  const generateButton = widget.querySelector('[data-gemini-generate]');
  const insertButton = widget.querySelector('[data-gemini-insert]');
  const nicheInput = widget.querySelector('[data-gemini-niche]');
  const seedsInput = widget.querySelector('[data-gemini-seeds]');
  const categoryInput = widget.querySelector('[data-gemini-category]');
  const status = widget.querySelector('[data-gemini-status]');
  const preview = widget.querySelector('[data-gemini-preview]');
  const tableBody = widget.querySelector('[data-gemini-rows]');
  const count = widget.querySelector('[data-gemini-count]');
  const selectAll = widget.querySelector('[data-gemini-select-all]');
  const selectedCount = widget.querySelector('[data-gemini-selected-count]');
  let previewItems = [];

  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'ready';
  };
  const parseSeeds = () => (seedsInput?.value || '').split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
  const selectedRows = () => Array.from(tableBody?.querySelectorAll('[data-gemini-term]') || []).filter((checkbox) => checkbox.checked);
  const updateSelection = () => {
    const selected = selectedRows();
    if (selectedCount) selectedCount.textContent = `${selected.length} selected`;
    if (insertButton) insertButton.disabled = selected.length === 0;
    if (selectAll) selectAll.checked = selected.length > 0 && selected.length === tableBody.querySelectorAll('[data-gemini-term]').length;
  };
  const callApi = async (payload) => {
    const response = await fetch(widget.dataset.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ ...payload, _csrf: widget.dataset.csrf || '' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Gemini request failed.');
    return result;
  };

  generateButton?.addEventListener('click', async () => {
    const niche = (nicheInput?.value || '').trim();
    const seeds = parseSeeds();
    if (!niche || seeds.length < 3 || seeds.length > 5) {
      setStatus('Enter a niche and three to five seed keywords before generating.', true);
      return;
    }
    generateButton.disabled = true;
    if (insertButton) insertButton.disabled = true;
    setStatus('Requesting a structured Gemini preview. This may take a moment…');
    try {
      const result = await callApi({ action: 'preview', niche, seeds });
      previewItems = Array.isArray(result.items) ? result.items : [];
      tableBody.replaceChildren();
      const fragment = document.createDocumentFragment();
      previewItems.forEach((item) => {
        const row = document.createElement('tr');
        const selectCell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.geminiTerm = '1';
        checkbox.dataset.word = String(item.word || '');
        checkbox.dataset.length = String(item.partner_length || '');
        checkbox.setAttribute('aria-label', `Select ${item.word || 'suggestion'}`);
        checkbox.addEventListener('change', updateSelection);
        selectCell.append(checkbox);
        const wordCell = document.createElement('td');
        const word = document.createElement('strong');
        word.textContent = String(item.word || '');
        wordCell.append(word);
        const lengthCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'admin-badge';
        badge.textContent = `${item.partner_length || ''}L`;
        lengthCell.append(badge);
        const hintCell = document.createElement('td');
        hintCell.textContent = item.term_type_hint === 'curated' ? 'Curated candidate' : 'Brandable';
        const claimCell = document.createElement('td');
        const claim = document.createElement('small');
        claim.textContent = item.model_claimed_english ? 'Model says English candidate — unverified' : 'Coined / uncertain — unverified';
        claimCell.append(claim);
        if (item.note) {
          const note = document.createElement('div');
          note.className = 'gemini-term-note';
          note.textContent = String(item.note);
          claimCell.append(note);
        }
        row.append(selectCell, wordCell, lengthCell, hintCell, claimCell);
        fragment.append(row);
      });
      tableBody.append(fragment);
      if (count) count.textContent = String(previewItems.length);
      if (preview) preview.hidden = previewItems.length === 0;
      if (selectAll) selectAll.checked = true;
      updateSelection();
      setStatus(`${previewItems.length} suggestions ready. ${result.message || 'All terms remain unverified.'}`);
    } catch (error) {
      previewItems = [];
      if (preview) preview.hidden = true;
      setStatus(error instanceof Error ? error.message : 'Gemini preview failed.', true);
    } finally {
      generateButton.disabled = false;
    }
  });

  selectAll?.addEventListener('change', () => {
    tableBody?.querySelectorAll('[data-gemini-term]').forEach((checkbox) => { checkbox.checked = selectAll.checked; });
    updateSelection();
  });

  insertButton?.addEventListener('click', async () => {
    const selected = selectedRows().map((checkbox) => ({ word: checkbox.dataset.word, partner_length: Number(checkbox.dataset.length) }));
    if (!selected.length) return;
    const niche = (nicheInput?.value || '').trim();
    const seeds = parseSeeds();
    const choice = categoryInput?.value || 'create';
    const category = choice === 'create' ? { category_mode: 'create' } : { category_mode: 'existing', category_id: Number(choice) };
    if (!window.confirm(`Insert ${selected.length} Gemini suggestion(s) as unverified brandable terms? They will not be marked as reviewed English.`)) return;
    insertButton.disabled = true;
    setStatus('Adding selected unverified terms to the wordbank…');
    try {
      const result = await callApi({ action: 'insert', niche, seeds, items: selected, ...category });
      setStatus(`${result.inserted} inserted; ${result.duplicates} duplicates skipped. Category: ${result.category_label}. ${result.message}`);
      if (result.inserted > 0) window.setTimeout(() => window.location.reload(), 2200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Bulk insert failed.', true);
      updateSelection();
    }
  });
})();
