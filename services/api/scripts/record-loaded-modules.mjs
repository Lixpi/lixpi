// Dev-only. Loaded with `node --import` by nodemon-exec.sh, it records every
// shared package file the API actually loads so watch-loaded-modules.mjs can
// restart the API only when one of those files changes. Editing a file only the
// browser uses, such as a canvas setting, then reloads the page without taking
// the API down.
import { registerHooks } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGES_DIR = '/usr/src/service/packages/lixpi/'
const LIST_FILE = process.env.LIXPI_API_LOADED_MODULES_FILE ?? '/dev/shm/lixpi-api-loaded-modules.txt'

const loaded = new Set()
let flush

const scheduleFlush = () => {
    if (flush)
        return

    flush = setTimeout(
        () => {
            flush = undefined
            writeFileSync(LIST_FILE, [...loaded].join('\n'))
        },
        200,
    )
    flush.unref()
}

registerHooks({
    load: (url, context, nextLoad) => {
        if (url.startsWith('file://')) {
            const path = fileURLToPath(url)

            if (
                path.startsWith(PACKAGES_DIR)
                && !path.includes('/node_modules/')
                && !loaded.has(path)
            ) {
                loaded.add(path)
                scheduleFlush()
            }
        }

        return nextLoad(url, context)
    },
})
