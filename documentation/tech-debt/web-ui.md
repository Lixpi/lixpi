# Web UI — Tech Debt

## Payment and account UI awaiting a @lixpi/ui-kit rewrite

`views/layouts/layout.svelte` and `components/subscription-management/*.svelte` were built on shadcn-svelte. Now that shadcn-svelte, Tailwind and `bits-ui` are gone, the markup that depended on them is commented out in place: the user drawer, the theme switcher, the add-funds dialog, the top-up form and the saved-cards table.

**Remove by**: rebuilding those surfaces on `@lixpi/ui-kit` and SCSS, then deleting the commented-out blocks.
