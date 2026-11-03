import * as aws from '@pulumi/aws'
import {
    type Input,
} from '@pulumi/pulumi'

import { formatStageResourceName } from '@lixpi/constants'

export type CertificateArgs = {
    orgName: string
    stage: string
    domainName: string
    hostedZoneId: Input<string>
    serviceName: string
    dnsProvider?: aws.Provider
    identity?: {
        resourceName: string
        validationResourceName: string
        validationRecordPrefix: string
        tagName: string
        provider: aws.Provider
    }
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
        identity,
    } = args

    const resourceBase = formatStageResourceName(
        serviceName,
        orgName,
        stage,
    )

    const certificate = new aws.acm.Certificate(
        identity?.resourceName ?? `${resourceBase}-cert`,
        {
            domainName: domainName,
            validationMethod: 'DNS',
            subjectAlternativeNames: [
                domainName,
                `www.${domainName}`,
                `*.${domainName}`,
            ],
            tags: {
                Name: identity?.tagName ?? `${serviceName}-cert`,
            },
        },
        identity ? { provider: identity.provider } : undefined,
    )

    // Preserve the default record indexes while allowing existing compact identities.
    const certValidationRecords = certificate.domainValidationOptions.apply(options => {
        const uniqueRecords = new Map<string, aws.route53.Record>()

        options.forEach((option, originalIndex) => {
            const recordKey = option.resourceRecordName

            if (!uniqueRecords.has(recordKey)) {
                const recordIndex = identity ? uniqueRecords.size : originalIndex
                const validationRecordPrefix = identity?.validationRecordPrefix ?? `${resourceBase}-cert-validation`

                uniqueRecords.set(
                    recordKey,
                    new aws.route53.Record(
                        `${validationRecordPrefix}-${recordIndex}`,
                        {
                            name: option.resourceRecordName,
                            zoneId: hostedZoneId,
                            type: option.resourceRecordType,
                            records: [option.resourceRecordValue],
                            ttl: 60,
                            ...(identity ? { allowOverwrite: true } : {}),
                        },
                        identity
                            ? undefined
                            : {
                                // Delegated zones use the default credentials.
                                deleteBeforeReplace: true,
                            },
                    ),
                )
            }
        })

        return Array.from(
            uniqueRecords.values(),
        )
    })

    const certValidation = new aws.acm.CertificateValidation(
        identity?.validationResourceName ?? `${resourceBase}-cert-validation-complete`,
        {
            certificateArn: certificate.arn,
            validationRecordFqdns: certValidationRecords.apply(records => records.map(r => r.fqdn)),
        },
        identity ? { provider: identity.provider } : undefined,
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
