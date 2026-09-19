import process from 'process'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import chalk from 'chalk'
import {
    log,
    infoStr,
    err,
} from '@lixpi/debug-tools'

import DynamoDBService from '@lixpi/dynamodb-service'
import NATS_Service from '@lixpi/nats-service'
import { NatsRegistrationClient } from '@lixpi/nats-service/registration'
import {
    policyDigest,
    policySchemaVersion,
} from '@lixpi/nats-subject-registry/policy'
import { composeApiSubscriptions } from './NATS/create-nats-subscriptions.ts'

import { createServer } from 'http'

import { jwtAuthMiddleware } from './NATS/middleware/nats-auth-middleware.ts'
import { userSubjects } from './NATS/subscriptions/user-subjects.ts'
import { organizationMembershipSubjects } from './NATS/subscriptions/organization-membership-subjects.ts'
import { aiModelSubjects } from './NATS/subscriptions/ai-model-subjects.ts'
import {
    aiInteractionSubjects,
    setLlmModule,
} from './NATS/subscriptions/ai-interaction-subjects.ts'
import { mediaDescriptorSubjects } from './NATS/subscriptions/media-descriptor-subjects.ts'
import { workspaceSubjects } from './NATS/subscriptions/workspace-subjects.ts'
import { assetSubjects } from './NATS/subscriptions/asset-subjects.ts'
import { mediaGenerationRequestSubjects } from './NATS/subscriptions/media-generation-request-subjects.ts'
import {
    capabilitySubjects,
    setCapabilityRunDispatcher,
} from './NATS/subscriptions/capability-subjects.ts'
import {
    promptReferenceSubjects,
    setPromptReferenceModuleCatalog,
} from './NATS/subscriptions/prompt-reference-subjects.ts'
import assetRoutes from './routes/asset-routes.ts'
import transientMediaRoutes from './routes/transient-media-routes.ts'
import workspaceExportRoutes from './routes/workspace-export-routes.ts'
import capabilityRoutes from './routes/capability-routes.ts'
import providerVerificationRoutes from './routes/provider-verification-routes.ts'

import { createLlmModule } from './llm/index.ts'
import { startAssetMaintenanceWorker } from './services/asset-maintenance-worker.ts'
import { CapabilityRunEventRelay } from './services/capability-run-event-log.ts'
import { getCapabilityDispatcher } from './capability-system/capability-runtime.ts'
import { asCapabilityArguments } from './capability-system/capability-state-resolver.ts'

import {
    ProviderUsageClient,
    providerUsageOptionsFromEnv,
    type ProviderUsageTransport,
} from '@lixpi/usage-reporter'

const env = process.env

// Production safety check: Prevent LocalAuth0 from being used in non-local environments
if (
    env.ENVIRONMENT !== 'local'
    && env.MOCK_AUTH0 === 'true'
) {
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
    ...(env.DYNAMODB_ENDPOINT && { endpoint: env.DYNAMODB_ENDPOINT }), // For local development only
})

// AI models synchronization runs hourly on the NATS NEX execution-engine node
// (services/nex). The API reads the AI_MODELS_LIST table live (model::AiModel
// .getAvailableAiModels) and does not run the sync itself. See
// documentation/platform/deployment/NEX-EXECUTION-ENGINE.md.

const subscriptions = composeApiSubscriptions({
    user: userSubjects,
    'organization-membership': organizationMembershipSubjects,
    'ai-model': aiModelSubjects,
    'ai-interaction': aiInteractionSubjects,
    'media-generation-request': mediaGenerationRequestSubjects,
    'media-descriptor': mediaDescriptorSubjects,
    workspace: workspaceSubjects,
    asset: assetSubjects,
    capability: capabilitySubjects,
    'prompt-reference': promptReferenceSubjects,
})

infoStr([`NATS policy schema=${policySchemaVersion} digest=${policyDigest}`])

await NatsRegistrationClient.apply({
    servers: env.NATS_SERVERS!.split(',').map(server => server.trim()),
    password: env.NATS_REGISTRATION_PASSWORD!,
    registration: env.NATS_APPLICATION_REGISTRATION!,
})

const apiNatsService = await NATS_Service.init({
    servers: env.NATS_SERVERS,
    name: 'api-server',
    nkeySeed: env.NATS_API_NKEY_SEED,
    initialConnectMaxAttempts: 20,
    userId: 'svc:api',
    // Replication factor for JetStream stores/object-stores. Defaults to 3 (one
    // copy per cluster node) so a single node hiccup can't lose the only copy.
    ...(env.NATS_STREAM_REPLICAS ? { streamReplicas: Number(env.NATS_STREAM_REPLICAS) } : {}),
    middleware: [
        jwtAuthMiddleware, // global middleware, applies to all subscriptions
    ],
    subscriptions,
})

await startAssetMaintenanceWorker(apiNatsService)
new CapabilityRunEventRelay(apiNatsService).start()

// Authorize provider requests and record measured usage over the internal NATS port.
// These service requests carry no browser token and bypass the JWT middleware.
const providerUsageConnection = (await NATS_Service.getInstance())!
const providerUsageTransport: ProviderUsageTransport = {
    request: (
        subject,
        data,
        timeoutMs,
    ) => providerUsageConnection.request(
        subject,
        data,
        timeoutMs,
    ),
}
const providerUsage = new ProviderUsageClient(
    providerUsageTransport,
    providerUsageOptionsFromEnv(),
)

// Initialize the in-process LLM module. The LangGraph workflow that previously
// ran in the standalone services/llm-api Python service now runs here directly.
const llmModule = createLlmModule({
    natsService: await NATS_Service.getInstance(),
    providerUsage,
})
setPromptReferenceModuleCatalog(llmModule.capabilityModuleCatalog)
await llmModule.seedCapabilities()
const capabilityDispatcher = getCapabilityDispatcher()
setCapabilityRunDispatcher({
    start: async input => ({
        ...await capabilityDispatcher.startDetached({
            capabilityId: input.capabilityId,
            arguments: asCapabilityArguments(input.arguments),
            requester: {
                userId: input.userId,
                workspaceId: input.workspaceId,
                organizationId: input.organizationId,
            },
            origin: input.origin,
            conversationAssetId: input.conversationAssetId,
        }),
        ownerUserId: input.userId,
    }),
    stop: async run => void capabilityDispatcher.stopDetached(run, run.ownerUserId),
})
setLlmModule(llmModule)

const app = express()
const httpServer = createServer(app)

app.set('trust proxy', true)

const corsOptions = {
    origin: env.ORIGIN_HOST_URL,
    credentials: true,
}

app.use(
    express.json({ limit: '100mb' }),
)
app.use(
    express.urlencoded({
        limit: '100mb',
        extended: true,
    }),
)
app.use(
    cors(corsOptions),
)
app.use(
    cookieParser(),
)

// Asset upload/import and authorized rendition delivery. The API resolves
// organization-scoped Blobs and supports Range requests for seekable media.
app.use('/api/assets', assetRoutes)
app.use('/api/transient-media', transientMediaRoutes)

// Workspace export routes
app.use('/api/workspaces', workspaceExportRoutes)
app.use('/api/capabilities', capabilityRoutes)
app.use('/api/provider-verification', providerVerificationRoutes)

// Health check endpoint
app.get('/health-check', (req, res) => {
    // Perform other necessary health checks
    const isHealthy = httpServer.listening

    if (isHealthy)
        res.json({
            status: 'healthy',
            services: { httpServer: 'running' },
        })
    else
        res.status(503).json({
            status: 'unhealthy',
            services: { httpServer: 'not running' },
        })
})

// Use HTTP server to listen on the specified port instead of the Express app
httpServer.listen(
    3000,
    '0.0.0.0',
    () => {
        infoStr([
            chalk.green('Server is running on: '),
            chalk.blue('http://localhost:3000'),
            '\n\n\n',
        ])
    },
)

// Graceful shutdown (for your application termination handlers)
process.on('SIGINT', async () => {
    log('Shutting down...')

    try {
        await llmModule.shutdown()
    } catch (e) {
        err('LLM module shutdown failed:', e)
    }

    await await NATS_Service.getInstance()!.drain() // Drains subscriptions and closes connection
    process.exit(0)
})

process.on('SIGTERM', () => {
    log('Nuke request received, shutting down immediately...')
    process.exit(0)
})
