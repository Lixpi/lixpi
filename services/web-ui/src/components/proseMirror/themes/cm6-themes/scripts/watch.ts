import { watch } from '@marijn/buildtool'
import {
    readdirSync,
    lstatSync,
} from 'node:fs'
import {
    dirname,
    resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspacePath = resolve(scriptDirectory, '..', 'packages')
const packages = readdirSync(workspacePath)
    .filter((file) => lstatSync(resolve(workspacePath, file)).isDirectory())

watch(packages.map((packageName) => resolve(workspacePath, packageName, 'src', 'index.ts')))
