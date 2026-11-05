import {
    type TreeNode,
} from '@lixpi/cli-ui/tree-selection'

// Pruning covers the whole Docker host, so nothing is preselected. Space on a group
// selects every option in it. prune-docker.sh accepts only these leaf values.
export const PRUNE_TREE: TreeNode[] = [
    {
        value: 'group:resources',
        label: 'Resources',
        children: [
            {
                value: 'containers',
                label: 'Stopped containers',
            },
            {
                value: 'group:images',
                label: 'Images',
                children: [
                    {
                        value: 'images-dangling',
                        label: 'Dangling images',
                        hint: 'Untagged leftovers from earlier builds',
                    },
                    {
                        value: 'images-unused',
                        label: 'All unused images',
                        hint: 'They must be pulled or rebuilt afterwards',
                    },
                ],
            },
            {
                value: 'networks',
                label: 'Unused networks',
            },
            {
                value: 'group:volumes',
                label: 'Volumes',
                children: [
                    {
                        value: 'volumes-anonymous',
                        label: 'Unused anonymous volumes',
                    },
                    {
                        value: 'volumes-all',
                        label: 'All unused volumes',
                        hint: 'Deletes data, including DynamoDB and NATS once their containers are removed',
                    },
                ],
            },
            {
                value: 'group:build-cache',
                label: 'Build cache',
                children: [
                    {
                        value: 'build-cache-dangling',
                        label: 'Dangling build cache',
                    },
                    {
                        value: 'build-cache-all',
                        label: 'All build cache',
                        hint: 'The next builds run from scratch',
                    },
                ],
            },
        ],
    },
    {
        value: 'group:system',
        label: 'System',
        children: [
            {
                value: 'system',
                label: 'System prune',
                hint: 'Stopped containers, unused networks, dangling images and build cache',
            },
            {
                value: 'system-all',
                label: 'System prune, all',
                hint: 'Also every unused image and all build cache',
            },
            {
                value: 'system-all-volumes',
                label: 'System prune, all with volumes',
                hint: 'Also unused anonymous volumes; named volumes stay',
            },
        ],
    },
]

export const DATA_LOSS_PRUNE_TARGET = 'volumes-all'
