import { mergeConfig } from 'vitest/config'
import { createWebClientVitestConfig } from '@lixpi/web-client-service-factory/vite'

// The navigation contract test imports the API's domain implementation.
// Resolve its shared dependencies from this test workspace as well.
export default mergeConfig(
    createWebClientVitestConfig(),
    {
        resolve: {
            dedupe: [
                '@lixpi/constants',
                '@lixpi/debug-tools',
                '@lixpi/prosemirror',
                'prosemirror-model',
            ],
        },
    },
)
