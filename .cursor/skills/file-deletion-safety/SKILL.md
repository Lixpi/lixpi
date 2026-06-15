---
name: file-deletion-safety
description: 'Mandatory Lixpi deletion safety rule. Use before deleting, removing, moving, renaming, cleaning up, reverting, restoring, replacing files, applying delete-file patches, or running commands that may remove repository files.'
---

# File Deletion Safety

Read and follow `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md#file-deletion-permission-rule` before any edit or command that could delete, remove, move, rename, replace, clean up, revert, or restore repository files.

The rule is mandatory: ask the user to confirm exact file path(s) before deleting repository files. Delete only confirmed path(s); otherwise keep them and report cleanup candidates.
