// Tailwind v4 exposes itself as a PostCSS plugin; there is no tailwind.config.js
// in v4 — design tokens live in CSS via @theme (see src/app/globals.css, owned
// by the ui-shell stream and generated from app.config branding colours).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
