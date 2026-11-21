// Applies the saved theme before first paint to avoid a flash.
(function () {
  try {
    var t = localStorage.getItem('voris-theme') || 'dark';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  } catch (e) {}
})();
