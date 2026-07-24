'use strict'

import { Context } from 'aws-lambda'
import {
    Route53Client,
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand
} from '@aws-sdk/client-route-53'
import {
    ECSClient,
    DescribeContainerInstancesCommand,
    DescribeTasksCommand,
    ListTasksCommand
} from '@aws-sdk/client-ecs'
import {
    EC2Client,
    DescribeInstancesCommand,
    DescribeNetworkInterfacesCommand
} from '@aws-sdk/client-ec2'

type ECSTaskStateChangeEvent = {
    version: string
    id: string
    'detail-type': 'ECS Task State Change'
    source: 'aws.ecs'
    account: string
    time: string
    region: string
    resources: string[]
    detail: {
        clusterArn: string
        taskArn: string
        taskDefinitionArn: string
        lastStatus: string
        desiredStatus: string
        containers: Array<{
            containerArn: string
            name: string
            lastStatus: string
            healthStatus?: string
            networkInterfaces?: Array<{
                privateIpv4Address: string
                publicIpv4Address?: string
            }>
        }>
        connectivity: string
        connectivityAt: string
        pullStartedAt?: string
        pullStoppedAt?: string
        executionStoppedAt?: string
        createdAt: string
        startedAt?: string
        stoppedAt?: string
        stoppedReason?: string
        stopCode?: string
        group: string
        launchType: string
        platformVersion: string
        platformFamily: string
        cpu: string
        memory: string
        healthStatus?: string
    }
}

// Union type for both event types
type CloudWatchEvent = ECSTaskStateChangeEvent

const route53Client = new Route53Client({
    region: process.env.AWS_REGION
})

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION
})

const ec2Client = new EC2Client({
    region: process.env.AWS_REGION
})

const log = (message: string, data?: any) => {
    console.log(`[NATS-ServiceDiscovery] ${message}`, data ? JSON.stringify(data, null, 2) : '')
}

const isTaskReadyForRegistration = (task: any): boolean => {
    // Check container status for NATS container
    const natsContainer = task.containers?.find((container: any) =>
        container.name === 'nats' || container.name.includes('nats')
    )

    if (natsContainer) {
        // Container must be running
        if (natsContainer.lastStatus !== 'RUNNING') {
            return false
        }

        // If health status is explicitly UNHEALTHY, don't register
        if (natsContainer.healthStatus === 'UNHEALTHY') {
            return false
        }

        // Allow UNKNOWN, HEALTHY, or no health status
        // This handles the case where health checks haven't completed yet
    }

    // Allow registration for RUNNING tasks even if overall health is UNKNOWN
    // Only reject if explicitly UNHEALTHY
    if (task.healthStatus === 'UNHEALTHY') {
        return false
    }

    return true
}

const getTaskPublicIP = async (taskArn: string, clusterArn: string): Promise<string | null> => {
    try {
        const response = await ecsClient.send(new DescribeTasksCommand({
            cluster: clusterArn,
            tasks: [taskArn],
            include: ['TAGS']
        }))

        const task = response.tasks?.[0]
        if (!task) {
            log('Task not found', { taskArn })
            return null
        }

        // Look for network interface ID in task ENI attachments
        let networkInterfaceId: string | null = null
        for (const attachment of task.attachments || []) {
            if (attachment.type === 'ElasticNetworkInterface') {
                for (const detail of attachment.details || []) {
                    if (detail.name === 'networkInterfaceId' && detail.value) {
                        networkInterfaceId = detail.value
                        break
                    }
                }
            }
            if (networkInterfaceId) break
        }

        if (!networkInterfaceId && task.containerInstanceArn) {
            const containerInstances = await ecsClient.send(new DescribeContainerInstancesCommand({
                cluster: clusterArn,
                containerInstances: [task.containerInstanceArn],
            }))
            const ec2InstanceId = containerInstances.containerInstances?.[0]?.ec2InstanceId
            if (ec2InstanceId) {
                const instances = await ec2Client.send(new DescribeInstancesCommand({ InstanceIds: [ec2InstanceId] }))
                const publicIP = instances.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress
                if (publicIP) return publicIP
            }
        }

        if (!networkInterfaceId) {
            log('No network interface or EC2 public IP found for task', { taskArn })
            return null
        }

        // Describe the network interface to get the public IP
        const eniResponse = await ec2Client.send(new DescribeNetworkInterfacesCommand({
            NetworkInterfaceIds: [networkInterfaceId]
        }))

        const networkInterface = eniResponse.NetworkInterfaces?.[0]
        const publicIP = networkInterface?.Association?.PublicIp

        if (publicIP) {
            log('Found public IP via network interface', {
                taskArn,
                networkInterfaceId,
                publicIP
            })
            return publicIP
        }

        log('No public IP found for task', {
            taskArn,
            networkInterfaceId,
            hasAssociation: !!networkInterface?.Association
        })
        return null
    } catch (error) {
        const err = error as Error
        log('Error getting task public IP', { taskArn, error: err.message })
        return null
    }
}

const updateRoute53Records = async (
    hostedZoneId: string,
    recordName: string,
    publicIPs: string[],
    ttl: number = 60
): Promise<boolean> => {
    try {
        const changeRequest = {
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
                Changes: [{
                    Action: 'UPSERT' as const,
                    ResourceRecordSet: {
                        Name: recordName,
                        Type: 'A' as const,
                        TTL: ttl,
                        ResourceRecords: publicIPs.map(ip => ({ Value: ip }))
                    }
                }]
            }
        }

        const response = await route53Client.send(new ChangeResourceRecordSetsCommand(changeRequest))
        log('Successfully updated Route53 records', {
            hostedZoneId,
            recordName,
            ips: publicIPs,
            changeId: response.ChangeInfo?.Id
        })
        return true
    } catch (error) {
        const err = error as Error
        log('Error updating Route53 records', {
            hostedZoneId,
            recordName,
            ips: publicIPs,
            error: err.message
        })
        return false
    }
}

// Get all healthy NATS task IPs from the cluster
const getAllHealthyNatsTaskIPs = async (clusterArn: string): Promise<string[]> => {
    const healthyIPs: string[] = []

    try {
        // List all NATS tasks in cluster
        const listResponse = await ecsClient.send(new ListTasksCommand({
            cluster: clusterArn,
            desiredStatus: 'RUNNING'
        }))

        if (!listResponse.taskArns || listResponse.taskArns.length === 0) {
            log('No running tasks found in cluster')
            return healthyIPs
        }

        // Describe all tasks to get their health status
        const describeResponse = await ecsClient.send(new DescribeTasksCommand({
            cluster: clusterArn,
            tasks: listResponse.taskArns,
            include: ['TAGS']
        }))

        // Get public IPs for healthy NATS tasks
        for (const task of describeResponse.tasks || []) {
            // Only process NATS tasks
            if (task.taskDefinitionArn && isNATSTask(task.taskDefinitionArn)) {
                if (isTaskReadyForRegistration(task)) {
                    const publicIP = await getTaskPublicIP(task.taskArn!, clusterArn)
                    if (publicIP) {
                        healthyIPs.push(publicIP)
                    }
                }
            }
        }

        log('Found healthy NATS task IPs', { count: healthyIPs.length, ips: healthyIPs })
        return healthyIPs
    } catch (error) {
        const err = error as Error
        log('Error getting healthy NATS task IPs', { error: err.message })
        return healthyIPs
    }
}

const isNATSTask = (taskDefinitionArn: string): boolean => {
    // Check if this is a NATS task based on task definition ARN
    return !!taskDefinitionArn && taskDefinitionArn.includes('nats')
}

const generateInstanceId = (taskArn: string): string => {
    // Extract task ID from ARN and create a predictable instance ID
    const taskId = taskArn.split('/').pop() || taskArn
    return `nats-${taskId}`
}

export const handler = async (event: CloudWatchEvent, context: Context) => {
    const {
        ROUTE53_HOSTED_ZONE_ID,
        NATS_RECORD_NAME,
        ECS_CLUSTER_ARN,
        NATS_CLIENT_PORT = '4222'
    } = process.env

    if (!ROUTE53_HOSTED_ZONE_ID) {
        log('Missing ROUTE53_HOSTED_ZONE_ID environment variable')
        return
    }

    if (!NATS_RECORD_NAME) {
        log('Missing NATS_RECORD_NAME environment variable')
        return
    }

    if (!ECS_CLUSTER_ARN) {
        log('Missing ECS_CLUSTER_ARN environment variable')
        return
    }

    log('Received ECS task state change event', {
        taskArn: event.detail.taskArn,
        lastStatus: event.detail.lastStatus,
        desiredStatus: event.detail.desiredStatus,
        healthStatus: event.detail.healthStatus,
        connectivity: event.detail.connectivity
    })

    const { detail } = event
    const { taskArn, taskDefinitionArn, lastStatus, desiredStatus, clusterArn } = detail

    // Only process NATS tasks
    if (!isNATSTask(taskDefinitionArn)) {
        log('Ignoring non-NATS task', { taskDefinitionArn })
        return
    }

    log('NATS task state changed, rebuilding Route53 record set', {
        taskArn,
        lastStatus,
        desiredStatus
    })

    try {
        // On ANY NATS task state change, rebuild the entire record set
        // This ensures we always have the current set of healthy IPs
        const healthyIPs = await getAllHealthyNatsTaskIPs(clusterArn)

        if (healthyIPs.length > 0) {
            // Update Route53 with all healthy IPs
            await updateRoute53Records(
                ROUTE53_HOSTED_ZONE_ID,
                NATS_RECORD_NAME,
                healthyIPs
            )
            log('Successfully updated Route53 with healthy NATS IPs', {
                recordName: NATS_RECORD_NAME,
                ipCount: healthyIPs.length,
                ips: healthyIPs
            })
        } else {
            log('Warning: No healthy NATS tasks found, keeping existing Route53 record', {
                taskArn,
                recordName: NATS_RECORD_NAME
            })
            // Note: We don't delete the record when no healthy tasks exist
            // This prevents DNS resolution failures during rolling deployments
        }
    } catch (error) {
        const err = error as Error
        log('Error processing NATS task state change', {
            taskArn,
            error: err.message,
            stack: err.stack
        })
        // Don't throw error to avoid Lambda retries for unrecoverable errors
    }
}
