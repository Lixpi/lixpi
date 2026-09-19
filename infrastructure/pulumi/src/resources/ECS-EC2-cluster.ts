import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { formatStageResourceName } from '@lixpi/constants'

import { LOG_RETENTION_DAYS } from '../constants/logging.ts'

const {
    ORG_NAME,
    STAGE,
} = process.env

export type EcsEc2ClusterInfrastructureArgs = {
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
    dataVolumeSizeGiB?: number
    cpuTargetPercent?: number
    instanceWarmupSeconds?: number

    // Tags
    tags?: { [key: string]: string }
}

export const createEcsEc2Cluster = async (args: EcsEc2ClusterInfrastructureArgs) => {
    const {
        vpc,
        publicSubnets,
        privateSubnets,
        clusterName = 'EcsCluster',
        instanceType = 't3.small',
        minCapacity = 3,
        maxCapacity = 3,
        desiredCapacity = 3,
        dataVolumeSizeGiB = 150,
        cpuTargetPercent = 60,
        instanceWarmupSeconds = 300,
        tags = {},
    } = args

    // Validate VPC and subnets
    if (
        !vpc
        || !publicSubnets
        || !privateSubnets
    )
        throw new Error('VPC and subnets must be provided to create ECS EC2 infrastructure')

    if (
        publicSubnets.length < 3
        || privateSubnets.length < 3
    )
        throw new Error('NATS requires subnets in three Availability Zones')

    if (
        ![minCapacity, maxCapacity, desiredCapacity].every(Number.isInteger)
        || minCapacity < 3
        || maxCapacity < minCapacity
        || desiredCapacity < minCapacity
        || desiredCapacity > maxCapacity
    )
        throw new Error('NATS capacity must satisfy 3 <= minimum <= desired <= maximum')

    if (
        !Number.isFinite(cpuTargetPercent)
        || cpuTargetPercent <= 0
        || cpuTargetPercent >= 100
    )
        throw new Error('NATS CPU target must be between 0 and 100 percent')

    if (
        !Number.isInteger(instanceWarmupSeconds)
        || instanceWarmupSeconds < 60
    )
        throw new Error('NATS instance warmup must be at least 60 seconds')

    const instance = await aws.ec2.getInstanceType({ instanceType })

    if (
        instance.memorySize < 2048
        || !instance.supportedArchitectures.includes('x86_64')
    )
        throw new Error('NATS requires an x86_64 instance with at least 2 GiB memory')

    if (
        !Number.isInteger(dataVolumeSizeGiB)
        || dataVolumeSizeGiB < 150
    )
        throw new Error('NATS requires at least 150 GiB EBS for its 100 GiB store and recovery headroom')

    // Format resource names
    const formattedClusterName = formatStageResourceName(
        clusterName,
        ORG_NAME,
        STAGE,
    )

    // Merge default tags with custom tags
    const defaultTags = {
        Name: formattedClusterName,
        ManagedBy: 'pulumi',
    }

    const resourceTags = {
        ...defaultTags,
        ...tags,
    }

    // ==========================================
    // 1. Create ECS Cluster
    // ==========================================
    const cluster = new aws.ecs.Cluster(
        formattedClusterName,
        {
            name: formattedClusterName,
            settings: [{
                name: 'containerInsights',
                value: 'enabled',
            }],
            tags: resourceTags,
        },
    )

    // ==========================================
    // 2. Create IAM roles and instance profile
    // ==========================================

    // IAM role for EC2 instances to join ECS cluster
    const ecsInstanceRole = new aws.iam.Role(
        'ecsInstanceRole',
        {
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
        },
    )

    // Attach ECS EC2 container service role
    const ecsServicePolicyAttachment = new aws.iam.RolePolicyAttachment(
        'ecsServicePolicy',
        {
            role: ecsInstanceRole.name,
            policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
        },
    )

    // Explicitly attach ECR permissions to EC2 instances IAM role (critical for EC2 ECS agent!)
    new aws.iam.RolePolicyAttachment(
        'ecsInstanceECRPolicy',
        {
            role: ecsInstanceRole.name,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
        },
    )

    // Attach SSM managed instance core policy for secure instance management
    const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment(
        'ssmPolicy',
        {
            role: ecsInstanceRole.name,
            policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
        },
    )

    // Create instance profile for EC2 instances
    const instanceProfile = new aws.iam.InstanceProfile(
        'ecsInstanceProfile',
        {
            role: ecsInstanceRole.name,
            tags: resourceTags,
        },
    )

    // ==========================================
    // 3. Create security groups
    // ==========================================

    // Security group for ECS instances
    const ecsSecurityGroup = new aws.ec2.SecurityGroup(
        'ecsSecurityGroup',
        {
            vpcId: vpc.id,
            description: 'Security group for ECS EC2 instances',
            egress: [
                // Allow all outbound traffic
                {
                    protocol: '-1', // All protocols
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
            tags: {
                ...resourceTags,
                Name: formatStageResourceName(
                    'ECS-SG',
                    ORG_NAME,
                    STAGE,
                ),
            },
        },
    )

    // ==========================================
    // 4. Find latest ECS-optimized AMI
    // ==========================================
    const ecsOptimizedAmi = await aws.ssm.getParameter({
        name: '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id',
    })

    // ==========================================
    // 5. Create Launch Template
    // ==========================================

    const userData = pulumi.interpolate`
#!/bin/bash
set -euo pipefail
echo "ECS_CLUSTER=${cluster.name}" >> /etc/ecs/ecs.config
echo 'ECS_RESERVED_MEMORY=512' >> /etc/ecs/ecs.config
echo "ECS_ENABLE_CONTAINER_METADATA=true" >> /etc/ecs/ecs.config
echo 'ECS_AVAILABLE_LOGGING_DRIVERS=["json-file","awslogs"]' >> /etc/ecs/ecs.config
mkdir -p /etc/systemd/system/ecs.service.d
printf '%s\\n' '[Unit]' 'RequiresMountsFor=/data/jetstream' 'ConditionPathIsMountPoint=/data/jetstream' > /etc/systemd/system/ecs.service.d/jetstream.conf
systemctl daemon-reload
DATA_DEVICE=/dev/xvdh
if [ ! -b "${'$'}{DATA_DEVICE}" ]; then
    DATA_DEVICE=''
    for DEVICE in /dev/nvme*n1; do
        [ -b "${'$'}{DEVICE}" ] || continue
        if ebsnvme-id -u "${'$'}{DEVICE}" 2>/dev/null | grep -qx '/dev/xvdh'; then
            DATA_DEVICE="${'$'}{DEVICE}"
            break
        fi
    done
fi
[ -b "${'$'}{DATA_DEVICE}" ] || { echo 'JetStream EBS device not found' >&2; exit 1; }
if ! blkid "${'$'}{DATA_DEVICE}"; then mkfs -t xfs "${'$'}{DATA_DEVICE}"; fi
mkdir -p /data/jetstream
mountpoint -q /data/jetstream || mount "${'$'}{DATA_DEVICE}" /data/jetstream
DATA_UUID=$(blkid -s UUID -o value "${'$'}{DATA_DEVICE}")
grep -q "^UUID=${'$'}{DATA_UUID} " /etc/fstab \
    || echo "UUID=${'$'}{DATA_UUID} /data/jetstream xfs defaults 0 2" >> /etc/fstab
chmod 700 /data/jetstream
systemctl daemon-reload
`

    // Create launch template
    const launchTemplate = new aws.ec2.LaunchTemplate(
        'ecsLaunchTemplate',
        {
            namePrefix: 'app-lt-',
            imageId: ecsOptimizedAmi.value,
            instanceType: instanceType,
            ...(instanceType.startsWith('t3') ? { creditSpecification: { cpuCredits: 'unlimited' } } : {}),
            metadataOptions: {
                httpTokens: 'required',
                httpPutResponseHopLimit: 2,
            },
            // Remove vpcSecurityGroupIds from here since we're specifying it in networkInterfaces
            iamInstanceProfile: {
                name: instanceProfile.name,
            },
            // Add network interface configuration to ensure public IP assignment
            networkInterfaces: [{
                associatePublicIpAddress: true, // This ensures EC2 instances get public IPs
                deviceIndex: 0,
                securityGroups: [ecsSecurityGroup.id], // Changed from 'groups' to 'securityGroups'
                deleteOnTermination: true,
            }],
            userData: userData.apply(data => Buffer.from(data).toString('base64')),
            blockDeviceMappings: [
                {
                    deviceName: '/dev/xvda',
                    ebs: {
                        volumeSize: 30,
                        volumeType: 'gp3',
                        encrypted: true,
                        deleteOnTermination: true,
                    },
                },
                {
                    deviceName: '/dev/xvdh',
                    ebs: {
                        volumeSize: dataVolumeSizeGiB,
                        volumeType: 'gp3',
                        encrypted: true,
                        deleteOnTermination: false,
                    },
                },
            ],
            monitoring: {
                enabled: true,
            },
            tagSpecifications: [
                {
                    resourceType: 'instance',
                    tags: {
                        ...resourceTags,
                        Name: formatStageResourceName(
                            'ECS-Instance',
                            ORG_NAME,
                            STAGE,
                        ),
                    },
                },
                {
                    resourceType: 'volume',
                    tags: {
                        ...resourceTags,
                        Name: formatStageResourceName(
                            'ECS-Volume',
                            ORG_NAME,
                            STAGE,
                        ),
                    },
                },
            ],
        },
    )

    // ==========================================
    // 6. Create Auto Scaling Group
    // ==========================================

    // Get public subnet IDs for ASG - moved from private to public subnets
    const publicSubnetIds = publicSubnets.map(subnet => subnet.id)

    // Create auto scaling group with instance protection enabled
    const autoScalingGroup = new aws.autoscaling.Group(
        'ecsAutoScalingGroup',
        {
            name: formatStageResourceName(
                'ECS-ASG',
                ORG_NAME,
                STAGE,
            ),
            vpcZoneIdentifiers: publicSubnetIds, // Changed from privateSubnetIds to publicSubnetIds
            minSize: minCapacity,
            maxSize: maxCapacity,
            desiredCapacity: desiredCapacity,
            availabilityZoneDistribution: { capacityDistributionStrategy: 'balanced-only' },
            defaultCooldown: 300,
            defaultInstanceWarmup: instanceWarmupSeconds,
            healthCheckType: 'EC2',
            healthCheckGracePeriod: 300,
            // Only the evacuation controller may terminate a broker after its replicas move.
            protectFromScaleIn: true,
            launchTemplate: {
                id: launchTemplate.id,
                version: '$Latest',
            },
            // Host replacement requires a replica-recovery gate, not a timed ASG refresh.
            suspendedProcesses: ['AZRebalance', 'ReplaceUnhealthy'],
            terminationPolicies: ['OldestInstance', 'Default'],
            tags: [
                ...Object.entries(resourceTags).map(
                    ([key, value]) => ({
                        key,
                        value,
                        propagateAtLaunch: true,
                    }),
                ),
                {
                    key: 'AmazonECSManaged',
                    value: '',
                    propagateAtLaunch: true,
                },
            ],
        },
        { ignoreChanges: ['desiredCapacity'] },
    )

    const cpuScalingPolicy = new aws.autoscaling.Policy(
        'nats-host-cpu-scaling',
        {
            autoscalingGroupName: autoScalingGroup.name,
            policyType: 'TargetTrackingScaling',
            targetTrackingConfiguration: {
                predefinedMetricSpecification: { predefinedMetricType: 'ASGAverageCPUUtilization' },
                targetValue: cpuTargetPercent,
                disableScaleIn: true,
            },
        },
    )

    // ==========================================
    // 7. Create ECS Capacity Provider
    // ==========================================
    const capacityProvider = new aws.ecs.CapacityProvider(
        'capacityProvider',
        {
            name: `app-cp-${pulumi.getStack()}`,
            autoScalingGroupProvider: {
                autoScalingGroupArn: autoScalingGroup.arn,
                managedScaling: {
                    status: 'DISABLED',
                    targetCapacity: 70,
                    minimumScalingStepSize: 1,
                    maximumScalingStepSize: 2,
                    instanceWarmupPeriod: 300,
                },
                managedTerminationProtection: 'DISABLED',
            },
            tags: resourceTags,
        },
    )

    // ==========================================
    // 8. Associate capacity provider with cluster
    // ==========================================
    const clusterCapacityProviderAssociation = new aws.ecs.ClusterCapacityProviders(
        'clusterCapacityProviders',
        {
            clusterName: cluster.name,
            capacityProviders: [capacityProvider.name],
            defaultCapacityProviderStrategies: [{
                capacityProvider: capacityProvider.name,
                weight: 1,
                base: 1,
            }],
        },
    )

    // ==========================================
    // 9. Create CloudWatch Log Group for ECS
    // ==========================================
    const logGroup = new aws.cloudwatch.LogGroup(
        'ecsLogGroup',
        {
            name: `/aws/ecs/${formattedClusterName}`,
            retentionInDays: LOG_RETENTION_DAYS,
            tags: resourceTags,
        },
    )

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
        cpuScalingPolicy,
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
        },
    }
}
