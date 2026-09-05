import * as aws from '@pulumi/aws'

import * as process from 'process'

import { formatStageResourceName } from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE,
} = process.env

export const createSsmParameters = () => {
    // --- Parameters (non-sensitive) ----------------------------------

    const originHostUrlParam = new aws.ssm.Parameter(
        'ORIGIN_HOST_URL',
        {
            name: formatStageResourceName(
                'ORIGIN_HOST_URL',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: process.env.ORIGIN_HOST_URL || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
        },
    )

    const apiHostUrlParam = new aws.ssm.Parameter(
        'API_HOST_URL',
        {
            name: formatStageResourceName(
                'API_HOST_URL',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: process.env.API_HOST_URL || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
        },
    )

    const auth0DomainParam = new aws.ssm.Parameter(
        'AUTH0_DOMAIN',
        {
            name: formatStageResourceName(
                'AUTH0_DOMAIN',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: process.env.AUTH0_DOMAIN || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
        },
    )

    const auth0ApiIdentifierParam = new aws.ssm.Parameter(
        'AUTH0_API_IDENTIFIER',
        {
            name: formatStageResourceName(
                'AUTH0_API_IDENTIFIER',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: process.env.AUTH0_API_IDENTIFIER || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
        },
    )

    const aiTokensUsageTopicArnParam = new aws.ssm.Parameter(
        'AI_TOKENS_USAGE_TOPIC_ARN',
        {
            name: formatStageResourceName(
                'AI_TOKENS_USAGE_TOPIC_ARN',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER', // left empty as in original code
        },
    )

    const saveLlmResponsesParam = new aws.ssm.Parameter(
        'SAVE_LLM_RESPONSES_TO_DEBUG_DIR',
        {
            name: formatStageResourceName(
                'SAVE_LLM_RESPONSES_TO_DEBUG_DIR',
                ORG_NAME,
                STAGE,
            ),
            type: 'String',
            value: process.env.SAVE_LLM_RESPONSES_TO_DEBUG_DIR || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
        },
    )

    const webUiParams = {
        VITE_AUTH0_LOGIN_URL: new aws.ssm.Parameter(
            'VITE_AUTH0_LOGIN_URL',
            {
                name: formatStageResourceName(
                    'VITE_AUTH0_LOGIN_URL',
                    ORG_NAME,
                    STAGE,
                ),
                type: 'String',
                value: process.env.VITE_AUTH0_LOGIN_URL || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
            },
        ),
        VITE_AUTH0_DOMAIN: new aws.ssm.Parameter(
            'VITE_AUTH0_DOMAIN',
            {
                name: formatStageResourceName(
                    'VITE_AUTH0_DOMAIN',
                    ORG_NAME,
                    STAGE,
                ),
                type: 'String',
                value: process.env.VITE_AUTH0_DOMAIN || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
            },
        ),
        VITE_AUTH0_CLIENT_ID: new aws.ssm.Parameter(
            'VITE_AUTH0_CLIENT_ID',
            {
                name: formatStageResourceName(
                    'VITE_AUTH0_CLIENT_ID',
                    ORG_NAME,
                    STAGE,
                ),
                type: 'String',
                value: process.env.VITE_AUTH0_CLIENT_ID || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
            },
        ),
        VITE_AUTH0_AUDIENCE: new aws.ssm.Parameter(
            'VITE_AUTH0_AUDIENCE',
            {
                name: formatStageResourceName(
                    'VITE_AUTH0_AUDIENCE',
                    ORG_NAME,
                    STAGE,
                ),
                type: 'String',
                value: process.env.VITE_AUTH0_AUDIENCE || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
            },
        ),
        VITE_AUTH0_REDIRECT_URI: new aws.ssm.Parameter(
            'VITE_AUTH0_REDIRECT_URI',
            {
                name: formatStageResourceName(
                    'VITE_AUTH0_REDIRECT_URI',
                    ORG_NAME,
                    STAGE,
                ),
                type: 'String',
                value: process.env.VITE_AUTH0_REDIRECT_URI || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
            },
        ),
    }

    // --- Secrets (sensitive parameters) ----------------------------------

    // const openApiKeySecret = new aws.secretsmanager.Secret('OPENAI_API_KEY', {
    //     name: formatStageResourceName('OPENAI_API_KEY', ORG_NAME, STAGE),
    // })

    // const openApiKeySecretValue = new aws.secretsmanager.SecretVersion('OPENAI_API_KEY_Value', {
    //     secretId: openApiKeySecret.id,
    //     secretString: process.env.OPENAI_API_KEY || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
    // })

    // const anthropicApiKeySecret = new aws.secretsmanager.Secret('ANTHROPIC_API_KEY', {
    //     name: formatStageResourceName('ANTHROPIC_API_KEY', ORG_NAME, STAGE),
    // })

    // const anthropicApiKeySecretValue = new aws.secretsmanager.SecretVersion('ANTHROPIC_API_KEY_Value', {
    //     secretId: anthropicApiKeySecret.id,
    //     secretString: process.env.ANTHROPIC_API_KEY || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
    // })

    // const stripeSecretKeySecret = new aws.secretsmanager.Secret('STRIPE_SECRET_KEY', {
    //     name: formatStageResourceName('STRIPE_SECRET_KEY', ORG_NAME, STAGE),
    // })

    // const stripeSecretKeySecretValue = new aws.secretsmanager.SecretVersion('STRIPE_SECRET_KEY_Value', {
    //     secretId: stripeSecretKeySecret.id,
    //     secretString: process.env.STRIPE_SECRET_KEY || 'PLACEHOLDER_VALUE_TO_BE_UPDATED_LATER',
    // })

    // --- Outputs ------------------------------------------------------------

    const outputs = {
        appHostAddresses: {
            ORIGIN_HOST_URL: originHostUrlParam.name,
            API_HOST_URL: apiHostUrlParam.name,
        },
        auth0Config: {
            AUTH0_DOMAIN: auth0DomainParam.name,
            AUTH0_API_IDENTIFIER: auth0ApiIdentifierParam.name,
        },
        aiConfig: {
            SAVE_LLM_RESPONSES_TO_DEBUG_DIR: saveLlmResponsesParam.name,
            // OPENAI_API_KEY_SECRET_ARN: openApiKeySecret.arn,
            // ANTHROPIC_API_KEY_SECRET_ARN: anthropicApiKeySecret.arn,
        },
        stripeConfig: {
            // STRIPE_SECRET_KEY_SECRET_ARN: stripeSecretKeySecret.arn,
        },
        webUiConfig: {
            VITE_AUTH0_LOGIN_URL: webUiParams.VITE_AUTH0_LOGIN_URL.name,
            VITE_AUTH0_DOMAIN: webUiParams.VITE_AUTH0_DOMAIN.name,
            VITE_AUTH0_CLIENT_ID: webUiParams.VITE_AUTH0_CLIENT_ID.name,
            VITE_AUTH0_AUDIENCE: webUiParams.VITE_AUTH0_AUDIENCE.name,
            VITE_AUTH0_REDIRECT_URI: webUiParams.VITE_AUTH0_REDIRECT_URI.name,
        },
    }

    return {
        parameters: {
            originHostUrlParam,
            apiHostUrlParam,
            auth0DomainParam,
            auth0ApiIdentifierParam,
            aiTokensUsageTopicArnParam,
            saveLlmResponsesParam,
            webUiParams,
        },
        secrets: {
            // openApiKeySecret,
            // anthropicApiKeySecret,
            // stripeSecretKeySecret,
        },
        outputs,
    }
}
