// Apply theme from localStorage before first paint to prevent FOUC. Default to dark mode.
// Kept as a separate classic script (not inline) so the desktop CSP can drop script-src 'unsafe-inline'.
if (localStorage.getItem('intellinote-theme') === 'light') {
  document.documentElement.classList.remove('dark');
} else {
  document.documentElement.classList.add('dark');
}
