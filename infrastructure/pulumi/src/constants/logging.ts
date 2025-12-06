'use strict'

// CloudWatch Logging Configuration Constants

const {
    CLOUDWATCH_LOG_RETENTION_DAYS,
    CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED
} = process.env

// Valid CloudWatch log retention values (in days)
// See: https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html
const VALID_RETENTION_DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653] as const
type ValidRetentionDays = typeof VALID_RETENTION_DAYS[number]

const parseRetentionDays = (value: string | undefined): ValidRetentionDays => {
    if (!value) {
        throw new Error('CLOUDWATCH_LOG_RETENTION_DAYS environment variable is required')
    }
    const retentionDays = parseInt(value, 10)

    if (VALID_RETENTION_DAYS.includes(retentionDays as ValidRetentionDays)) {
        return retentionDays as ValidRetentionDays
    }
    throw new Error(`Invalid CLOUDWATCH_LOG_RETENTION_DAYS value "${value}". Valid values: ${VALID_RETENTION_DAYS.join(', ')}`)
}

// How long to retain CloudWatch logs before automatic deletion (in days)
export const LOG_RETENTION_DAYS: ValidRetentionDays = parseRetentionDays(CLOUDWATCH_LOG_RETENTION_DAYS)

if (!CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED) {
    throw new Error('CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED environment variable is required')
}

// Whether to enable ECS Container Insights for cluster-level metrics and logs
// When enabled: Provides CPU/memory graphs, task-level debugging, anomaly detection
export const CONTAINER_INSIGHTS_ENABLED: boolean = CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED.toLowerCase() === 'true'
