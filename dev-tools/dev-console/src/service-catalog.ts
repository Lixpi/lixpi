// What a service reports about itself when asked for its catalog. The console renders
// this and holds no list of its own, so a service's commands can't drift from it.
export type ServiceCommand = {
    name: string
    label: string
    description?: string
    effect: 'read' | 'change' | 'destroy'
    available: boolean
    blockedReason?: string
    takesEnvFile?: boolean
    arguments?: {
        name: string
        prompt: string
    }[]
}

export type ServiceCatalog = {
    target: {
        summary: string
        rows: {
            label: string
            value: string
        }[]
    }
    commands: ServiceCommand[]
}

// Build tools can print around the catalog, so it's the last line that holds an object.
export const parseServiceCatalog = (text: string): ServiceCatalog | undefined => {
    const line = text
        .split('\n').map(candidate => candidate.trim()).findLast(candidate => candidate.startsWith('{'))

    if (!line)
        return undefined

    try {
        const catalog = JSON.parse(line) as ServiceCatalog

        return Array.isArray(catalog.commands)
            && Array.isArray(catalog.target?.rows)
            ? catalog
            : undefined
    } catch {
        return undefined
    }
}
