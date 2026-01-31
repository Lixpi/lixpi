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
            $lib: path.resolve("./packages/shadcn-svelte/lib"),
        },
    },
    server: {    // This fixes watch mode on Windows
        host: true,
        strictPort: true,
        port: 5173,
        watch: {
            usePolling: true,
        },
    },
    // mode:'development',
    resolve: {
        alias: {
            $src: path.resolve("./src"),
            $lib: path.resolve("./packages/shadcn-svelte/lib"),
        },

        // YOU FUCKING PIECE OF FUCKING SHIT!!!!!
        // Without this it was throwing  (Error during service initialization Svelte error: lifecycle_function_unavailable`mount(...)` is not available on the server)
        // What the fuck does it even mean???
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
                        if (url.startsWith('$lib/')) {
                            const resolved = path.resolve('./packages/shadcn-svelte/lib', url.slice(5))
                            return pathToFileURL(resolved)
                        }
                        return null
                    }
                }],
            },
        },
    },
})
