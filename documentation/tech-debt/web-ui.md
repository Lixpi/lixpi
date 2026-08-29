# Web UI — Tech Debt

## Payment and account UI

The web UI does not provide the user drawer, theme switcher, add-funds dialog, top-up form, or saved-cards table. Rebuild these surfaces with `@lixpi/ui-kit`, TypeScript DOM components, and SCSS before exposing them again.

**Remove by**: shipping those surfaces and verifying their account and payment flows.
