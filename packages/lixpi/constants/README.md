# Lixpi Constants

Shared runtime contracts for TypeScript services and the browser.

## Storage contracts

`ts/asset-types.ts` defines Asset, Meta, ACL, typed references, edit leases, media/rendition states, Blob rows/references, and rendition job request/response types.

`ts/types.ts` defines Asset-backed canvas nodes, media lineage plans/assignments, conversation stream payloads, Workspace state, Capability catalog/manifests/workflows/runs, and shared UI/runtime contracts. Media prompt segments distinguish fuzzy-matchable text, typed non-media references, and bound media references so Capability labels cannot enter media-identity matching. Each image/video node can retain its own durable media-run progress independently of branch markers, including the selected media model/provider and pending lineage assignment needed before the Asset catalog or final `generatedBy` record is available, and each media-generation operation can point directly to its stable `outputNodeId`. Capability module metadata includes the required description-sheet contract. Every `AiModel` carries `inferenceCapabilities`, which describes temperature support, thinking configuration, system prompts, structured schemas, and accepted input kinds. Image-generation models also carry `imageReferenceCapabilities`, which declares reference budgets, conditioning modes, fidelity behavior, supported controls, output pixel limits, and aspect ratios. The same file defines the privacy-safe Character fidelity request/response contracts; responses can contain detections and scalar similarity, never embeddings. Canvas media/document nodes use `assetId` only; Object Store keys and rendition URLs are not canvas state.

`ts/media-generation-progress.ts` builds the generic durable image/video operation timeline used when a Capability, Skill, or Tool does not publish its own nested progress items. Progress items distinguish clean completion from an `attention` result that finished but still requires user review; actual execution failures remain `failed`. Its terminal settlement helper recursively closes every still-pending or running descendant for completed, failed, and cancelled runs, including recovery paths that have no prior progress snapshot.

`ts/media-generation-layout-settings.ts` owns the API/WebUI branch-layout and collision metrics. Preflight branch markers use the normal canvas-world marker dimensions and `nodeGap`; there is no separate composer-relative stack or handoff animation timing. Resolved media collision envelopes reserve the title above the pixels and the action/model strip below them at the bounded zoom curve's maximum world-space footprint; compact pre-frame circles intentionally reserve neither strip until the first frame resolves.

Capability data contracts remain in `ts/types.ts`. Manifest, workflow, resource, and dependency-graph validation lives in [`@lixpi/capability-system`](../capability-system/README.md), because validation is executable Capability behavior rather than a constant.

`ts/aws-resources.ts` contains only active DynamoDB resource names, including the six revision-2 tables. `nats-subjects.json` contains active Asset/Blob processing and maintenance subjects, Capability subjects, and the internal Character panel fidelity subject.

`ts/metrics-contracts.ts` defines the usage-metering check/confirm request/response shapes served by the hosted metering backend over the `METRICS_SUBJECTS` subjects. Together with `METRICS_SUBJECTS` in `nats-subjects.json`, it is a cross-repo wire contract — do not change it without mirroring the metering backend in the same change.

## Main files

```text
packages/lixpi/constants/
├── nats-subjects.json
└── ts/
    ├── asset-types.ts
    ├── aws-resources.ts
    ├── media-generation-layout-settings.ts
    ├── media-generation-progress.ts
    ├── metrics-contracts.ts
    ├── workspace-persistence-settings.ts
    ├── types.ts
    └── index.ts
```

## TypeScript usage

```ts
import {
  NATS_SUBJECTS,
  STREAM_STATUS,
  type Asset,
  type CanvasNode,
  type GenerateRenditionsRequest,
} from '@lixpi/constants'

const createAssetSubject = NATS_SUBJECTS.ASSET_SUBJECTS.CREATE
const renditionSubject = NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS
```

Edit `nats-subjects.json` once; TypeScript wrappers consume it directly. The preserved Python wrapper is for non-runtime legacy tooling and future service splits, not an alternate active storage contract.
