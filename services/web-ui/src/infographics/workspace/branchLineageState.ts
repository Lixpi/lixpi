// Branch-lineage state predicates/selectors live in @lixpi/canvas-engine shared
// (the API layout uses the same definitions). Re-exported here so workspace
// modules keep their local import path.
export {
    getGeneratedMediaLineageMarkerIds,
    getGeneratedMediaMidpointMarkerId,
    getStartedLineageMarkerState,
    isBranchLineageMarkerNode,
    isGeneratedMediaNode,
    type BranchLineageMarkerNode,
    type GeneratedMediaNode,
    type StartedLineageMarkerState,
} from '@lixpi/canvas-engine'
