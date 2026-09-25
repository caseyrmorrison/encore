# Security

ENCORE is a fully static, single-player web game. There is no backend, no account system,
no analytics and no third-party requests.

## Posture

- **Strict CSP** (`default-src 'self'`, no inline scripts, no `eval`) injected at build time.
- **No `innerHTML`.** All DOM text goes through `textContent`; ESLint forbids `innerHTML`/`outerHTML`.
- **Untrusted persistence.** `localStorage` saves are size-capped, parsed in `try/catch`,
  whitelisted and clamped (`src/core/save.ts`, covered by tests incl. prototype-pollution).
- **Untrusted URLs.** Seed codes are validated against `^[A-Z0-9]{1,10}$` before use.
- **Dev tooling never ships.** The debug console API is compiled out of production builds.
- **Supply chain.** Three runtime dependencies (`three`, `postprocessing`, `@fontsource/*`),
  lockfile-pinned, `npm audit` in CI, Dependabot weekly, GitHub Actions pinned to commit SHAs
  with least-privilege permissions.

## Reporting

Please open a private security advisory on the repository.
