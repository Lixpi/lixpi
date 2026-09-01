export type BranchLineageNodeCollisionSettings = {
    iterations: number
    margin: number
    overlapThreshold: number
}

// Canvas settings are user-editable, so all branch-lineage spacing call sites
// pass through the same sanitizer before using the value for placement or
// collision geometry.
export function normalizeBranchLineageNodeGap(gap: number): number {
    return Number.isFinite(gap) ? Math.max(0, gap) : 0
}

// Collision resolution treats `margin` as the reserved space around a node. The
// branch-lineage node gap is therefore applied by replacing per-flow marker
// margins while preserving iterations and overlap thresholds.
export function applyBranchLineageNodeGap(
    settings: BranchLineageNodeCollisionSettings,
    nodeGap: number,
): BranchLineageNodeCollisionSettings {
    const margin = normalizeBranchLineageNodeGap(nodeGap)
    if (settings.margin === margin) return settings
    return { ...settings, margin }
}
