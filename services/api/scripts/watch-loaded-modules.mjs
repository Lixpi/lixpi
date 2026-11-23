// Dev-only. Polls the shared package files that record-loaded-modules.mjs saw
// the API load. When one of them changes it touches the restart file nodemon
// watches and exits, so nodemon restarts the API. nodemon itself watches only
// the API's own sources and that restart file.
//
// The files are polled rather than watched because workspace-package-sync.sh
// replaces them by rename, and polling by path survives that. The list is
// re-read every second so files the API imports later are covered too.
import {
    readFileSync,
    unwatchFile,
    watchFile,
    writeFileSync,
} from 'node:fs'

const LIST_FILE = process.env.LIXPI_API_LOADED_MODULES_FILE ?? '/dev/shm/lixpi-api-loaded-modules.txt'
const RESTART_FILE = process.env.LIXPI_API_RESTART_FILE ?? '/dev/shm/lixpi-api-restart.json'
const POLL_INTERVAL_MS = 1000

const watched = new Set()

const restart = (path) => {
    for (const file of watched)
        unwatchFile(file)

    console.log(`[watch-loaded-modules] ${path.replace('/usr/src/service/', '')} changed; restarting the API`)
    writeFileSync(RESTART_FILE, JSON.stringify({ changed: path, at: Date.now() }))
    process.exit(0)
}

const readList = () => {
    try {
        return new Set(readFileSync(LIST_FILE, 'utf8').split('\n').filter(Boolean))
    } catch {
        return undefined
    }
}

const watchNewFiles = () => {
    const loaded = readList()

    if (!loaded)
        return

    for (const path of watched) {
        if (!loaded.has(path)) {
            unwatchFile(path)
            watched.delete(path)
        }
    }

    for (const path of loaded) {
        if (watched.has(path))
            continue

        watched.add(path)
        watchFile(
            path,
            { interval: POLL_INTERVAL_MS },
            (current, previous) => {
                if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size)
                    if (readList()?.has(path) ?? true)
                        restart(path)
            },
        )
    }
}

watchNewFiles()
setInterval(watchNewFiles, POLL_INTERVAL_MS)
