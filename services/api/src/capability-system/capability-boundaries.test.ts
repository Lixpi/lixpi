import {
    access,
    readdir,
    readFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import {
    describe,
    expect,
    it,
} from 'vitest'
import { withoutLayout } from '@lixpi/test-utils'

async function listTypeScriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await listTypeScriptFiles(path))
        if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path)
    }
    return files
}

async function readSources(directory: string): Promise<Array<{ path: string; source: string }>> {
    const paths = await listTypeScriptFiles(directory)
    return await Promise.all(paths.map(async path => ({
        path,
        source: await readFile(path, 'utf8'),
    })))
}

function expectSourceNotToContain(source: string, snippet: string, label: string): void {
    expect(
        withoutLayout(source).includes(withoutLayout(snippet)),
        `${label} should not contain:\n${snippet}`,
    ).toBe(false)
}

function publishedMediaStrategyNames(moduleSource: string, moduleId: string): string[] {
    const mediaStrategies = moduleSource.match(/mediaStrategies\s*:\s*\[([\s\S]*?)\]/u)?.[1]
    if (!mediaStrategies) return []
    const names = [...mediaStrategies.matchAll(/\bnew\s+([A-Z][A-Za-z0-9]*)\s*\(/gu)]
        .map(match => match[1])
        .filter(name => name !== undefined)
    expect(
        names.length,
        `${moduleId} must construct each published media strategy in its module definition`,
    ).toBeGreaterThan(0)
    return names
}

describe('Capability module architecture boundaries', () => {
    const capabilitiesRoot = new URL(
        '../../../shared/capability-system/src/capabilities/',
        import.meta.url,
    )

    it('keeps every concrete Capability in the shared package', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort()

        expect(moduleDirectories).toEqual([
            'action-timeline',
            'character-creator',
            'style-extraction',
        ])
        await expect(access(new URL('../capability-modules/', import.meta.url))).rejects.toThrow()
    })

    it('keeps packaged Capability modules independent of service implementations', async () => {
        const moduleSources = await readSources(capabilitiesRoot.pathname)
        for (const { path, source } of moduleSources) {
            expectSourceNotToContain(source, 'services/api', `${path} imports the API service`)
            expectSourceNotToContain(source, 'services/web-ui', `${path} imports the web UI service`)
        }
    })

    it('imports CapabilityError from the shared error contract', async () => {
        const moduleSources = await readSources(capabilitiesRoot.pathname)
        const invalidRegistryImport = /import\s*\{[^}]*\bCapabilityError\b[^}]*\}\s*from\s*['"][^'"]*backend\/capability-action-registry\.ts['"]/su
        for (const { path, source } of moduleSources) {
            expect(
                invalidRegistryImport.test(source),
                `${path} imports CapabilityError from a module that does not export it`,
            ).toBe(false)
        }
    })

    it('keeps each Capability module self-contained', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        for (const entry of moduleDirectories) {
            const moduleRoot = new URL(`${entry.name}/`, capabilitiesRoot)
            const files = await readdir(moduleRoot)
            expect(files.includes('backend'), `${entry.name} must expose backend behavior`).toBe(true)
            expect(files.includes('skills'), `${entry.name} must own its Skills`).toBe(true)
            for (const other of moduleDirectories.filter(candidate => candidate.name !== entry.name)) {
                const sources = await readSources(moduleRoot.pathname)
                for (const { path, source } of sources) {
                    expectSourceNotToContain(
                        source,
                        `/capabilities/${other.name}/`,
                        `${path} imports ${other.name}`,
                    )
                }
            }
        }
    })

    it('keeps module-published media runtimes owned by their Capability modules', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
        const apiSources = await readSources(new URL('../', import.meta.url).pathname)
        const genericBackendSources = (await readSources(new URL('../backend/', capabilitiesRoot).pathname))
            .filter(({ path }) => !path.endsWith('/index.ts'))

        for (const moduleDirectory of moduleDirectories) {
            const moduleId = moduleDirectory.name
            const moduleBackendSource = await readFile(
                new URL(`${moduleId}/backend/index.ts`, capabilitiesRoot),
                'utf8',
            )
            const strategyNames = publishedMediaStrategyNames(moduleBackendSource, moduleId)

            for (const { path, source } of apiSources) {
                expectSourceNotToContain(
                    source,
                    `/capabilities/${moduleId}/backend/`,
                    `${path} imports the concrete ${moduleId} backend`,
                )
                if (strategyNames.length === 0) continue
                expect(
                    path.includes(`/${moduleId}-runtime`),
                    `${path} places the ${moduleId} media runtime in the API service`,
                ).toBe(false)
                for (const strategyName of strategyNames) {
                    expectSourceNotToContain(
                        source,
                        strategyName,
                        `${path} imports the concrete ${moduleId} media strategy`,
                    )
                }
            }
            for (const { path, source } of genericBackendSources) {
                expectSourceNotToContain(
                    source,
                    `/capabilities/${moduleId}/`,
                    `${path} couples generic Capability infrastructure to ${moduleId}`,
                )
            }
        }
    })

    it('keeps module-local Skills instruction-first and free of Tool action registration', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        for (const moduleDirectory of moduleDirectories) {
            const skillsDirectory = new URL(`${moduleDirectory.name}/skills/`, capabilitiesRoot)
            const skillEntries = await readdir(skillsDirectory, { withFileTypes: true })
            const subSkills = skillEntries.filter(entry => entry.isDirectory())
            expect(subSkills.length, `${moduleDirectory.name} must contain sub-Skills`).toBeGreaterThan(0)
            for (const subSkill of subSkills) {
                const files = await readdir(new URL(`${subSkill.name}/`, skillsDirectory))
                expect(files.includes('SKILL.md'), `${moduleDirectory.name}/${subSkill.name} must contain SKILL.md`).toBe(true)
                expect(files.includes('index.ts'), `${moduleDirectory.name}/${subSkill.name} must contain index.ts`).toBe(true)
            }
            const sources = await readSources(skillsDirectory.pathname)
            for (const { path, source } of sources) {
                expectSourceNotToContain(source, 'registerActions', `${path} registers executable Tool actions`)
                expectSourceNotToContain(source, 'ActionDependencies', `${path} owns executable Tool dependencies`)
            }
        }
    })
})
