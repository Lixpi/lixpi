import * as path from 'node:path'
import {
    type ComposeCatalog,
} from './compose-catalog.ts'
import {
    type TreeNode,
} from '@lixpi/cli-ui/tree-selection'
import {
    type DockerGroup,
    type DockerLayout,
} from './docker-layout.ts'

// The tree mirrors infrastructure/docker/services/: each directory is a group, named
// by its docker-group.json, and each partial in it adds its services in file order.
// Compose decides which services are part of the base stack through the base profile.
export class ServiceTree {
    readonly roots: TreeNode[]
    readonly allServices: string[]

    // The services `docker compose --profile <base profile> up` would start.
    readonly baseServices: string[]

    constructor(
        private readonly catalog: ComposeCatalog,
        layout: DockerLayout,
    ) {
        const children = (layout.services?.groups ?? []).map(group => this.groupNode(group))

        this.allServices = children.flatMap(node => this.leaves(node))
        this.baseServices = this.allServices.filter(name => catalog.startsByDefault(name, layout.baseProfile))
        this.roots = [
            {
                value: 'preset:base',
                label: 'Base services',
                hint: 'What the application needs to run',
                selection: this.baseServices,
            },
            {
                value: 'preset:all',
                label: 'All services',
                hint: 'Base plus the admin and developer tools',
                selection: this.allServices,
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

    private groupNode(group: DockerGroup): TreeNode {
        const services = this.catalog.all().filter(service => group.files.includes(service.file))

        return {
            value: `group:${group.directory}`,
            label: group.label,
            hint: group.files.length === 1
                && !group.groups.length
                ? path.basename(group.files[0])
                : undefined,
            children: [
                ...group.groups.map(child => this.groupNode(child)),
                ...services.map(
                    service => ({
                        value: service.name,
                        label: service.name,
                    }),
                ),
            ],
        }
    }

    private leaves(node: TreeNode): string[] {
        return node.children
            ? node.children.flatMap(child => this.leaves(child))
            : [node.value]
    }
}
