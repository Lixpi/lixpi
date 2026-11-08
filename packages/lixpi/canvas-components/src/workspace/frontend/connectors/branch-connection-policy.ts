// Fork and continuation markers sit on a lineage connector rather than
// terminating it. Relations and feedback retain arrows regardless of the
// target's lineage role. Embedded canvases share the native artwork.
export const getBranchConnectionTargetMarker = (
    role: 'origin' | 'fork' | 'continuation' | undefined,
    selected: boolean,
    kind: 'forward' | 'relation' | 'feedback' = 'forward',
): 'none' | 'arrowhead' | 'arrowhead-selected' =>
    kind === 'forward'
        && (role === 'fork' || role === 'continuation')
        ? 'none'
        : selected
            ? 'arrowhead-selected'
            : 'arrowhead'
