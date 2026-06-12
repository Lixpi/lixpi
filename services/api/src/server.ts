'use strict'

import process from 'process'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import DynamoDBService from '@lixpi/dynamodb-service'
import SSMService from '@lixpi/ssm-service'
import NATS_Service from '@lixpi/nats-service'
import { startNatsAuthCalloutService } from '@lixpi/nats-auth-callout-service'

import { createServer } from 'http'

// SQS pollers imports ******************************************
// import SqsPollingService from './SQS-pollers/polling-service.ts'
// import { userSubscriptionSqsPollers } from './SQS-pollers/polling-handlers/user-subscription.ts'

import { jwtAuthMiddleware } from './NATS/middleware/nats-auth-middleware.ts'
import { userSubjects } from './NATS/subscriptions/user-subjects.ts'
import { aiModelSubjects } from './NATS/subscriptions/ai-model-subjects.ts'
import { aiInteractionSubjects, setLlmModule } from './NATS/subscriptions/ai-interaction-subjects.ts'
import { workspaceSubjects } from './NATS/subscriptions/workspace-subjects.ts'
import { documentSubjects } from './NATS/subscriptions/document-subjects.ts'
import { aiChatThreadSubjects } from './NATS/subscriptions/ai-chat-thread-subjects.ts'
import { subscriptionSubjects } from './NATS/subscriptions/subscription-subjects.ts'
import { imageSubjects } from './NATS/subscriptions/image-subjects.ts'
import { videoSubjects } from './NATS/subscriptions/video-subjects.ts'
import { featureSubjects } from './NATS/subscriptions/feature-subjects.ts'
import { mediaDescriptorSubjects } from './NATS/subscriptions/media-descriptor-subjects.ts'
import { mediaLibrarySubjects } from './NATS/subscriptions/media-library-subjects.ts'
import { extractionSubjects, setExtractionLlmModule } from './NATS/subscriptions/extraction-subjects.ts'
import imageRoutes from './routes/image-routes.ts'
import videoRoutes from './routes/video-routes.ts'
import workspaceExportRoutes from './routes/workspace-export-routes.ts'
import featureRoutes from './routes/feature-routes.ts'
import mediaLibraryRoutes from './routes/media-library-routes.ts'

import { AiModelsSync } from './workloads/functions/ai-models-synchronization/ai-models-synchronization.ts'
import { createLlmModule } from './llm/index.ts'
import { storeWorkspaceImage } from './services/image-storage.ts'
import { storeWorkspaceVideo } from './services/video-storage.ts'

import User from './models/user.ts'
import Organization from './models/organization.ts'
import { BillingClient, billingConfigFromEnv, type BillingNats } from './billing/billing-client.ts'
import { startAllowanceProjection } from './billing/allowance-projection.ts'

const env = process.env

// Production safety check: Prevent LocalAuth0 from being used in non-local environments
if (env.ENVIRONMENT !== 'local' && env.MOCK_AUTH0 === 'true') {
    err('FATAL: LocalAuth0 detected in non-local environment!')
    err(`Environment: ${env.ENVIRONMENT}`)
    err(`AUTH0_DOMAIN: ${env.AUTH0_DOMAIN}`)
    err(`MOCK_AUTH0: ${env.MOCK_AUTH0}`)
    err(`MOCK_AUTH0_DOMAIN: ${env.MOCK_AUTH0_DOMAIN}`)
    err(`MOCK_AUTH0_JWKS_URI: ${env.MOCK_AUTH0_JWKS_URI}`)
    err('LocalAuth0 can only be used when ENVIRONMENT=local')
    process.exit(1)
}

// Set the global DynamoDB service instance to be used across the application for database operations
global.dynamoDBService = new DynamoDBService({
    region: env.AWS_REGION,
    ssoProfile: env.AWS_PROFILE,
    ...(env.DYNAMODB_ENDPOINT && { endpoint: env.DYNAMODB_ENDPOINT }),    // For local development only
})

//Set the global SSM service instance to be used across the application for parameter store operations
// const ssmService = new SSMService({
//     region: env.AWS_REGION,
//     ssoProfile: env.AWS_PROFILE,
//     prefix: `/sst/${env.ORG_NAME}/${env.STAGE}/`
// })

// Fetch and set the global SSM parameters to be used across the application
// global.ssmParams = {
//     // // Queues ******************************************
//     // UserSubscriptionEventsQueue: await ssmService.getParameter({
//     //     parameterName: 'Queue/User_Subscription_Events/queueUrl',
//     //     withDecryption: true,
//     //     origin: 'server:start::getSsmParams'
//     // }),
//     // // SNS Topics **************************************
//     // AiTokensUsageSnsTopic: await ssmService.getParameter({
//     //     parameterName: 'Parameter/AI_TOKENS_USAGE_TOPIC_ARN/value',
//     //     withDecryption: true,
//     //     origin: 'server:start::getSsmParams'
//     // }),
//     // // Lambdas *****************************************
//     // StripeBillingHandlerLambda: await ssmService.getParameter({
//     //     parameterName: 'Function/Stripe_Billing_Handler/functionName',
//     //     withDecryption: true,
//     //     origin: 'server:start::getSsmParams'
//     // }),

// }

// // Start the SQS polling service
// const sqsPollingService = new SqsPollingService([
//     ...userSubscriptionSqsPollers(ssmParams)
// ])
// sqsPollingService.startPolling()

// Initialize AI Models Synchronization service and synchronize models on startup
const aiModelsSync = new AiModelsSync({
    dynamoDBService: global.dynamoDBService
})

// Synchronize AI models on startup. Best-effort: a provider sync failure (e.g. a
// missing/invalid API key) must never crash the server, so it's non-fatal here too.
try {
    await aiModelsSync.synchronizeModels()
} catch (e) {
    err('AI models synchronization failed on startup (continuing):', e)
}

const subscriptions = [
    ...userSubjects,
    ...subscriptionSubjects,
    ...aiModelSubjects,
    ...aiInteractionSubjects,
    ...workspaceSubjects,
    ...documentSubjects,
    ...aiChatThreadSubjects,
    ...imageSubjects,
    ...videoSubjects,
    ...featureSubjects,
    ...mediaLibrarySubjects,
    ...extractionSubjects,
    ...mediaDescriptorSubjects,
]

// Initialize with your NATS server connection
await NATS_Service.init({
    servers: env.NATS_SERVERS,
    name: 'api-server',
    user: 'regular_user',
    pass: env.NATS_REGULAR_USER_PASSWORD,
    // Replication factor for JetStream stores/object-stores. Defaults to 3 (one
    // copy per cluster node) so a single node hiccup can't lose the only copy.
    ...(env.NATS_STREAM_REPLICAS ? { streamReplicas: Number(env.NATS_STREAM_REPLICAS) } : {}),
    middleware: [
        jwtAuthMiddleware, // global middleware, applies to all subscriptions
    ],
    subscriptions
})

await startNatsAuthCalloutService({
    natsService: await NATS_Service.getInstance(),
    subscriptions,
    nKeyIssuerSeed: env.NATS_AUTH_NKEY_ISSUER_SEED,
    xKeyIssuerSeed: env.NATS_AUTH_XKEY_ISSUER_SEED,
    jwtAudience: env.AUTH0_API_IDENTIFIER,
    jwtIssuer: env.MOCK_AUTH0 === 'true' ? `http://${env.MOCK_AUTH0_DOMAIN}/` : `${env.AUTH0_DOMAIN}/`,
    algorithms: ['RS256'],
    jwksUri: env.MOCK_AUTH0 === 'true' ? env.MOCK_AUTH0_JWKS_URI : `${env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    natsAuthAccount: env.NATS_AUTH_ACCOUNT,
    // For internal-service authentication patterns (NKey-signed JWTs),
    // see documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md.
    serviceAuthConfigs: [],
})

// Billing client. The spend gate is async — the client never sits on the workflow
// path. publish goes through the NATS service; balance.changed is subscribed on the
// raw connection so it bypasses the global JWT middleware (an internal billing
// subject carries no user token). Off (BILLING_ENABLED!=true) → today's behavior.
const billingNatsConn = (await NATS_Service.getInstance())!
const billingNats: BillingNats = {
    publish: (subject, data) => billingNatsConn.publish(subject, data),
    subscribe: (subject, handler) => {
        const conn = billingNatsConn.getConnection()
        if (!conn) return undefined
        const sub = conn.subscribe(subject)
        ;(async () => {
            for await (const msg of sub) {
                try {
                    await handler(JSON.parse(new TextDecoder().decode(msg.data)))
                } catch (e: any) {
                    warn(`[billing] balance.changed handler error: ${e?.message ?? String(e)}`)
                }
            }
        })()
        return sub
    },
}
const billing = new BillingClient(billingNats, billingConfigFromEnv())

// Project balance.changed onto user records so the pre-flight gate is a local read.
startAllowanceProjection(billing, {
    getOrganizationMembers: (organizationId) => Organization.getOrganizationMembers({ organizationId }),
    setUserAllowance: (args) => User.setBillingAllowance(args),
})

// Initialize the in-process LLM module. The LangGraph workflow that previously
// ran in the standalone services/llm-api Python service now runs here directly.
const llmModule = createLlmModule({
    natsService: await NATS_Service.getInstance(),
    storeWorkspaceImage,
    storeWorkspaceVideo,
    billing,
    // Gate read: the allowance billing projected onto the user record. Re-reads the
    // user here (auth already loaded it; threading it through is the prod optimization).
    getOrgAllowance: async (userId: string) => (await User.get(userId) as any)?.billingAllowed,
})
setLlmModule(llmModule)
setExtractionLlmModule(llmModule)



const app = express()
const httpServer = createServer(app)

app.set('trust proxy', true)

const corsOptions = {
    origin: env.ORIGIN_HOST_URL,
    credentials: true
}

app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))
app.use(cors(corsOptions))
app.use(cookieParser())

// Image upload/download routes
app.use('/api/images', imageRoutes)

// Video upload/download route (Range-capable for HTML5 <video> + PIXI VideoSource)
app.use('/api/videos', videoRoutes)

// Workspace export routes
app.use('/api/workspaces', workspaceExportRoutes)
app.use('/api/features', featureRoutes)
app.use('/api/media-library', mediaLibraryRoutes)



// Health check endpoint
app.get('/health-check', (req, res) => {
    // Perform other necessary health checks
    const isHealthy = httpServer.listening     //TODO: is there a better way to check if socket.io is alive?

    if (isHealthy) {
        res.json({ status: 'healthy', services: { socketIo: 'running' } })
    } else {
        res.status(503).json({ status: 'unhealthy', services: { socketIo: 'not running' } })
    }
})

// Use HTTP server to listen on the specified port instead of the Express app
httpServer.listen(3000, '0.0.0.0', () => {
    infoStr([
        chalk.green('Server is running on: '),
        chalk.blue('http://localhost:3000'),
        '\n\n\n'
    ])
})


// Graceful shutdown (for your application termination handlers)
process.on('SIGINT', async () => {
    log('Shutting down...')
    try {
        await llmModule.shutdown()
    } catch (e) {
        err('LLM module shutdown failed:', e)
    }
    await await NATS_Service.getInstance()!.drain()    // Drains subscriptions and closes connection
    process.exit(0)
})

process.on('SIGTERM', () => {
    log('Nuke request received, shutting down immediately...')
    process.exit(0)
})
