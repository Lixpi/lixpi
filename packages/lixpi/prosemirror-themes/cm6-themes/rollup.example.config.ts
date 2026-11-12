import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import dev from 'rollup-plugin-dev'
import typescript from 'rollup-plugin-typescript2'
import {
    type RollupOptions,
} from 'rollup'

const config: RollupOptions = {
    input: './example/index.ts',
    output: [
        {
            format: 'es',
            dir: './example/dist/',
            externalLiveBindings: false,
        },
    ],
    external: [],
    plugins: [
        typescript({
            check: false,
            tsconfigOverride: {
                compilerOptions: {
                    lib: ['es5', 'es6'],
                    sourceMap: true,
                    target: 'es6',
                    strict: false,
                },
            },
        }),
        resolve(),
        commonjs(),
        dev({
            dirs: ['example'],
            port: 8_000,
        }),
    ],
}

export default config
