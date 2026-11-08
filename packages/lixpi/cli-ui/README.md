# CLI UI

The developer tools under `dev-tools/` ask their questions in a terminal, inside Docker. This package holds the parts they share, so the configuration wizard, the skill installer and the dev console look and behave the same. It builds on Clack and has no other runtime dependencies.

| Import | Contents |
|---|---|
| `@lixpi/cli-ui/prompt-session` | `showWizardIntro` for the title bar, `renderInstructionFooter` for the guide below every menu, and `unwrapPrompt` with `PromptCancelled` so a wizard handles cancellation once around all its questions |
| `@lixpi/cli-ui/environment-files` | `listEnvironmentFiles` for the repository's `.env.*` files |
| `@lixpi/cli-ui/select-menu` | `selectMenu`, a single-choice menu that opens on its first option unless given an initial value. Like the tree, it marks the focused row with a chevron |
| `@lixpi/cli-ui/tree-multiselect-prompt` | `TreeMultiSelectPrompt`, a Clack-styled multiselect for trees of any depth, with optional horizontal radio rows above the tree and preset rows inside it that apply a fixed selection |
| `@lixpi/cli-ui/tree-selection` | `TreeSelection`, the prompt's selection model. It stores selection on leaves and derives each group's state from them |
| `@lixpi/cli-ui/secret-input` | `SecretInputPrompt`, a chunk-based input for long credentials |

`SecretInputPrompt` requires an interactive terminal, reads input in chunks, and displays a bounded character count without echoing the secret. It supports ordinary and bracketed paste, Backspace, Ctrl+U to clear, and Ctrl+C to cancel. Bracketed clipboard newlines stay in the value until validation; they do not submit the prompt. The caller supplies validation and handles the Clack cancellation symbol. Submission and cancellation restore terminal mode and remove the prompt's listeners. There is no configured input-length cap.

## Using it from a tool's image

A tool lists `@lixpi/cli-ui` as a `workspace:*` dependency and adds `packages/lixpi/cli-ui` to its `pnpm-workspace.yaml`. Its Dockerfile copies that directory before `pnpm install`, which means the build context has to be the repository root. Its Compose service then bind-mounts `src/` read-only over the copy, so edits to this package apply on the next run. A change to this package's dependencies needs an image rebuild.

## Verification

When `CODING_AGENTS_TEST_EXECUTION_MODE` permits, run the tests through the shared TypeScript test runner. The secret-input tests use the image's `script` utility to exercise a real pseudo-terminal, including typing, a 1 MiB paste, cancellation, and the Clack prompts before and after it.

```bash
docker compose --env-file .env.<stage> -f infrastructure/docker/utilities/code-quality/docker-compose.typescript-test-runner.yml --profile dev run --rm --no-deps -T lixpi-typescript-test-runner shared cli-ui
```
