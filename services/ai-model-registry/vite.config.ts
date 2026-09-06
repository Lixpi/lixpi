import { defineConfig } from 'vite'
import path from 'node:path'
import {
    fileURLToPath,
    pathToFileURL,
} from 'node:url'

const clientRoot = fileURLToPath(
    new URL('./src/client', import.meta.url),
)

// The client lives in src/client and builds into public/, which the Node server
// serves in the built image. In development Vite serves it instead, with HMR,
// and forwards the API to the Node server running alongside it.
export default defineConfig({
    root: 'src/client',
    publicDir: false,
    resolve: {
        alias: {
            // Same alias the web-ui client uses, so imports read the same in both.
            $src: clientRoot,
            '@lixpi/ui-primitives/styles/transitions': fileURLToPath(
                new URL('./packages/lixpi/ui-primitives/src/styles/_transitions.scss', import.meta.url),
            ),
        },
        // This half of the service is a browser client, so packages that ship
        // separate browser and server entry points resolve to the browser one.
        conditions: ['browser'],
    },
    optimizeDeps: {
        // The @lixpi/* packages are workspace source, not third-party deps.
        // Pre-bundling them caches a copy that an edit no longer reaches.
        exclude: [
            '@lixpi/constants',
            '@lixpi/ui-primitives',
        ],
        // CodeMirror ships many small ES modules. Pre-bundling them keeps the
        // dev server from serving a few hundred separate requests per reload.
        include: [
            '@codemirror/lang-json',
            '@codemirror/language',
            '@codemirror/state',
            '@codemirror/view',
            'cm6-theme-basic-dark',
            'cm6-theme-basic-light',
            'cm6-theme-gruvbox-dark',
            'cm6-theme-gruvbox-light',
            'cm6-theme-material-dark',
            'cm6-theme-nord',
            'cm6-theme-solarized-dark',
            'cm6-theme-solarized-light',
        ],
    },
    css: {
        preprocessorOptions: {
            scss: {
                // Sass has no idea about Vite's aliases, so `$src/` is resolved
                // here the same way the web-ui client resolves it.
                importers: [{
                    findFileUrl(url: string) {
                        if (url.startsWith('$src/'))
                            return pathToFileURL(
                                path.resolve(
                                    clientRoot,
                                    url.slice(5),
                                ),
                            )

                        return null
                    },
                }],
            },
        },
    },
    build: {
        outDir: '../../public',
        emptyOutDir: true,
    },
    server: {
        host: true,
        strictPort: true,
        port: Number(process.env.CLIENT_PORT ?? 3010),
        watch: {
            // Sources are bind-mounted from the host, where an atomic save lands
            // as a rename that produces no inotify event inside the container.
            // Polling is what makes a save actually reach HMR. This tree is a
            // handful of files, so the interval can stay short.
            usePolling: true,
            interval: 300,
        },
        proxy: {
            '/api': {
                target: `http://127.0.0.1:${process.env.PORT ?? 3011}`,
                changeOrigin: false,
            },
        },
    },
})
