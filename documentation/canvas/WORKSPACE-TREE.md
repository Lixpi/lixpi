---
title: Workspace Tree
description: Saved navigation documents, nested workspace hierarchy, inherited access, and shared ProseMirror sidebar editing.
---

# Workspace Tree

Each organization saves a ProseMirror navigation document containing ordinary paragraphs, headings and nested lists. Workspace list items bind to real workspaces; plain items can group them without creating workspaces. The nearest enclosing workspace item determines a workspace's actual parent. Access and agent delegation follow that workspace hierarchy, skipping plain visual groups.

`@lixpi/prosemirror` supplies the reusable nested-list schema, plugins, custom item NodeViews, drag reordering and edit sessions. Web-ui supplies workspace bindings, edit policies and the sidebar adapter under its navigation component. The API owns hierarchy, authorization, storage and handlers under its workspace services. The same reusable component powers the design-system navigation, whose sidebar is read-only by default. See [Document Kinds and Editors](../platform/DOCUMENT-EDITORS.md) for the generic extension contract.

## Document structure and domain records

Lists are self-contained editor blocks. Each item holds one editable paragraph title and optional nested lists. Headings and standalone paragraphs remain outside complete lists; typing, insertion, paste and dragging cannot put them inside item bodies or split an existing menu around them. A workspace item has a stable workspace id, an editable label and organization tag ids. Its label may be empty. Erasing text never deletes the workspace binding.

The canonical document preserves visual structure that cannot be represented by workspace parents alone. The service derives each workspace's parent, ancestor chain and sibling order from it, and writes those values to workspace metadata and the actual-child index. Plain groups neither grant access nor create agent workspaces. A canonical document contains each live workspace exactly once.

The child index uses base-62 fractional positions. Domain APIs accept neighboring entry ids and compute positions on the server. Position rebalance, workspace moves and heading-section moves remain supported for those APIs within the navigation structure rules; the sidebar edits its document and saves the resulting structure. A styled heading cannot live inside a menu item. Level-zero text created beneath a workspace becomes a plain child list item. Standalone text placement between existing menu siblings is rejected before domain writes, and list-item labels cannot be converted to headings. The older heading-move endpoint also rejects moving a plain list group with nested children because its flat row operation cannot preserve that visual subtree. The canonical navigation save used by editor dragging supports those whole-group moves.

The sidebar has no separate workspace-note action or note paragraph. Domain note metadata is independent of the navigation document. Ordinary paragraphs are independent document content. Workspace tags reference the organization's tag map, so their names and colors remain organization-owned.

## Editing the sidebar

Outside edit mode, the first click opens a workspace immediately. There is no delay waiting for a second click. A double click does not activate twice. Double-clicking anywhere in the editable ProseMirror area enters edit mode and places the caret at the clicked text. Inside edit mode, text supports editor commands within the list constraints. Enter in a workspace title saves the current label immediately and exits editing. It leaves the title and its children intact and never creates or splits an item, including when the caret is in the middle of the label. Plain list items retain ordinary splitting; Enter at the end of a standalone heading creates a paragraph. Cmd/Ctrl+click opens an actionable item without taking away ordinary caret placement.

A single dragIcon overlay serves workspace rows, paragraphs and headings through the same drag controller. A workspace row places its 20px collapse chevron 6px after the title. A circular hover and keyboard-focus background uses the selected-switch blue so collapse is visibly distinct from navigation. The drag icon is an overlay outside the selection color, aligned to the same far-left position at every nesting depth without pushing the title. Drag appears on hover and always uses the selected-item foreground; groups keep chevronDownIcon visible, down when expanded and rotated right when collapsed. The verticalTrippleDots icon overlays the hovered row or ordinary text block with an 8px right inset and opens the shared BubbleMenu with icon controls and the vertical text-style selector without entering text editing. The menu takes focus, hiding an existing caret while preserving editing mode. Text, Heading 1, Heading 2 and Heading 3 are generic insertions; the web-ui adapter adds Workspace using the existing New workspace icon, plus its domain actions. Workspace links form the navigation list; there is no separate Bulleted list option. A new workspace inserted beside another workspace becomes its next sibling below, and can then be nested by dragging. Workspace labels retain their paragraph type and cannot become headings. The bubble menu has no Bold option. Tags remain organization-defined workspace data. Ordinary H1/H2/H3 blocks use distinct compact theme sizes with no vertical padding and a 0.8em top gap and a smaller 0.2em bottom gap. The first visible content node has no heading top gap; the hidden single-organization label does not add one. Ordinary paragraphs have the same proportional bottom gap; workspace labels retain their row spacing.

Escape, clicking outside or clicking the unused sidebar space below its nodes removes the text caret and returns to navigation without discarding edits. Actual text blocks, including empty paragraphs, remain editable; the editor's body-mounted BubbleMenu counts as inside. Changes autosave after the shared persistence debounce. There are no Save/Cancel controls, commit shortcuts or save-time editing locks. In navigation mode, dragging anywhere within a row moves it; in edit mode, only non-text space starts a move so dragging text still selects it. Moving a list item carries its full subtree. Standalone paragraphs and headings use the same drag controller and can move only outside complete lists. After the movement threshold, a floating copy follows the pointer while the original is hidden in its reserved space. The copy is inert and disappears on release or cancellation. Moving within the hidden source's occupied area shows no insertion slot and cannot change the document. Other destinations follow the current pointer over visible rows or nearby gaps; only a valid drop changes the document. Dragging preserves the current mode; document-changing menu actions enter editing. Both follow the same autosave path as typing. The dots open menus only. During a drag, an accent line marks the insertion boundary for both list items and text blocks without resizing rows. An after-parent line sits below its subtree; nesting uses that boundary with a child-level inset. Dropping into empty sidebar space below the final workspace uses a permitted boundary inside the organization. Escape cancels an unfinished move and removes all drag feedback.

Consumer transaction guards protect workspace identity and permissions across typing, range deletion, cut, paste, list commands and undo. A new plain item cannot inherit a workspace binding from Enter or paste. Plain items remain editable and deletable through normal editor commands. Explicit workspace actions carry their domain intent alongside the saved document:

- Delete confirms the subtree in the current local document and authorizes its exact workspace ids for deletion. A child moved out before deletion survives; a child moved in is included in the confirmed deletion. A committed deletion is final, and editor Undo cannot restore its workspace link or deleted data.
- New workspace inserts a provisional item at the requested position. Autosave creates its workspace and owner grant. Undo or explicit removal before its request is sent can cancel creation. A submitted creation cannot be silently removed by ordinary editor commands while its result is uncertain. Provisional items cannot navigate before creation succeeds.
- Label, whole-label bold, tag, grouping and ordering changes autosave independently of editing mode. Clearing a workspace label saves an empty string and keeps its protected identity.

Creation and deletion remain explicitly authorized domain actions. They are not inferred from missing text or arbitrary document differences.

Hover, active selection, collapse, menus and drag indicators live outside the saved document. Document edits and completed reorders use ProseMirror transactions.

The editor surface is transparent. List titles, headings and paragraphs retain an 18px base inset. Each additional list level adds 16px. The drag affordance overlays the far-left edge with a 3px inset at every nesting depth and reserves no text gutter. List-row hover and active backgrounds share a 14px left inset, an 8px right inset and rounded corners across the sidebar width, leaving the drag icon outside the colored area. Selected rows use the image/video mode toggle's indicator blue and selected foreground. Hovered rows use its track blue and inactive foreground. The selected background uses the indicator color alone, avoiding the stronger tint produced by layering it over the track. The state foreground applies to the row label, chevron and right-side controls. The drag overlay always uses the selected-item foreground and fill. A parent's state covers only its own row; descendants remain independent. Paragraphs and headings have no hover background. Ordinary text blocks use the default cursor in navigation mode and the text cursor in editing mode. Each host applies the pointer cursor only to its actionable labels.

## Saving and concurrent changes

`workspace.getUserWorkspaceNavigation` returns each organization's authorized document projection, numeric revision and workspace tree. Autosave submits the document with its base revision, a mutation id and exact workspace ids explicitly authorized for creation or deletion. Navigation uses `workspacePersistenceSettings.debounceMs` from `@lixpi/constants`, exposed through UI and API settings. Its current value is 3000 ms. The separate 100 ms collaborative editor transport batch remains unchanged.

The adapter keeps each organization's acknowledged snapshot, latest local document and at most one immutable in-flight request together. Typing can continue during a save. Acknowledgements advance the saved revision without replacing newer local edits or resetting editor history. Organizations save independently, so a failure in one does not block the others. A remote document cannot advance the editor's baseline until it is actually applied; deferred refreshes never silently overwrite local work.

Leaving starts persistence immediately instead of waiting for the ordinary debounce. Every user-initiated logout awaits the navigation adapter's flush before calling the auth client's logout, while the editor and surrounding interface remain responsive. The flush joins any in-flight request and drains newer edits; concurrent leave events share that work. It preserves server retry deadlines. A failed or conflicted save keeps the session and local changes available for recovery.

The page-leave handler starts the same flush and requests the browser's leave warning only while changes remain unacknowledged. A hidden page or pagehide event also starts a best-effort flush without a dialog. Browser teardown cannot await an asynchronous request, so the warning remains necessary until acknowledgement. Normal route changes retain the sidebar. Forced authentication-revocation teardown remains immediate, and destruction removes the leave listeners and cancels persistence timers.

The server reconstructs the user's projection at the submitted revision and applies authorized changes to the full canonical document. It preserves hidden branches and rejects omitted workspace bindings unless their deletion was explicitly requested and authorized. A visible root whose actual parent is hidden keeps that parent when the user has not moved it.

A stale base revision returns `WORKSPACE_NAVIGATION_STALE` with the latest authorized snapshot. Autosave pauses for that organization and retains its local edits. Reload remains available and asks for confirmation only when chosen, before discarding them; it replaces only that organization's content. Other organizations retain their local edits and persistence state. Permanent failures retain local edits with recovery controls; transient transport, busy and rate-limit failures retry the unchanged request.

A mutation id makes repeated submission idempotent; reusing it with a different payload or user is rejected. A successful retry checks current access and returns the current authorized snapshot, which may contain subsequent edits. If that acknowledgement differs from the submitted document, the adapter retains local content and uses the same conflict recovery. It never advances a newer baseline behind unchanged rendered content.

Client debounce controls request cadence but does not enforce server limits. API `settings.navigationPersistence` bounds authenticated write frequency and document size, node count, depth and explicit identity actions before expensive projection work. Its durable admission record is shared across replicas, and the `workspaceNavigationWrites` NATS queue delivers each save to one replica. Rate responses include `retryAfterMs`; retries preserve the exact mutation id and payload. See the [API README](../../services/api/README.md) for settings and admission details.

## Inherited access

Effective access is the highest grant on a workspace or any ancestor. A child grant can raise access within its subtree but cannot reduce inherited access. `WORKSPACES_ACCESS_LIST` is the only record of grants. The access resolver reads workspace metadata and the relevant grant rows consistently, and denies access to a deleting workspace or one with a deleting ancestor.

A tree operation holds its organization's lock for as long as the projection is partly written, so a read has to rule the lock out. Checking access to one workspace takes two reads: its metadata row, then the organization's lock together with the ancestor chain and the user's grants in one transactional read. A held lock makes the check busy, unless the workspace is already being deleted. A chain too long for one transaction falls back to reading the lock and navigation head before and after. Bulk reads such as the accessible forest and the workspace tree use that before-and-after fence, reading every organization's lock and head in one transactional read on each side. Loading the side panel's navigation reads every organization's head once, builds the tree once, projects each organization's document, and confirms the heads with one closing read. Concurrent requester-context reads for the same user share one forest read while it runs, and nothing is kept once it finishes.

Agent writes fence both the grant used for authorization and the workspace's ancestor chain and deletion state. Revoking a grant or moving a workspace invalidates an authorization based on the old state. Conversation events reach users granted access on the workspace or an ancestor through the `workspaceId-userId` index.

Mutation permissions remain domain rules:

- Creating a root workspace requires organization membership. Structure and headings at the organization root require organization editor or owner.
- List structure and plain child labels beneath a workspace require editor or owner on that workspace. Styled headings remain outside lists.
- Moving a workspace requires editor or owner on it and on its destination, or organization editor or owner for a root destination. Cycles and cross-organization moves are rejected.
- Changing a workspace label, note or tags requires editor or owner on it.
- Deleting requires owner authorization for every workspace explicitly authorized for deletion.

## Authorized projections

`workspace.getUserWorkspaceTree` remains available for domain consumers. It loads subtrees under the user's grants and excludes deleting entries. A workspace whose parent is inaccessible becomes a visible root, ordered by its top-level ancestor. Headings over wholly inaccessible sections are hidden; empty headings remain visible where the user can access the surrounding structure.

The navigation endpoint applies equivalent visibility to the saved document. A filtered projection is never treated as a replacement for the organization's complete document. Plain groups containing only inaccessible workspace branches do not expose those branches' labels.

The sidebar hides the organization label when there is only one organization. With several, it renders protected organization labels in generic section containers around their documents, keeping headings and paragraphs outside menu lists. Those wrappers exist only in the combined UI document; each organization's saved document stays independent.

## Storage and recovery

[Data Storage](../platform/DATA-STORAGE.md#workspace-tree) describes the key layout. `WORKSPACE_TREE` stores the canonical head and immutable document chunks alongside the actual-child index. The first authorized navigation read or domain mutation initializes revision zero as an empty identified paragraph under the organization lock. A missing head alongside existing root hierarchy rows is an integrity error; it never triggers a conversion or backfill.

Every mutation that affects navigation, including existing create, update, move and delete APIs, uses the same organization lock and updates the canonical document. A document save stages its target revision, applies domain changes and explicit cleanup, then publishes the head and mutation receipt last. Readers check the lock and head consistency so partially rewritten hierarchy records are not exposed as a published state.

Operations record their inputs and progress before domain writes. The holder renews its lock; the next mutation or startup sweep resumes an expired operation. Busy requests return `WORKSPACE_TREE_BUSY`, which the client retries within its bounded retry policy. Subtree deletion marks entries as deleting before stopping conversations and removing media requests, Asset references and workspace rows.

Historical revisions and unreferenced staged chunks are currently retained. There is no automatic navigation revision garbage collection.

## NATS contracts

| Subject | Request | Success response |
|---|---|---|
| `workspace.getUserWorkspaceNavigation` | none | `UserWorkspaceNavigation` |
| `workspace.saveWorkspaceNavigation` | `organizationId`, `baseRevision`, `mutationId`, `document`, optional `createdWorkspaceIds`, `deletedWorkspaceIds` | `{snapshot}` |
| `workspace.getUserWorkspaceTree` | none | `UserWorkspaceTrees` |
| `workspace.create` | `name`, optional organization, parent and neighbors | `{workspace, tree}` |
| `workspace.update` | `workspaceId`, optional `name`, `note`, `tagIds` | `{tree}` |
| `workspace.move` | `workspaceId`, optional parent and neighbors | `{tree}` |
| `workspace.delete` | `workspaceId` | `{deletedWorkspaceIds, tree}` |
| `workspace.heading.create` | organization, level, name, optional note, parent and neighbors | `{tree}` |
| `workspace.heading.update` | heading and organization ids, optional name, level and note | `{tree}` |
| `workspace.heading.move` | heading and organization ids, optional parent and neighbors | `{tree}` |
| `workspace.heading.delete` | heading and organization ids | `{tree}` |

Neighbors are `beforeEntryId` and `afterEntryId`; when both are supplied they must be adjacent siblings. Omitting both appends the entry. Domain requests with stale neighbors return `WORKSPACE_TREE_STALE` and the current tree. Navigation saves use their separate revision conflict response. Contracts and error codes are exported from `@lixpi/constants`.

## Host integration

Web-ui's `createWorkspaceNavigation` adapter accepts the container and host ports for NATS requests, routing, confirmation, error reporting, import/export, collapse persistence and workspace lifecycle callbacks. It mounts inside the existing side panel. This application-specific adapter is not a shared package. The generic nested-list plugin requires none of those workspace services; another consumer supplies its own item types, policies and persistence.
