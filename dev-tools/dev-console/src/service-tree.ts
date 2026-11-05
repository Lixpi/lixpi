import * as path from 'node:path'
import {
    type ComposeCatalog,
} from './compose-catalog.ts'
import {
    type TreeNode,
} from '@lixpi/cli-ui/tree-selection'

export type ServiceGroup = {
    label: string
    groups?: ServiceGroup[]
    services?: string[]
}

export const SERVICE_GROUP_VALUE = 'group'

// Compose decides which services exist and which are part of the base stack. The
// repository's console config only arranges them for people: a name Compose no longer
// has is dropped, and a base service missing from the groups still appears under
// "Other services", so the base stack can't lose one.
export class ServiceTree {
    readonly roots: TreeNode[]
    readonly allServices: string[]

    // The services `docker compose --profile <base profile> up` would start.
    readonly baseServices: string[]

    constructor(
        private readonly catalog: ComposeCatalog,
        groups: ServiceGroup[],
        private readonly rootComposeFile: string,
        baseProfile?: string,
    ) {
        const placed = new Set(
            groups.flatMap(group => this.servicesIn(group)),
        )
        const unplaced = catalog
            .all().map(service => service.name).filter(name => catalog.startsByDefault(name, baseProfile) && !placed.has(name))
        const children = [
            ...groups,
            {
                label: 'Other services',
                services: unplaced,
            },
        ].flatMap(group => this.groupNode(group, SERVICE_GROUP_VALUE))

        this.allServices = children.flatMap(node => this.leaves(node))
        this.baseServices = this.allServices.filter(name => catalog.startsByDefault(name, baseProfile))
        this.roots = [
            {
                value: 'choice:services',
                label: 'Services',
                hint: 'Custom selection',
                choices: [
                    {
                        value: 'base',
                        label: 'Base',
                        hint: 'What the application needs to run',
                        selection: this.baseServices,
                    },
                    {
                        value: 'all',
                        label: 'All',
                        hint: 'Base plus the admin and developer tools',
                        selection: this.allServices,
                    },
                ],
            },
            ...children,
        ]
    }

    describe(services: string[]): string {
        if (this.isSameSelection(services, this.baseServices))
            return 'Base services'

        return this.isSameSelection(services, this.allServices) ? 'All services' : services.join(', ')
    }

    private isSameSelection(
        left: string[],
        right: string[],
    ): boolean {
        return left.length === right.length && right.every(name => left.includes(name))
    }

    private groupNode(
        group: ServiceGroup,
        parentValue: string,
    ): TreeNode[] {
        const value = `${parentValue}/${group.label}`
        const children = [
            ...(group.groups ?? []).flatMap(child => this.groupNode(child, value)),
            ...this.serviceNodes(group.services ?? []),
        ]

        if (!children.length)
            return []

        return [{
            value,
            label: group.label,
            hint: this.partialFileOf(group),
            children,
        }]
    }

    private serviceNodes(names: string[]): TreeNode[] {
        return names.filter(name => this.catalog.has(name)).map(
            name => ({
                value: name,
                label: name,
            }),
        )
    }

    // Names the partial Compose file when a whole group lives in one, which shows
    // where that group is defined.
    private partialFileOf(group: ServiceGroup): string | undefined {
        const files = new Set(
            this.servicesIn(group).filter(name => this.catalog.has(name)).map(name => this.catalog.fileOf(name)),
        )
        const [file] = files

        return files.size === 1
            && file !== this.rootComposeFile
            ? path.basename(file!)
            : undefined
    }

    private servicesIn(group: ServiceGroup): string[] {
        return [
            ...(group.groups ?? []).flatMap(child => this.servicesIn(child)),
            ...(group.services ?? []),
        ]
    }

    private leaves(node: TreeNode): string[] {
        return node.children
            ? node.children.flatMap(child => this.leaves(child))
            : [node.value]
    }
}
