import {
    copyFile,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    unlink,
    writeFile,
} from 'node:fs/promises'
import {
    dirname,
    join,
    relative,
} from 'node:path'

import { err as debugError } from '@lixpi/debug-tools'

// Versioned writes for any JSON the registry owns, whether that is a parameter file
// or a model-catalog config. Every write copies the files it is about to change into
// a timestamped folder under history/ first, so an edit made through the API can be
// read back or undone by hand.
//
// The parameter tree and the model catalog both use this, which is why the history
// prefix is a constructor argument rather than a hardcoded string: one tree's
// snapshots stay separate from the other's and prune on their own schedule.
export type VersionedEdit = {
    // Absolute path of the file to write.
    path: string
    content: unknown
}

export class VersionedJsonStore {
    constructor(
        private readonly rootDir: string,
        private readonly historyDir: string,
        private readonly historyPrefix: string,
        private readonly historyLimit = 100,
    ) {}

    async read<T>(path: string): Promise<T | null> {
        try {
            return JSON.parse(await readFile(path, 'utf8')) as T
        } catch {
            return null
        }
    }

    private stamp(): string {
        return new Date()
            .toISOString()
            .replaceAll(':', '-')
            .replace(/\.\d+Z$/u, 'Z')
    }

    // Copies the files about to change into one timestamped folder. Returns the
    // folder so a caller can tell the user where the previous version went.
    async snapshot(paths: string[]): Promise<string | null> {
        if (paths.length === 0)
            return null

        const target = join(this.historyDir, `${this.historyPrefix}${this.stamp()}`)

        try {
            for (const path of paths) {
                const destination = join(
                    target,
                    relative(this.rootDir, path),
                )
                await mkdir(
                    dirname(destination),
                    { recursive: true },
                )
                await copyFile(path, destination)
            }

            await this.prune()

            return target
        } catch (error) {
            debugError('[ai-model-registry] could not snapshot files:', error)

            return null
        }
    }

    // Written through a temp file and a rename so an interrupted write never leaves a
    // half-written file behind.
    async write(
        path: string,
        content: unknown,
    ): Promise<void> {
        const temp = `${path}.tmp`

        await mkdir(
            dirname(path),
            { recursive: true },
        )
        await writeFile(
            temp,
            `${JSON.stringify(
                content,
                null,
                4,
            )}\n`,
            'utf8',
        )

        try {
            await rename(temp, path)
        } catch (error) {
            await unlink(temp).catch(() => undefined)

            throw error
        }
    }

    // Snapshot first, then write. Files that do not exist yet are created and are not
    // snapshotted, because there is no previous version to keep.
    async writeMany(edits: VersionedEdit[]): Promise<{
        written: string[]
        snapshotDir: string | null
    }> {
        const existing: string[] = []

        for (const edit of edits) {
            if ((await this.read(edit.path)) !== null)
                existing.push(edit.path)
        }

        const snapshotDir = await this.snapshot(existing)

        for (const edit of edits)
            await this.write(edit.path, edit.content)

        return {
            written: edits.map(edit => edit.path),
            snapshotDir,
        }
    }

    private async prune(): Promise<void> {
        const entries = (await readdir(this.historyDir, { withFileTypes: true })).filter(
            entry => entry.isDirectory() && entry.name.startsWith(this.historyPrefix),
        ).map(entry => entry.name)
            .sort()

        for (const stale of entries.slice(
            0,
            Math.max(0, entries.length - this.historyLimit),
        )) {
            await rm(
                join(this.historyDir, stale),
                {
                    recursive: true,
                    force: true,
                },
            )
        }
    }
}
