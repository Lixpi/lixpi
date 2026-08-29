import { defineConfig } from 'vite'

// The client lives in src/client and builds into public/, which the Node server
// serves in the built image. In development Vite serves it instead, with HMR,
// and forwards the API to the Node server running alongside it.
export default defineConfig({
    root: 'src/client',
    publicDir: false,
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
