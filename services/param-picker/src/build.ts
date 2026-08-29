'use strict'

import { mkdir, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import * as esbuild from 'esbuild'
import * as sass from 'sass'

// Builds the client from src/client into public/. The output is generated, so
// public/ is gitignored and never edited by hand.
//
// Everything here runs inside the container. Node runs this file directly
// through native type stripping, so the build itself needs no build.

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, 'client')
const OUT = join(HERE, '..', 'public')

const WATCH = process.argv.includes('--watch')

const stamp = (): string => new Date().toISOString().slice(11, 19)
const log = (message: string): void => console.log(`[build ${stamp()}] ${message}`)

const buildStyles = async (): Promise<void> => {
    const result = sass.compile(join(CLIENT, 'styles.scss'), {
        style: 'expanded',
        loadPaths: [CLIENT],
    })
    await writeFile(join(OUT, 'styles.css'), result.css, 'utf8')
}

const copyHtml = async (): Promise<void> => {
    await writeFile(join(OUT, 'index.html'), await readFile(join(CLIENT, 'index.html'), 'utf8'), 'utf8')
}

const scriptOptions: esbuild.BuildOptions = {
    entryPoints: [join(CLIENT, 'app.ts')],
    outfile: join(OUT, 'app.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: WATCH ? 'inline' : false,
    logLevel: 'warning',
}

const main = async (): Promise<void> => {
    // Only a one-shot build clears the directory. In watch mode the server is
    // starting alongside this process and watching the same directory: deleting
    // it would leave that watch bound to a dead inode, and live reload would go
    // quiet with no error to show for it.
    if (!WATCH) await rm(OUT, { recursive: true, force: true })
    await mkdir(OUT, { recursive: true })

    if (!WATCH) {
        await esbuild.build(scriptOptions)
        await buildStyles()
        await copyHtml()
        log('built')
        return
    }

    // Polling, not inotify. Editors save atomically by writing a temp file and
    // renaming it over the original, and across a bind mount from the host that
    // rename often produces no watch event in the container. An edit that never
    // rebuilds looks exactly like an edit that did nothing, so the loop stats the
    // files instead: a few files every 300ms costs nothing and never lies.
    const rebuild = async (filename: string): Promise<void> => {
        if (filename.endsWith('.scss')) await buildStyles()
        else if (filename.endsWith('.html')) await copyHtml()
        else await esbuild.build(scriptOptions)
        log(`rebuilt ${filename}`)
    }

    await esbuild.build(scriptOptions)
    await buildStyles()
    await copyHtml()
    log('watching src/client')

    const fingerprints = new Map<string, string>()
    const scan = async (): Promise<string[]> => {
        const entries = await readdir(CLIENT, { recursive: true, withFileTypes: true })
        const changed: string[] = []
        for (const entry of entries) {
            if (!entry.isFile() || !/\.(ts|scss|html)$/u.test(entry.name)) continue
            const full = join(entry.parentPath ?? CLIENT, entry.name)
            const info = await stat(full)
            const fingerprint = `${info.mtimeMs}:${info.size}`
            if (fingerprints.get(full) !== fingerprint) {
                if (fingerprints.has(full)) changed.push(entry.name)
                fingerprints.set(full, fingerprint)
            }
        }
        return changed
    }

    await scan()
    setInterval(() => {
        void (async () => {
            try {
                for (const filename of await scan()) await rebuild(filename)
            } catch (error) {
                console.error(`[build ${stamp()}] ${(error as Error).message}`)
            }
        })()
    }, 300)
}

await main()
