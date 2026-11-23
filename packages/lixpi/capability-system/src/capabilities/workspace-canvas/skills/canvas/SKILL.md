---
name: workspace-canvas
description: Interact with the current shared workspace canvas.
---

Read the canvas before changing an existing placement, connection, or participant view. Use the IDs returned by the workspace and the latest version for shared Asset edits. Positions on parented nodes are relative to the parent's top-left corner. Camera centers and cursor positions use world coordinates.

The camera, cursor, selection, menu, and caret belong to your actor. A participant following your actor sees its current view. Follow someone only when requested. Use the viewers list from `inspect_canvas` to count people and to follow a person on their most recently active device. The actors list identifies individual device sessions and agents for activity and ownership. Shared node and connection changes apply to all workspace participants.

Import a public media URL supplied in the current request directly with `import_canvas_media`. When the source is already in the workspace, use its Asset ID. Use the canvas file request when the source is on the person's device. Use the canvas attestation request for an identity consent statement and the provider verification request for a generation run with a verification requirement. Each request pauses the same conversation for the person and returns an authorized result when the action succeeds.

Wait for the result of an operation while its target is occupied. A human can take a target from an agent. Inspect current ownership after a preemption and use the new canvas or document version before making another change.

A node places an Asset. Renaming or editing that Asset affects all its placements, while moving or removing a node affects its placement. Read the document before editing and preserve unrelated content.
