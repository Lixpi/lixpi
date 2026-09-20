---
title: Dependency Version Registry Architecture
description: How catalog values become native declarations and how publisher updates move through review and apply.
---

# Dependency Version Registry Architecture

The [dependency version registry](../README.md) separates release selection from the file formats that consume those releases. JSON catalogs record the selected values. `VersionCatalog` resolves references and exposes one typed view. Format synchronizers compare that view with native declarations. The repository still commits those declarations because each ecosystem must remain usable without a registry-aware wrapper.

The update path adds publisher lookup and release review before it changes the catalogs. It uses the same synchronization planner as a manual catalog edit, so publisher-driven updates and exact manual selections produce native files through one path.

## Catalog and native-file boundaries

The catalogs are grouped by dependency domain. The Docker build-argument adapter is separate because an argument name such as `NODE_VERSION` belongs to a Dockerfile interface, while `node` is the canonical catalog key.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
graph TB
    subgraph "Authoritative registry data"
        TypeScript[(TypeScript catalog<br/>Runtime, package manager and packages)]
        Go[(Go catalog<br/>Runtime, modules and tools)]
        Releases[(Release catalogs<br/>Tools, images and Actions)]
        Arguments[Docker build-argument adapter]
    end
    Resolver[VersionCatalog<br/>Reference and template resolution]
    Discovery[RepositoryFiles<br/>Native consumer discovery]
    subgraph "Format synchronization"
        PackageSync[Package and Go synchronizers]
        ContainerSync[Dockerfile and Compose synchronizers]
        WorkflowSync[GitHub Actions synchronizer]
    end
    Native[(Committed native declarations)]
    TypeScript --> Resolver
    Go --> Resolver
    Releases --> Resolver
    Arguments --> Resolver
    Resolver --> PackageSync
    Resolver --> ContainerSync
    Resolver --> WorkflowSync
    Discovery --> PackageSync
    Discovery --> ContainerSync
    Discovery --> WorkflowSync
    PackageSync --> Native
    ContainerSync --> Native
    WorkflowSync --> Native
```

| Component | Responsibility |
|---|---|
| TypeScript catalog | Selects Node.js, pnpm, npm packages, and workspace package versions |
| Go catalog | Selects the Go language version, Go modules, and Go development tools |
| Release catalogs | Select external tools, container-image tags, and GitHub Action releases |
| Docker build-argument adapter | Maps descriptive Docker argument names to canonical catalog paths |
| `VersionCatalog` | Resolves direct values, cross-catalog templates, the `major` transform, image references, and Docker arguments |
| `RepositoryFiles` | Discovers supported native files and confines registry and repository paths |
| Format synchronizers | Validate one native format and return its complete expected source text |

The synchronizers do not maintain a file-by-file mapping. Discovery recognizes `package.json`, `go.mod`, Dockerfile names, root Compose files, and workflow YAML under `.github/workflows/`. Dependency caches, build output, fixtures, vendored test data, and the registry itself are excluded from discovery.

## Reference resolution

A catalog value can contain `{{catalog.path}}`. `VersionCatalog` walks that path through the combined catalog data, resolves nested references, and rejects a circular reference, an unknown path, an unsupported transform, or a value that is not one nonempty line.

The `major` transform extracts the first numeric component from the resolved value. It exists for consumers such as AWS Lambda images that publish one tag per runtime major while the main Node.js images use a complete runtime version. The container-image catalog combines the repository key with the resolved tag, so Docker synchronizers compare complete image references.

This reference mechanism is intentionally small. It shares selected releases; it does not implement conditions, arithmetic, ecosystem-specific version ranges, or arbitrary expressions. Consumer-specific names remain in adapters or native files instead of becoming aliases in the canonical catalogs.

## Synchronization planning

`planRepositorySynchronization` reads every discovered native consumer, passes it to the matching format synchronizer, and records changed output in memory. If any file contains an unregistered dependency or unsupported declaration, planning fails before `sync` writes a native file.

`check` uses the same plan and fails when the map is nonempty. It never writes. `sync` writes the fully planned map after every consumer has been processed successfully. The update command also creates a prospective `VersionCatalog` in memory and runs this planner before it writes the authoritative catalogs.

Each native format keeps its own syntax and semantics:

| Native format | Registry behavior |
|---|---|
| `package.json` | Replaces registered dependency fields, workspace package versions, and `pnpm@...`; preserves `workspace:`, `file:`, and `link:` declarations |
| `go.mod` | Replaces the single `go` directive and every registered requirement; keeps comments and indirect markers |
| Dockerfile | Generates registered `ARG` defaults, requires external `FROM` images to use registered arguments, and rejects direct managed tool versions |
| Root Compose YAML | Replaces registered external image references and preserves local `lixpi/*` image names |
| GitHub Actions workflow | Replaces external `uses:` releases and preserves local actions and `docker://` actions |

## Dry run and apply

The update command accepts one dependency, several dependencies, a group, or `all`. The dry run resolves the newest stable release without restricting it to the selected major, then collects the release material needed to assess that change. Actual apply repeats the network lookup so it never installs a stale target from an earlier report.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant Developer
    participant Command as Update command
    participant Publishers
    participant Report as update-plan.json
    participant Catalogs
    participant Synchronizers

    %% ============================================================
    %% DRY-RUN TARGET RESOLUTION
    %% ============================================================
    rect rgb(220, 236, 233)
        Note over Developer, Synchronizers: PHASE 1 - Resolve selected update targets
        Developer->>Command: apply --dry-run with selectors
        activate Command
        Command->>Publishers: Fetch newest stable releases
        activate Publishers
        Publishers-->>Command: Versions and publisher source metadata
        deactivate Publishers
    end

    %% ============================================================
    %% RELEASE REVIEW
    %% ============================================================
    rect rgb(195, 222, 221)
        Note over Developer, Synchronizers: PHASE 2 - Collect and return release changes
        Command->>Publishers: Fetch release notes or compare source tags
        activate Publishers
        Publishers-->>Command: Every available release change in range
        deactivate Publishers
        Command-->>Developer: Print complete dry-run review
        Command->>Report: Write targets, sources and full review
        activate Report
        Report-->>Command: Review persisted
        deactivate Report
        Command-->>Developer: Dry run completed without authoritative writes
        deactivate Command
    end

    %% ============================================================
    %% APPLY REVALIDATION
    %% ============================================================
    rect rgb(242, 234, 224)
        Note over Developer, Synchronizers: PHASE 3 - Revalidate before apply
        Developer->>Command: apply with reviewed selectors
        activate Command
        Command->>Publishers: Repeat version and release-history lookup
        activate Publishers
        Publishers-->>Command: Fresh target and complete release review
        deactivate Publishers
        Command-->>Developer: Print fresh release review
        Command->>Command: Require complete upstream release information
        Command->>Catalogs: Build prospective catalog data in memory
        activate Catalogs
        Catalogs-->>Command: Prospective selections
        deactivate Catalogs
        Command->>Synchronizers: Plan every native consumer change
        activate Synchronizers
        Synchronizers-->>Command: Complete native-file change map
        deactivate Synchronizers
    end

    %% ============================================================
    %% AUTHORITATIVE WRITES
    %% ============================================================
    rect rgb(246, 199, 179)
        Note over Developer, Synchronizers: PHASE 4 - Write the reviewed selection
        Command->>Report: Write the fresh apply review
        activate Report
        Report-->>Command: Review persisted
        deactivate Report
        Command->>Catalogs: Write authoritative catalog files
        activate Catalogs
        Catalogs-->>Command: Catalogs written
        deactivate Catalogs
        Command->>Synchronizers: Write planned native declarations
        activate Synchronizers
        Synchronizers-->>Command: Native files written
        deactivate Synchronizers
        Command-->>Developer: Applied update and changed-file count
        deactivate Command
    end
```

| Participant | Responsibility |
|---|---|
| Developer or agent | Chooses the dependency scope, reads the dry-run review, and updates repository code when the release material requires migration |
| Update command | Coordinates selection, publisher lookup, release review, prospective catalog construction, planning, and writes |
| Publishers | Supply the latest stable version and the available release history |
| `update-plan.json` | Keeps the complete timestamped review for the latest local command run |
| Catalogs | Hold selected releases after apply succeeds |
| Synchronizers | Calculate and write every affected native declaration |

If release information is incomplete, the successful-write phases do not run. Dry run marks that dependency as `unavailable`; actual apply fails before it builds or writes the selected update. A failed publisher request also ends the command before catalog writes.

## Release-history sources

The latest-version source and the release-history source are separate because a package registry can identify a target without publishing migration notes.

| Dependency domain | Latest version | Release review |
|---|---|---|
| npm package | npm `latest` distribution tag | GitHub releases from npm repository metadata, with tag comparison fallback |
| Go module | Go proxy `@latest` for the exact module path | GitHub releases or commit comparison when the module path identifies GitHub |
| Node.js | Node.js distribution index | Official versioned Node.js changelogs |
| Go runtime | Go stable download metadata | GitHub release or tag comparison from `golang/go` |
| pnpm and registered tools | npm metadata or latest GitHub release | Registered GitHub release history or tag comparison |
| Container image | Alpine stable metadata, a registered release endpoint, or every Docker Hub tag page | Registered GitHub history when available; otherwise the review is unavailable |
| GitHub Action | Latest stable GitHub release | GitHub release history or tag comparison |

GitHub release bodies are used only when every matching release in the range contains notes. Otherwise the resolver compares the selected and target tags and records every returned commit message. Go pseudo-versions contribute their commit hashes to that comparison. Paginated retrieval must account for the complete upstream result; the resolver does not label a partial comparison as available.

## Native dependency metadata

The registry selects declared direct and indirect requirements that appear in supported native files. Native ecosystem metadata still has its own job. Go's minimal version selection can raise requirements, and `go.sum` stores checksums for the resolved graph. After changing Go requirements, run the permitted module-maintenance command from the [Go Testing and Tooling guide](../../documentation/testing/Go/TESTING-GUIDE.md), then synchronize again if Go changed a declared requirement.

The registry does not replace lockfile resolution, compiler compatibility checks, image builds, or application migrations. Release review gives the agent the evidence needed to make those changes before apply; the relevant service or package workflow verifies them afterward when the thread authorizes that verification.
