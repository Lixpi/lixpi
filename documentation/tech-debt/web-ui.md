# Web UI — Tech Debt

## shadcn-svelte icon-placeholder stub

Vite alias in `vite.config.ts` redirects `$lib/components/icon-placeholder/icon-placeholder` to an empty stub (`src/shadcn-icon-stub.svelte`). The upstream shadcn-svelte submodule added an icon-placeholder component that imports `@hugeicons/svelte`, `runed`, `zod` and other deps we don't need. UI components import it transitively, breaking Vite resolution.

**Remove by**: dropping shadcn-svelte submodule and copying just our UI components, or pinning to a commit before the icon-placeholder was added. Then delete the stub and the two alias blocks in `vite.config.ts`.

- Issue: https://github.com/Lixpi/lixpi/issues/114
- PR: https://github.com/Lixpi/lixpi/pull/115

---------------------------------------------------------------------------------------------------------------------------
