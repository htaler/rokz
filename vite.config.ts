import { defineConfig } from 'vite';

export default defineConfig({
  /**
   * Relative asset paths, so the build runs from a domain root or any
   * subfolder without rewriting. Cloudflare Pages serves from the root, but
   * this also covers preview deployments and project-scoped hosts.
   */
  base: './',
  server: { port: 5180, strictPort: true },
  build: { assetsDir: 'assets' },
});
