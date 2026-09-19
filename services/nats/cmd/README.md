---
title: NATS Command Entry Points
description: How the container selects broker serving, local control or a native backup/restore client.
---

# NATS Command Entry Points

This directory contains the [`lixpi-nats` executable](lixpi-nats/README.md). It turns a container invocation into one of three kinds of work: running a broker, controlling an existing local broker, or connecting as a backup/restore client.

Those paths share a binary so they use the same NATS libraries and snapshot format. They do not all start a server or need the same credentials. For example, a backup container only connects to `NATS_URL` with its backup seed and writes native snapshots into its mounted directory.

Command selection, process signals and environment binding belong here. The internal packages receive the objects and settings assembled by the command. [Command composition](../documentation/MODULES.md#command-composition) explains the startup order; [Configuration](../documentation/CONFIGURATION.md#commands) lists the arguments and required inputs.
