import { defineConfig } from 'vite';

// Relative base so the build runs from any folder (the Playgama zip serves it from one of theirs).
export default defineConfig({
  base: './',
  server: { host: true },
});
