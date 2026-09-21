---
title: Dependency Version Registry Manuals
description: Architecture, configuration, source ownership, and operating procedures for centralized dependency versions.
---

# Dependency Version Registry Manuals

The registry connects one set of selected releases to several native dependency formats. Understanding that split matters when a change fails. A missing catalog entry, an invalid catalog reference, a stale native declaration, an unavailable publisher, and an incompatible major upgrade are different problems and have different fixes.

[Architecture](ARCHITECTURE.md) follows selected values through reference resolution and format synchronization, then follows a publisher update through dry run and apply. [Modules and Code Responsibilities](MODULES.md) connects those flows to `shared`, `sync`, and `update` source modules.

Use [Configuration](CONFIGURATION.md) for catalog ownership, reference expressions, Docker build-argument mappings, selectors, publisher rules, and container inputs. Use [Operations](OPERATIONS.md) for the Docker commands, release review, manual exact-version changes, drift checks, Go module maintenance, and failure diagnosis. The [component README](../README.md) explains the repository-level contract and why native declarations remain committed.
