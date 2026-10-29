/* Local Quill-based CMS editor and publishing helpers. Content is sanitized again by PHP on save. */
(() => {
  'use strict';

  const slugify = (value) => {
    let text = String(value || '').trim();
    if (typeof text.normalize === 'function') text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  };

  document.querySelectorAll('[data-publish-form]').forEach((form) => {
    const title = form.querySelector('[data-slug-source]');
    const slug = form.querySelector('[data-slug-target]');
    const slugToggle = form.querySelector('[data-slug-manual-toggle]');
    const slugPreview = form.querySelector('[data-slug-preview]');
    const previewUrl = form.querySelector('[data-preview-url]');
    const prefix = slugPreview?.dataset.urlPrefix || '';

    const updateSlug = () => {
      if (!slug) return;
      const nextSlug = slugify(slug.value || title?.value || '');
      if (slug.dataset.slugMode === 'auto') slug.value = nextSlug;
      const active = slug.value || 'your-post';
      if (slugPreview) slugPreview.textContent = prefix + active;
      if (previewUrl) previewUrl.textContent = prefix + active;
      updateSeoPreview();
    };
    if (slug && slugToggle) {
      if (slug.dataset.slugMode === 'manual') {
        slug.readOnly = false;
        slugToggle.textContent = 'Use automatic slug';
      }
      slugToggle.addEventListener('click', () => {
        const useAuto = slug.dataset.slugMode !== 'auto';
        slug.dataset.slugMode = useAuto ? 'auto' : 'manual';
        slug.readOnly = useAuto;
        slugToggle.textContent = useAuto ? 'Edit manually' : 'Use automatic slug';
        if (useAuto) updateSlug();
        else slug.focus();
      });
      slug.addEventListener('input', updateSlug);
      title?.addEventListener('input', updateSlug);
    }

    const seoTitleInput = form.querySelector('[data-seo-title]');
    const seoTitleSource = form.querySelector('[data-seo-title-source]');
    const seoDescriptionInput = form.querySelector('[data-seo-description]');
    const excerpt = form.querySelector('#excerpt');
    const updateSeoPreview = () => {
      const titleText = seoTitleInput?.value.trim() || seoTitleSource?.value.trim() || 'Page title preview';
      const descriptionText = seoDescriptionInput?.value.trim() || excerpt?.value.trim() || 'Search description preview';
      const titlePreview = form.querySelector('[data-serp-title]');
      const descriptionPreview = form.querySelector('[data-serp-description]');
      const urlPreview = form.querySelector('[data-serp-url]');
      if (titlePreview) titlePreview.textContent = titleText;
      if (descriptionPreview) descriptionPreview.textContent = descriptionText;
      if (urlPreview) urlPreview.textContent = prefix + (slug?.value || 'your-page');
      const titleCount = form.querySelector('[data-seo-title-count]');
      const descriptionCount = form.querySelector('[data-seo-description-count]');
      if (titleCount) titleCount.textContent = String((seoTitleInput?.value || '').length);
      if (descriptionCount) descriptionCount.textContent = String((seoDescriptionInput?.value || '').length);
    };
    seoTitleInput?.addEventListener('input', updateSeoPreview);
    seoTitleSource?.addEventListener('input', updateSeoPreview);
    seoDescriptionInput?.addEventListener('input', updateSeoPreview);
    excerpt?.addEventListener('input', updateSeoPreview);
    updateSeoPreview();
    updateSlug();

    const status = form.querySelector('[data-publish-status]');
    const scheduleFields = form.querySelector('[data-schedule-fields]');
    const publishedFields = form.querySelector('[data-published-fields]');
    const syncPublishFields = () => {
      if (scheduleFields) scheduleFields.hidden = status?.value !== 'scheduled';
      if (publishedFields) publishedFields.hidden = status?.value !== 'published';
    };
    status?.addEventListener('change', syncPublishFields);
    syncPublishFields();

    const tagHidden = form.querySelector('[data-tags-hidden]');
    const tagInput = form.querySelector('[data-tag-entry] > input[type="text"]');
    const tagList = form.querySelector('[data-tag-chip-list]');
    if (tagHidden && tagInput && tagList) {
      let tags = tagHidden.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 20);
      const syncTags = () => {
        tags = [...new Set(tags.map((value) => value.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
        tagHidden.value = tags.join(', ');
        tagList.replaceChildren();
        tags.forEach((tag, index) => {
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          const text = document.createElement('span');
          text.textContent = tag;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.setAttribute('aria-label', `Remove tag ${tag}`);
          remove.textContent = '×';
          remove.addEventListener('click', () => { tags.splice(index, 1); syncTags(); });
          chip.append(text, remove);
          tagList.append(chip);
        });
      };
      const addTag = (raw) => {
        const value = raw.trim().replace(/^[,\s]+|[,\s]+$/g, '').slice(0, 60);
        if (value && tags.length < 20 && !tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) tags.push(value);
        syncTags();
      };
      tagInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          addTag(tagInput.value);
          tagInput.value = '';
        } else if (event.key === 'Backspace' && tagInput.value === '' && tags.length) {
          tags.pop();
          syncTags();
        }
      });
      tagInput.addEventListener('input', () => {
        if (tagInput.value.includes(',')) {
          tagInput.value.split(',').forEach(addTag);
          tagInput.value = '';
        }
      });
      form.addEventListener('submit', () => { if (tagInput.value.trim()) addTag(tagInput.value); });
      syncTags();
    }

    const featuredUpload = form.querySelector('[data-featured-upload]');
    const featuredPreview = form.querySelector('[data-featured-preview]');
    const removeFeaturedInput = form.querySelector('[data-remove-featured]');
    const removeFeaturedButton = form.querySelector('[data-remove-featured-button]');
    const featuredManager = form.querySelector('[data-featured-manager]');
    const ogImageInput = form.querySelector('#og_image');
    const setImagePreview = (container, file, altText) => {
      if (!container || !file) return;
      const url = URL.createObjectURL(file);
      container.replaceChildren();
      const image = document.createElement('img');
      image.src = url;
      image.alt = altText || 'Image preview';
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      container.append(image);
    };
    featuredUpload?.addEventListener('change', () => {
      const file = featuredUpload.files?.[0];
      if (!file) return;
      setImagePreview(featuredPreview, file, form.querySelector('#featured_image_alt')?.value);
      if (removeFeaturedInput) removeFeaturedInput.value = '';
      if (removeFeaturedButton) removeFeaturedButton.hidden = false;
    });
    form.querySelector('#featured_image_alt')?.addEventListener('input', (event) => {
      const image = featuredPreview?.querySelector('img');
      if (image && image.src.startsWith('blob:')) image.alt = event.target.value;
    });
    removeFeaturedButton?.addEventListener('click', () => {
      const currentImage = featuredManager?.dataset.currentImage || '';
      if (currentImage && ogImageInput?.value.trim() === currentImage) ogImageInput.value = '';
      if (removeFeaturedInput) removeFeaturedInput.value = '1';
      if (featuredUpload) featuredUpload.value = '';
      featuredPreview?.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'No featured image' }));
      removeFeaturedButton.hidden = true;
    });

    const ogUpload = form.querySelector('[data-og-upload]');
    const ogPreview = form.querySelector('[data-og-preview]');
    const clearOgInput = form.querySelector('[data-clear-og-image]');
    const clearOgButton = form.querySelector('[data-clear-og-button]');
    ogUpload?.addEventListener('change', () => {
      const file = ogUpload.files?.[0];
      if (!file) return;
      setImagePreview(ogPreview, file, 'OpenGraph image preview');
      if (clearOgInput) clearOgInput.value = '';
      if (clearOgButton) clearOgButton.hidden = false;
    });
    clearOgButton?.addEventListener('click', () => {
      if (clearOgInput) clearOgInput.value = '1';
      if (ogUpload) ogUpload.value = '';
      if (ogImageInput) ogImageInput.value = '';
      ogPreview?.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'No social image' }));
      clearOgButton.hidden = true;
    });
  });

  document.querySelectorAll('[data-rich-field]').forEach((field) => {
    const form = field.closest('form');
    const source = field.querySelector('[data-quill-source]');
    const host = field.querySelector('[data-quill-editor]');
    const toolbar = field.querySelector('[data-quill-toolbar]') || form?.querySelector('[data-quill-toolbar]');
    const status = form?.querySelector('[data-editor-status]');
    if (!source || !host || !toolbar || !form) return;
    if (typeof window.Quill !== 'function') {
      if (status) { status.textContent = 'The local editor library did not load. Check that the Quill JS asset is uploaded; the HTML fallback is open below.'; status.dataset.state = 'error'; }
      source.hidden = false;
      source.required = true;
      toolbar.hidden = true;
      host.hidden = true;
      return;
    }
    try {
      let quill;
      const imageInput = document.createElement('input');
      imageInput.type = 'file';
      imageInput.accept = 'image/jpeg,image/png,image/webp';
      imageInput.hidden = true;
      field.append(imageInput);
      let savedRange = null;
      let uploadBusy = false;
      const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.dataset.state = isError ? 'error' : 'ready';
      };
      const getRange = () => quill.getSelection() || { index: Math.max(0, quill.getLength() - 1), length: 0 };
      const uploadImage = async (file, targetRange) => {
        if (!file || uploadBusy) return;
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          setStatus('Use a valid JPEG, PNG or WebP image up to 5 MB.', true);
          return;
        }
        const endpoint = form.dataset.editorImageEndpoint;
        const token = form.querySelector('input[name="_csrf"]')?.value || '';
        if (!endpoint || !token) { setStatus('Image upload could not be initialized.', true); return; }
        uploadBusy = true;
        setStatus('Uploading image…');
        const payload = new FormData();
        payload.append('image', file);
        payload.append('_csrf', token);
        try {
          const response = await fetch(endpoint, { method: 'POST', body: payload, credentials: 'same-origin', headers: { Accept: 'application/json' } });
          const result = await response.json();
          if (!response.ok || !result.url) throw new Error(result.error || 'Image upload failed.');
          const range = targetRange || getRange();
          quill.setSelection(range.index, 0, 'silent');
          quill.insertEmbed(range.index, 'image', result.url, 'user');
          quill.setSelection(range.index + 1, 0, 'silent');
          setStatus('Image uploaded and inserted.');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Image upload failed.', true);
        } finally {
          uploadBusy = false;
          imageInput.value = '';
        }
      };
      const openImagePicker = () => {
        savedRange = getRange();
        imageInput.click();
      };
      imageInput.addEventListener('change', () => uploadImage(imageInput.files?.[0], savedRange));

      quill = new window.Quill(host, {
        theme: 'snow',
        placeholder: 'Write the article or page content…',
        formats: ['header','bold','italic','underline','strike','blockquote','code-block','list','link','image','table'],
        modules: {
          toolbar: { container: toolbar, handlers: { image: openImagePicker } },
          history: { delay: 900, maxStack: 100, userOnly: true },
          table: true,
        },
      });
      if (source.value.trim()) quill.clipboard.dangerouslyPasteHTML(0, source.value, 'silent');
      source.hidden = true;
      source.required = false;
      host.hidden = false;
      toolbar.hidden = false;
      const sync = () => { source.value = quill.root.innerHTML; };
      quill.on('text-change', sync);
      sync();
      setStatus('Local editor ready');

      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-editor-action]');
        if (!button) return;
        event.preventDefault();
        const action = button.dataset.editorAction;
        if (action === 'table') {
          const table = quill.getModule('table');
          if (!table) { setStatus('Table controls are unavailable.', true); return; }
          if (!quill.getSelection()) quill.setSelection(Math.max(0, quill.getLength() - 1), 0, 'silent');
          table.insertTable(3, 3);
          setStatus('3 × 3 table inserted.');
        } else if (action === 'undo') {
          quill.history.undo();
        } else if (action === 'redo') {
          quill.history.redo();
        }
      });

      const uploadClipboardImages = async (event, files) => {
        const images = files.filter((file) => file && file.type.startsWith('image/')).slice(0, 4);
        if (!images.length) return;
        event.preventDefault();
        let index = getRange().index;
        for (const file of images) {
          await uploadImage(file, { index, length: 0 });
          index += 1;
        }
      };
      host.addEventListener('paste', (event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const files = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
        void uploadClipboardImages(event, files);
      }, true);
      host.addEventListener('drop', (event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        void uploadClipboardImages(event, files);
      }, true);
      form.addEventListener('submit', (event) => {
        sync();
        const hasContent = quill.getText().trim() !== '' || quill.root.querySelector('img,table');
        if (!hasContent) {
          event.preventDefault();
          setStatus('Add article content before saving.', true);
          host.focus();
        }
      });
    } catch (error) {
      console.error('Quill editor initialization failed.', error);
      if (status) { status.textContent = 'Editor unavailable; HTML fallback is active.'; status.dataset.state = 'error'; }
      source.hidden = false;
      source.required = true;
      host.hidden = true;
      toolbar.hidden = true;
    }
  });

  document.querySelectorAll('[data-category-dialog]').forEach((dialog) => {
    const openButton = document.querySelector('[data-open-category-dialog]');
    const closeButton = dialog.querySelector('[data-close-category-dialog]');
    const form = dialog.querySelector('[data-category-create-form]');
    const list = document.querySelector('[data-category-list]');
    const message = dialog.querySelector('[data-category-message]');
    openButton?.addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector('input[name="name"]')?.focus();
    });
    closeButton?.addEventListener('click', () => dialog.close?.());
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (message) message.textContent = 'Creating category…';
      const params = new URLSearchParams(new FormData(form));
      try {
        const response = await fetch(form.dataset.endpoint, { method: 'POST', body: params, credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (!response.ok || !result.category) throw new Error(result.error || 'Category could not be created.');
        const category = result.category;
        if (list) {
          const existing = list.querySelector(`input[value="${CSS.escape(String(category.id))}"]`);
          if (existing) {
            existing.checked = true;
          } else {
            const label = document.createElement('label');
            label.className = 'category-check';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'category_ids[]';
            checkbox.value = String(category.id);
            checkbox.checked = true;
            const span = document.createElement('span');
            span.textContent = category.name;
            label.append(checkbox, span);
            list.append(label);
          }
        }
        dialog.close?.();
        form.reset();
        if (message) message.textContent = result.created ? 'Category created and selected.' : 'Existing category selected.';
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Category could not be created.';
      }
    });
  });
})();
