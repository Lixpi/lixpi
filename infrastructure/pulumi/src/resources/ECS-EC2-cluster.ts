'use strict'

/**
 * ⚠️ DEPRECATED - NOT USED ANYMORE ⚠️
 *
 * This file creates an ECS cluster with EC2 instances for container hosting.
 * The infrastructure has been migrated to Fargate-only deployment.
 *
 * See: ECS-cluster.ts for the current Fargate-only implementation.
 *
 * This file is kept for reference purposes only. If EC2 support is needed
 * in the future, this code can be used as a starting point.
 */

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    formatStageResourceName,
} from '@lixpi/constants'

import { LOG_RETENTION_DAYS } from '../constants/logging.ts'

const {
    ORG_NAME,
    STAGE
} = process.env

export interface EcsEc2ClusterInfrastructureArgs {
    // Network infrastructure
    vpc: aws.ec2.Vpc
    publicSubnets: aws.ec2.Subnet[]
    privateSubnets: aws.ec2.Subnet[]

    // Configuration options
    clusterName?: string
    instanceType?: string
    minCapacity?: number
    maxCapacity?: number
    desiredCapacity?: number

    // Tags
    tags?: { [key: string]: string }
}

export const createEcsEc2Cluster = async (
    args: EcsEc2ClusterInfrastructureArgs
) => {
    const {
        vpc,
        publicSubnets,
        privateSubnets,
        clusterName = 'EcsCluster',
        instanceType = 't3.micro',
        minCapacity = 1,
        maxCapacity = 1,
        desiredCapacity = 1,
        tags = {},
    } = args

    // Validate VPC and subnets
    if (!vpc || !publicSubnets || !privateSubnets) {
        throw new Error('VPC and subnets must be provided to create ECS EC2 infrastructure')
    }

    if (privateSubnets.length < 2) {
        throw new Error('At least two private subnets should be provided for high availability')
    }

    // Format resource names
    const formattedClusterName = formatStageResourceName(clusterName, ORG_NAME, STAGE)

    // Merge default tags with custom tags
    const defaultTags = {
        Name: formattedClusterName,
        ManagedBy: 'pulumi',
    }

    const resourceTags = { ...defaultTags, ...tags }

    // ==========================================
    // 1. Create ECS Cluster
    // ==========================================
    const cluster = new aws.ecs.Cluster(formattedClusterName, {
        name: formattedClusterName,
        settings: [{
            name: 'containerInsights',
            value: 'enabled',
        }],
        tags: resourceTags,
    })

    // ==========================================
    // 2. Create IAM roles and instance profile
    // ==========================================

    // IAM role for EC2 instances to join ECS cluster
    const ecsInstanceRole = new aws.iam.Role('ecsInstanceRole', {
        assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [{
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: {
                    Service: 'ec2.amazonaws.com',
                },
            }],
        }),
        tags: resourceTags,
    })

    // Attach ECS EC2 container service role
    const ecsServicePolicyAttachment = new aws.iam.RolePolicyAttachment('ecsServicePolicy', {
        role: ecsInstanceRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
    })

    // Explicitly attach ECR permissions to EC2 instances IAM role (critical for EC2 ECS agent!)
    new aws.iam.RolePolicyAttachment('ecsInstanceECRPolicy', {
        role: ecsInstanceRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
    })

    // Attach SSM managed instance core policy for secure instance management
    const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment('ssmPolicy', {
        role: ecsInstanceRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
    })

    // Create instance profile for EC2 instances
    const instanceProfile = new aws.iam.InstanceProfile('ecsInstanceProfile', {
        role: ecsInstanceRole.name,
        tags: resourceTags,
    })

    // ==========================================
    // 3. Create security groups
    // ==========================================

    // Security group for ECS instances
    const ecsSecurityGroup = new aws.ec2.SecurityGroup('ecsSecurityGroup', {
        vpcId: vpc.id,
        description: 'Security group for ECS EC2 instances',
        ingress: [
            // Allow all traffic from within the security group
            {
                protocol: '-1',  // All protocols
                fromPort: 0,
                toPort: 0,
                self: true,
                description: 'Allow all traffic within security group',
            },
        ],
        egress: [
            // Allow all outbound traffic
            {
                protocol: '-1',  // All protocols
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound traffic',
            },
            // Add explicit rules to allow ECS instances to access ECR in ECS-EC2-cluster.ts
            {
                protocol: 'tcp',
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow HTTPS outbound for ECR and other services',
            },
        ],
        tags: { ...resourceTags, Name: formatStageResourceName('ECS-SG', ORG_NAME, STAGE) },
    })

    // ==========================================
    // 4. Find latest ECS-optimized AMI
    // ==========================================
    const ecsOptimizedAmi = await aws.ec2.getAmi({
        mostRecent: true,
        owners: ['amazon'],
        filters: [
            {
                name: 'name',
                values: ['amzn2-ami-ecs-hvm-*-x86_64-ebs'],
            },
        ],
    })

    // ==========================================
    // 5. Create Launch Template
    // ==========================================

    // User data script to join ECS cluster
    // const userData = pulumi.interpolate`
    //     #!/bin/bash
    //     echo "ECS_CLUSTER=${cluster.name}" >> /etc/ecs/ecs.config
    //     echo "ECS_ENABLE_CONTAINER_METADATA=true" >> /etc/ecs/ecs.config
    //     echo "ECS_AVAILABLE_LOGGING_DRIVERS=[\"json-file\",\"awslogs\"]" >> /etc/ecs/ecs.config
    // `

    const userData = pulumi.interpolate`
#!/bin/bash
echo "ECS_CLUSTER=${cluster.name}" >> /etc/ecs/ecs.config
echo "ECS_ENABLE_CONTAINER_METADATA=true" >> /etc/ecs/ecs.config
echo 'ECS_AVAILABLE_LOGGING_DRIVERS=["json-file","awslogs"]' >> /etc/ecs/ecs.config
`

    // Create launch template
    const launchTemplate = new aws.ec2.LaunchTemplate('ecsLaunchTemplate', {
        namePrefix: 'app-lt-',
        imageId: ecsOptimizedAmi.id,
        instanceType: instanceType,
        // Remove vpcSecurityGroupIds from here since we're specifying it in networkInterfaces
        iamInstanceProfile: {
            name: instanceProfile.name,
        },
        // Add network interface configuration to ensure public IP assignment
        networkInterfaces: [{
            associatePublicIpAddress: true,  // This ensures EC2 instances get public IPs
            deviceIndex: 0,
            securityGroups: [ecsSecurityGroup.id],   // Changed from 'groups' to 'securityGroups'
            deleteOnTermination: true,
        }],
        userData: userData.apply(data => Buffer.from(data).toString('base64')),
        blockDeviceMappings: [{
            deviceName: '/dev/xvda',
            ebs: {
                volumeSize: 30,
                volumeType: 'gp3',
                deleteOnTermination: true,
            },
        }],
        monitoring: {
            enabled: true,
        },
        tagSpecifications: [
            {
                resourceType: 'instance',
                tags: { ...resourceTags, Name: formatStageResourceName('ECS-Instance', ORG_NAME, STAGE) },
            },
            {
                resourceType: 'volume',
                tags: { ...resourceTags, Name: formatStageResourceName('ECS-Volume', ORG_NAME, STAGE) },
            },
        ],
    })

    // ==========================================
    // 6. Create Auto Scaling Group
    // ==========================================

    // Get public subnet IDs for ASG - moved from private to public subnets
    const publicSubnetIds = publicSubnets.map(subnet => subnet.id)

    // Create auto scaling group with instance protection enabled
    const autoScalingGroup = new aws.autoscaling.Group('ecsAutoScalingGroup', {
        name: formatStageResourceName('ECS-ASG', ORG_NAME, STAGE),
        vpcZoneIdentifiers: publicSubnetIds,  // Changed from privateSubnetIds to publicSubnetIds
        minSize: minCapacity,
        maxSize: maxCapacity,
        desiredCapacity: desiredCapacity,
        defaultCooldown: 300,
        healthCheckType: 'EC2',
        healthCheckGracePeriod: 300,
        // Enable instance protection from scale-in (Required for ECS Capacity Provider with ManagedTerminationProtection)
        protectFromScaleIn: true,
        launchTemplate: {
            id: launchTemplate.id,
            version: '$Latest',
        },
        // Force instance refresh when launch template changes
        instanceRefresh: {
            strategy: "Rolling",
            preferences: {
                minHealthyPercentage: 50,
                instanceWarmup: 300,
            },
            triggers: ["tag"],  // Trigger refresh on tag changes
        },
        terminationPolicies: ['OldestInstance', 'Default'],
        tags: [
            ...Object.entries(resourceTags).map(([key, value]) => ({
                key,
                value,
                propagateAtLaunch: true,
            })),
            {
                key: 'AmazonECSManaged',
                value: '',
                propagateAtLaunch: true,
            },
        ],
    })

    // ==========================================
    // 7. Create ECS Capacity Provider
    // ==========================================
    const capacityProvider = new aws.ecs.CapacityProvider('capacityProvider', {
        name: `app-cp-${pulumi.getStack()}`,
        autoScalingGroupProvider: {
            autoScalingGroupArn: autoScalingGroup.arn,
            managedScaling: {
                status: 'ENABLED',
                targetCapacity: 70,
                minimumScalingStepSize: 1,
                maximumScalingStepSize: 2,
                instanceWarmupPeriod: 300,
            },
            managedTerminationProtection: 'ENABLED',
        },
        tags: resourceTags,
    })

    // ==========================================
    // 8. Associate capacity provider with cluster
    // ==========================================
    const clusterCapacityProviderAssociation = new aws.ecs.ClusterCapacityProviders('clusterCapacityProviders', {
        clusterName: cluster.name,
        capacityProviders: [capacityProvider.name],
        defaultCapacityProviderStrategies: [{
            capacityProvider: capacityProvider.name,
            weight: 1,
            base: 1,
        }],
    })

    // ==========================================
    // 9. Create CloudWatch Log Group for ECS
    // ==========================================
    const logGroup = new aws.cloudwatch.LogGroup('ecsLogGroup', {
        name: `/aws/ecs/${formattedClusterName}`,
        retentionInDays: LOG_RETENTION_DAYS,
        tags: resourceTags,
    })

    // ==========================================
    // Return resources and outputs
    // ==========================================
    return {
        // Resources
        cluster,
        ecsInstanceRole,
        instanceProfile,
        ecsSecurityGroup,
        launchTemplate,
        autoScalingGroup,
        capacityProvider,
        logGroup,

        // Outputs as pulumi.Output to be shared with other stacks
        outputs: {
            clusterId: cluster.id,
            clusterName: cluster.name,
            clusterArn: cluster.arn,
            capacityProviderName: capacityProvider.name,
            securityGroupId: ecsSecurityGroup.id,
            instanceRoleArn: ecsInstanceRole.arn,
            instanceProfileArn: instanceProfile.arn,
            logGroupName: logGroup.name,
        }
    }
}
