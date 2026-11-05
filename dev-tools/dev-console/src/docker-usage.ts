import {
    type TreeNode,
} from '@lixpi/cli-ui/tree-selection'

export type DockerUsageRow = {
    type: string
    count: string
    active: string
    size: string
    reclaimable: string
}

// `docker system df` reports these types, and each one maps to a prune tree row.
const TREE_VALUE_BY_USAGE_TYPE: Record<string, string> = {
    Images: 'group:images',
    Containers: 'containers',
    'Local Volumes': 'group:volumes',
    'Build Cache': 'group:build-cache',
}

// Reads `docker system df --format '{{json .}}'`, one JSON object per line. Disk
// usage is only informative, so anything unreadable is left out rather than stopping
// the prune.
export const parseDockerUsage = (text: string): DockerUsageRow[] =>
    text.split('\n').flatMap(line => {
        try {
            const row = JSON.parse(line) as Record<string, unknown>

            if (
                typeof row.Type !== 'string'
                || typeof row.Size !== 'string'
            )
                return []

            return [{
                type: row.Type,
                count: String(row.TotalCount ?? ''),
                active: String(row.Active ?? ''),
                size: row.Size,
                reclaimable: String(row.Reclaimable ?? ''),
            }]
        } catch {
            return []
        }
    })

export const renderDockerUsage = (rows: DockerUsageRow[]): string => {
    const table = [
        [
            'Type',
            'Total',
            'Active',
            'Size',
            'Reclaimable',
        ],
        ...rows.map(
            row => [
                row.type,
                row.count,
                row.active,
                row.size,
                row.reclaimable,
            ],
        ),
    ]
    const widths = table[0].map((_, column) => Math.max(...table.map(cells => cells[column].length)))

    return table.map(
        cells =>
                cells.map((cell, column) => cell.padEnd(widths[column]))
                    .join('  ')
                    .trimEnd(),
    )
        .join('\n')
}

export const addUsageToTree = (
    nodes: TreeNode[],
    rows: DockerUsageRow[],
): TreeNode[] =>
    nodes.map(node => {
        const row = rows.find(candidate => TREE_VALUE_BY_USAGE_TYPE[candidate.type] === node.value)

        return {
            ...node,
            hint: row ? `${row.size}, ${row.reclaimable} reclaimable` : node.hint,
            children: node.children && addUsageToTree(node.children, rows),
        }
    })
