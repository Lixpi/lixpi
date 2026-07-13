# Lixpi Constants

Shared runtime contracts for TypeScript services and the browser.

## Storage contracts

`ts/asset-types.ts` defines Asset, Meta, ACL, typed references, edit leases, media/rendition states, Blob rows/references, and rendition job request/response types.

`ts/types.ts` defines Asset-backed canvas nodes, media lineage plans/assignments, conversation stream payloads, Workspace state, Features, and shared UI/runtime contracts. Canvas media/document nodes use `assetId` only; Object Store keys and rendition URLs are not canvas state.

`ts/aws-resources.ts` contains only active DynamoDB resource names, including the six revision-2 tables. `nats-subjects.json` contains only active Asset/Blob processing and maintenance subjects alongside unrelated current product subjects.

## Main files

```text
packages/lixpi/constants/
├── nats-subjects.json
└── ts/
    ├── asset-types.ts
    ├── aws-resources.ts
    ├── media-generation-layout-settings.ts
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
