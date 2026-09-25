import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content-Security-Policy, injected only into production builds (Vite's dev
 * server needs inline styles for HMR). Everything ships from our own origin.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "manifest-src 'self'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'encore-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [csp()],
  server: { port: 5310, strictPort: true },
  preview: { port: 5311, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1400,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
