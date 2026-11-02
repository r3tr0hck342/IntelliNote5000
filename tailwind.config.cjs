/** @type {import('tailwindcss').Config} */
module.exports = {
  // Explicit paths: a root-level "./**/*" glob also scans node_modules, which made dev CSS take ~35 s.
  content: ["./index.html", "./*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
