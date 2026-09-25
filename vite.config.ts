import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content-Security-Policy, injected as the very first <head> tag of production
 * builds (Vite's dev server needs inline styles for HMR). Everything ships from our own
 * origin. When ENCORE_BASE is set (CI → GitHub Pages), script/style/font sources are also
 * scoped to that path, because the github.io origin is shared with other sites.
 */
function csp(): Plugin {
  const base = process.env.ENCORE_BASE; // e.g. https://caseyrmorrison.github.io/encore/
  const self = base ? `${base}assets/` : "'self'";
  const policy = [
    "default-src 'none'",
    `script-src ${self}`,
    `style-src ${self}`,
    `font-src ${self}`,
    "img-src 'self' data: blob:",
    "connect-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
  return {
    name: 'encore-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
      },
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
    modulePreload: { polyfill: false },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
