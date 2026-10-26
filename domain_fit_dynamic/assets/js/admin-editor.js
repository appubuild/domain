/* Small self-hosted rich-text helper. The server sanitizes every saved document. */
(() => {
  'use strict';
  const textarea = document.querySelector('[data-rich-source]') || document.getElementById('bodyHtml');
  const editor = document.querySelector('[data-rich-editor]');
  const toolbar = document.querySelector('[data-editor-toolbar]');
  if (!textarea || !editor || !toolbar) return;
  editor.innerHTML = textarea.value;
  textarea.hidden = true;
  editor.hidden = false;
  toolbar.hidden = false;
  const sync = () => { textarea.value = editor.innerHTML; };
  editor.addEventListener('input', sync);
  editor.addEventListener('blur', sync);
  editor.closest('form')?.addEventListener('submit', sync);
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-command]');
    if (!button) return;
    const command = button.dataset.command;
    let value = button.dataset.value || null;
    if (command === 'createLink') {
      value = window.prompt('Enter a URL (HTTPS or a local path):', 'https://');
      if (!value) return;
      const trimmed = value.trim();
      if (!/^https:\/\//i.test(trimmed) && !/^\/(?!\/)/.test(trimmed) && !/^mailto:/i.test(trimmed)) {
        window.alert('Use an HTTPS, mailto, or local URL.');
        return;
      }
      value = trimmed;
    }
    editor.focus();
    if (command === 'formatBlock' && value) value = `<${value}>`;
    document.execCommand(command, false, value);
    sync();
  });
})();
