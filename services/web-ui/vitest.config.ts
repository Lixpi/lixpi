import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        include: ['src/**/*.test.ts'],
        alias: {
            $src: path.resolve('./src'),
        },
    },
    resolve: {
        alias: {
            $src: path.resolve('./src'),
        },
    },
})
