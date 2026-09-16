import chalk from 'chalk'

import {
    infoStr,
    warn,
} from '@lixpi/debug-tools'

import {
    type ProviderRequestAuthorizationResult,
    type ProviderUsageRecordRequest,
    type ProviderUsageRecordResult,
} from './provider-usage-contract.ts'
import {
    type ProviderUsageEstimateBasis,
} from './usage-estimator.ts'

// Authorization and measured usage share request correlation fields.
type LogField = [string, unknown]

const LOG_TAG = '[ProviderUsage] '

// Renders `key=value` pairs and drops anything nobody set, so a tokens line carries
// no empty video keys and a video line no token keys.
const fieldParts = (fields: LogField[]): string[] => fields.filter(([, value]) => value !== undefined && value !== '').map(
    ([key, value]) => `${chalk.gray(key)}=${chalk.white(
        String(value),
    )} `,
)

// How the estimate was reached, minus the unit, which the line already prints.
const basisFields = (basis: ProviderUsageEstimateBasis): LogField[] => {
    const {
        measuringUnit: _measuringUnit,
        ...detail
    } = basis

    return Object.entries(detail)
}

export const logRequestAuthorization = (entry: {
    model: string
    modality: string
    estimatedUnits: number
    basis: ProviderUsageEstimateBasis
    workflowId: string
    response: ProviderRequestAuthorizationResult
}): void => {
    const {
        basis,
        response,
    } = entry
    const parts = [
        chalk.blue(LOG_TAG),
        chalk.blue('authorize request '),
        ...fieldParts([
            ['model', entry.model],
            ['modality', entry.modality],
            ['estimatedUnits', entry.estimatedUnits],
            ['unit', basis.measuringUnit],
            ...basisFields(basis),
            ['authorized', response.authorized],
            ['reason', response.reason],
            ['workflowId', entry.workflowId],
            ['authorizationId', response.authorizationId],
        ]),
    ]

    // A denial and a provisional frame size both have to stand out: the second means
    // the count is arithmetic over guessed dimensions, not a provider measurement.
    if (
        !response.authorized
        || basis.provisionalVideoFrame
    ) {
        warn(
            parts.join(''),
        )

        return
    }

    infoStr(parts)
}

export const logRecordedProviderUsage = (entry: {
    request: ProviderUsageRecordRequest
    response: ProviderUsageRecordResult | undefined
}): void => {
    const {
        request,
        response,
    } = entry

    infoStr([
        chalk.blue(LOG_TAG),
        chalk.blue('recorded provider usage '),
        ...fieldParts([
            ['recorded', response?.recorded ?? false],
            ['model', request.model],
            ['modality', request.modality],
            ['unit', request.measuringUnit],
            ...Object.entries(request.usage),
            ['workflowId', request.workflowId],
            ['workflowSeq', request.workflowSeq],
            ['providerRequestId', request.providerRequestId],
            ['authorizationId', request.authorizationId],
        ]),
    ])
}
