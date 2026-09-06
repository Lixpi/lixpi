import * as aws from '@pulumi/aws'
import type * as pulumi from '@pulumi/pulumi'

import { formatStageResourceName } from '@lixpi/constants'

export type CertificateArgs = {
    orgName: string
    stage: string
    domainName: string
    hostedZoneId: pulumi.Input<string>
    serviceName: string
    dnsProvider: aws.Provider
}

export type CertificateResult = {
    certificate: aws.acm.Certificate
    certValidation: aws.acm.CertificateValidation
    outputs: {
        certificateArn: aws.acm.Certificate['arn']
        validatedCertificateArn: aws.acm.CertificateValidation['certificateArn']
    }
}

export const createCertificate = async (args: CertificateArgs): Promise<CertificateResult> => {
    const {
        orgName,
        stage,
        domainName,
        hostedZoneId,
        serviceName,
        dnsProvider,
    } = args

    const certificate = new aws.acm.Certificate(
        `${formatStageResourceName(
            serviceName,
            orgName,
            stage,
        )}-cert`,
        {
            domainName: domainName,
            validationMethod: 'DNS',
            subjectAlternativeNames: [
                domainName,
                `www.${domainName}`,
                `*.${domainName}`,
            ],
            tags: {
                Name: `${serviceName}-cert`,
            },
        },
    )

    // Extract unique validation records from ACM's response to avoid duplicates
    const certValidationRecords = certificate.domainValidationOptions.apply(options => {
        // Create a Map to track unique records by name
        const uniqueRecords = new Map()

        // Process each validation option
        options.forEach((option, i) => {
            // Use the record name as the unique key
            const recordKey = option.resourceRecordName

            // Only add to our map if we haven't seen this record name before
            if (!uniqueRecords.has(recordKey)) {
                uniqueRecords.set(
                    recordKey,
                    new aws.route53.Record(
                        `${formatStageResourceName(
                            serviceName,
                            orgName,
                            stage,
                        )}-cert-validation-${i}`,
                        {
                            name: option.resourceRecordName,
                            zoneId: hostedZoneId,
                            type: option.resourceRecordType,
                            records: [option.resourceRecordValue],
                            ttl: 60,
                        },
                        {
                            // Don't use dnsProvider for delegated zone - use default credentials
                            deleteBeforeReplace: true,
                        },
                    ),
                )
            }
        })

        // Return array of unique validation records
        return Array.from(
            uniqueRecords.values(),
        )
    })

    // Certificate validation resource for all SANs
    const certValidation = new aws.acm.CertificateValidation(
        `${formatStageResourceName(
            serviceName,
            orgName,
            stage,
        )}-cert-validation-complete`,
        {
            certificateArn: certificate.arn,
            validationRecordFqdns: certValidationRecords.apply(records => records.map(r => r.fqdn)),
        },
    )

    return {
        certificate,
        certValidation,
        outputs: {
            certificateArn: certificate.arn,
            validatedCertificateArn: certValidation.certificateArn,
        },
    }
}
