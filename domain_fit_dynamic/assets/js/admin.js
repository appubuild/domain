(() => {
  'use strict';
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-confirm]');
    if (form && !window.confirm(form.dataset.confirm || 'Continue with this action?')) event.preventDefault();
  });
})();
