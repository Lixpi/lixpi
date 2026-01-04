import { sveltePreprocess } from 'svelte-preprocess';
import path from 'path';
import { pathToFileURL } from 'url';

import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: [
        sveltePreprocess({
            defaults: { style: 'scss' },
            scss: {
                includePaths: ['src'],
                prependData: `
                    @import "sass/_variables.scss";
                    @import "sass/_transitions.scss";
                    @import "sass/themes/_minimalist-chic.scss";
                `,
                importer: [
                    (url) => {
                        if (url.startsWith('$src/')) {
                            return { file: path.resolve('./src', url.slice(5)) };
                        }
                        if (url.startsWith('$lib/')) {
                            return { file: path.resolve('./packages/shadcn-svelte/lib', url.slice(5)) };
                        }
                        return null;
                    }
                ]
            },
            typescript: false    // Disable TypeScript processing in svelte-preprocess, Svelte 5 supports it out of the box
        }),
        vitePreprocess({ script: true, style: false }),
    ],

    onwarn(warning, defaultHandler) {
        if (warning.code === 'css_unused_selector') return;    // Fuck off unused css selector warning

        // handle all other warnings normally
        defaultHandler(warning);
    },

    // kit: {        // Do I even need it? Isn't it only for Svelte-Kit ????????????????????????????????????????????????????????????????????????
    //     // adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
    //     // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
    //     // See https://svelte.dev/docs/kit/adapters for more information about adapters.
    //     adapter: adapter({    /// Do I really need this ????????????????????????????????????????????????????????????????????????????????????
    //         pages: 'build',
    //         assets: 'build',
    //         fallback: undefined,
    //         precompress: false,
    //         strict: true
    //     })
    // }
};

export default config;
