import * as aws from '@pulumi/aws'
import type * as pulumi from '@pulumi/pulumi'
import {
    plInfo,
    plWarn,
    plError,
} from '../pulumiLogger.ts'

import { formatStageResourceName } from '@lixpi/constants'

// Generic interface for different record types
export type DnsRecordConfig = {
    name: string
    type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA'
    ttl?: number

    // For simple records
    records?: string[]

    // For alias records
    alias?: {
        name: pulumi.Input<string>
        zoneId: pulumi.Input<string>
        evaluateTargetHealth?: boolean
    }

    // For weighted, latency, or failover records
    setIdentifier?: string
    weight?: number
    healthCheckId?: string
    failover?: 'PRIMARY' | 'SECONDARY'
}

export type DnsRecordsArgs = {
    orgName: string
    stage: string
    hostedZoneId: string
    records: DnsRecordConfig[]
    serviceName: string
    dnsProvider?: aws.Provider
}

export const createDnsRecords = async (args: DnsRecordsArgs) => {
    const {
        orgName,
        stage,
        hostedZoneId,
        records,
        serviceName,
        dnsProvider,
    } = args

    // Create DNS records for all configurations
    const createdRecords: { [key: string]: aws.route53.Record } = {}

    records.forEach((record, index) => {
        const recordName = formatStageResourceName(`${serviceName}-Route53-record-${index}`, orgName, stage)

        const recordArgs: aws.route53.RecordArgs = {
            name: record.name,
            zoneId: hostedZoneId,
            type: record.type,
            // Allow overwrite so we don't create duplicate record sets if they already exist
            allowOverwrite: true,
        }

        // Configure record based on type
        if (record.alias) {
            recordArgs.aliases = [{
                name: record.alias.name,
                zoneId: record.alias.zoneId,
                evaluateTargetHealth: record.alias.evaluateTargetHealth ?? true,
            }]
        } else if (record.records) {
            recordArgs.records = record.records
            recordArgs.ttl = record.ttl || 300
        }

        // Add additional configurations if provided
        if (record.setIdentifier) recordArgs.setIdentifier = record.setIdentifier
        if (record.weight !== undefined) recordArgs.weightedRoutingPolicies = [{ weight: record.weight }]
        if (record.healthCheckId) recordArgs.healthCheckId = record.healthCheckId
        if (record.failover) recordArgs.failoverRoutingPolicies = [{ type: record.failover }]

        // Create the record
        const recordOptions: pulumi.ResourceOptions = {}
        if (dnsProvider) {
            recordOptions.provider = dnsProvider
        }

        const dnsRecord = new aws.route53.Record(recordName, recordArgs, recordOptions)

        createdRecords[recordName] = dnsRecord
    })

    return {
        records: createdRecords,
        outputs: {
            recordNames: Object.values(createdRecords).map(record => record.name),
            fqdns: Object.values(createdRecords).map(record => record.fqdn),
        },
    }
}

export type CreateHostedZoneArgs = {
    orgName: string
    stage: string
    domainName: string // e.g., "firstName-dev.lixpi.dev" or production|staging|dev as a root
    serviceName: string // logical name prefix
}

export const createHostedZone = async (args: CreateHostedZoneArgs) => {
    const { domainName, serviceName } = args

    const hostedZone = new aws.route53.Zone(`${serviceName}-hosted-zone`, {
        name: domainName,
        comment: `Hosted zone for ${domainName}`,
        // Never want Pulumi to destroy and recreate a public hosted zone automatically
        // (manual registrar updates depend on stability of NS set)
    })

    return {
        hostedZone,
        outputs: {
            hostedZoneId: hostedZone.zoneId,
            nameServers: hostedZone.nameServers,
            domainName,
        },
    }
}

// Helper that reuses an existing public hosted zone if it already exists (by name),
// only creating a new one if none found. Prevents accidental duplicate zones which
// would cause conflicting NS delegations at the registrar.
export const getOrCreateHostedZone = async (args: CreateHostedZoneArgs & { protectExisting?: boolean }) => {
    const { domainName, serviceName } = args

    plInfo(`🔍 [getOrCreateHostedZone] Starting lookup for domain: "${domainName}"`)
    plInfo(`🔍 [getOrCreateHostedZone] Service name: "${serviceName}"`)

    // Normalize domain (Route53 may return with trailing dot)
    const normalized = domainName.endsWith('.') ? domainName : `${domainName}.`
    plInfo(`🔍 [getOrCreateHostedZone] Normalized domain name: "${normalized}"`)

    // Try multiple lookup strategies
    const lookupStrategies = [
        { name: normalized, description: `normalized with dot: "${normalized}"` },
        { name: domainName, description: `original domain: "${domainName}"` },
        { name: domainName.endsWith('.') ? domainName.slice(0, -1) : domainName, description: `without dot: "${domainName.endsWith('.') ? domainName.slice(0, -1) : domainName}"` },
    ]

    for (const strategy of lookupStrategies) {
        plInfo(`🔍 [getOrCreateHostedZone] Trying lookup strategy: ${strategy.description}`)
        try {
            const existing = await aws.route53.getZone({ name: strategy.name })
            if (existing) {
                plInfo(`✅ [getOrCreateHostedZone] Found existing hosted zone (will import).`)
                plInfo(`✅ [getOrCreateHostedZone] Zone ID: ${existing.zoneId}`)
                plInfo(`✅ [getOrCreateHostedZone] Zone Name: ${existing.name}`)
                plInfo(`✅ [getOrCreateHostedZone] Name servers: ${JSON.stringify(existing.nameServers)}`)

                const importedZone = new aws.route53.Zone(`${serviceName}-hosted-zone`, {
                    name: domainName,
                    comment: `Hosted zone for ${domainName} (imported)`,
                }, {
                    import: existing.zoneId,
                    // Protect existing zone from accidental deletion; can be disabled by removing protect.
                    protect: true,
                })

                return {
                    hostedZone: importedZone,
                    reused: true,
                    outputs: {
                        hostedZoneId: importedZone.zoneId,
                        nameServers: importedZone.nameServers,
                        domainName: domainName,
                    },
                }
            } else {
                plWarn(`❌ [getOrCreateHostedZone] Strategy "${strategy.description}" returned null/undefined`)
            }
        } catch (error) {
            plError(`❌ [getOrCreateHostedZone] Strategy "${strategy.description}" failed with error:`)
            plError(`❌ [getOrCreateHostedZone] Error type: ${(error as any)?.constructor?.name}`)
            plError(`❌ [getOrCreateHostedZone] Error message: ${(error as any)?.message}`)
            if ((error as any).code) {
                plError(`❌ [getOrCreateHostedZone] Error code: ${(error as any).code}`)
            }
        }
    }

    plWarn(`🚫 [getOrCreateHostedZone] No existing hosted zone found after trying all strategies`)
    plInfo(`🆕 [getOrCreateHostedZone] Creating new hosted zone for domain: "${domainName}"`)

    const created = await createHostedZone(args)
    plInfo(`✅ [getOrCreateHostedZone] Created new hosted zone successfully`)
    return { ...created, reused: false }
}

export type CreateDelegationRecordArgs = {
    parentHostedZoneId: string // Parent zone id (e.g. lixpi.dev zone)
    subdomainName: string // The subdomain we are delegating (e.g. firstName-dev.lixpi.dev)
    nameServers: pulumi.Output<string[]> // Nameservers from created child zone
    serviceName: string
    dnsProvider: aws.Provider // Provider with permissions in parent account
}

export const createDelegationRecord = (args: CreateDelegationRecordArgs) => {
    const { parentHostedZoneId, subdomainName, nameServers, serviceName, dnsProvider } = args

    return new aws.route53.Record(`${serviceName}-delegation-ns`, {
        zoneId: parentHostedZoneId,
        name: subdomainName,
        type: 'NS',
        ttl: 300,
        records: nameServers,
    }, { provider: dnsProvider })
}
