import path from "path"
import { pathToFileURL } from "url"
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        svelte(),
    ],
    test: {
        environment: 'happy-dom',
        globals: true,
        include: ['src/**/*.test.ts'],
        alias: {
            $src: path.resolve("./src"),
        },
    },
    server: {
        host: true,
        strictPort: true,
        port: 5173,
        watch: {
            // Sources are bind-mounted from Windows, where inotify events never arrive,
            // so the watcher has to poll. A stat() on that mount costs ~2-3 ms and the
            // libuv threadpool serves roughly 1.6k of them a second, against ~3.1k
            // watched files. Anything below a ~3 s interval asks for more stats than
            // that budget allows, and the backlog queues ahead of the file reads that
            // serve module requests. Raising the interval is what keeps the two apart;
            // the cost is that an edit takes up to `interval` to reach HMR.
            usePolling: true,
            interval: 3000,
            binaryInterval: 6000,
        },
    },
    optimizeDeps: {
        // Without explicit entries the dependency scanner globs `**/*.html` across the
        // whole bind-mounted root to find its entry points — a recursive crawl that takes
        // seconds there, and that also picks up the vendored cm6-themes example page.
        entries: [
            'index.html',
        ],
    },
    // mode:'development',
    resolve: {
        alias: {
            $src: path.resolve("./src"),
        },

        // Without this it was throwing  (Error during service initialization Svelte error: lifecycle_function_unavailable`mount(...)` is not available on the server)
        // What does it even mean???
        // Found solution here:
        //      https://github.com/sveltejs/svelte/discussions/12037
        //      https://github.com/sveltejs/svelte/issues/11394
        conditions: ['browser']
        // END
    },

    // SASS $src alias - same as TypeScript/JavaScript aliases
    // https://sass-lang.com/documentation/js-api/interfaces/importer/
    css: {
        preprocessorOptions: {
            scss: {
                importers: [{
                    findFileUrl(url: string) {
                        if (url.startsWith('$src/')) {
                            const resolved = path.resolve('./src', url.slice(5))
                            return pathToFileURL(resolved)
                        }
                        return null
                    }
                }],
            },
        },
    },
})
