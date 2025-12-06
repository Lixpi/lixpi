'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    formatStageResourceName,
} from '@lixpi/constants'

import { CONTAINER_INSIGHTS_ENABLED } from '../constants/logging.ts'

const {
    ORG_NAME,
    STAGE
} = process.env

export type EcsClusterArgs = {
    // Network infrastructure (required for VPC context, not used for cluster creation)
    vpc: aws.ec2.Vpc
    publicSubnets: aws.ec2.Subnet[]
    privateSubnets: aws.ec2.Subnet[]

    // Configuration options
    clusterName?: string

    // Tags
    tags?: { [key: string]: string }
}

export const createEcsCluster = async (
    args: EcsClusterArgs
) => {
    const {
        vpc,
        publicSubnets,
        privateSubnets,
        clusterName = 'EcsCluster',
        tags = {},
    } = args

    // Validate VPC and subnets (required for proper infrastructure setup)
    if (!vpc || !publicSubnets || !privateSubnets) {
        throw new Error('VPC and subnets are required for ECS cluster creation')
    }

    if (privateSubnets.length < 2) {
        throw new Error('At least 2 private subnets are required for high availability')
    }

    // Format resource names
    const formattedClusterName = formatStageResourceName(clusterName, ORG_NAME, STAGE)

    // Merge default tags with custom tags
    const defaultTags = {
        Name: formattedClusterName,
        ManagedBy: 'pulumi',
        LaunchType: 'FARGATE',
    }

    const resourceTags = { ...defaultTags, ...tags }

    // ==========================================
    // Create ECS Cluster (Fargate-only)
    // ==========================================
    const cluster = new aws.ecs.Cluster(formattedClusterName, {
        name: formattedClusterName,
        settings: [{
            name: 'containerInsights',
            value: CONTAINER_INSIGHTS_ENABLED ? 'enabled' : 'disabled',
        }],
        tags: resourceTags,
    })

    // ==========================================
    // Return cluster resources and outputs
    // ==========================================
    return {
        // Resources
        cluster,

        // Outputs as pulumi.Output to be shared with other stacks
        outputs: {
            clusterId: cluster.id,
            clusterName: cluster.name,
            clusterArn: cluster.arn,
        }
    }
}
