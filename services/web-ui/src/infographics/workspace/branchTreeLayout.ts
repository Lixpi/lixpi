// Branch-lineage tree layout lives in @lixpi/canvas-engine shared: the API runs
// the exact same tidy-tree + rigid collision resolution as the authoritative
// generation-driven layout, while the WebUI calls it for local drag/delete
// rebalances. Re-exported here so workspace modules keep their local import path.
export {
    applyBranchTreeLayout,
    buildBranchTrees,
    rebalanceBranchTreesAndResolve,
    type BranchTree,
    type BranchTreeLayoutOptions,
} from '@lixpi/canvas-engine'
