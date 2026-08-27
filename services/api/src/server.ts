'use strict'

import process from 'process'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import DynamoDBService from '@lixpi/dynamodb-service'
import NATS_Service from '@lixpi/nats-service'
import { startNatsAuthCalloutService } from '@lixpi/nats-auth-callout-service'
import type { ServiceAuthConfig } from '@lixpi/auth-service'

import { createServer } from 'http'

import { jwtAuthMiddleware } from './NATS/middleware/nats-auth-middleware.ts'
import { userSubjects } from './NATS/subscriptions/user-subjects.ts'
import { subscriptionSubjects } from './NATS/subscriptions/subscription-subjects.ts'
import { aiModelSubjects } from './NATS/subscriptions/ai-model-subjects.ts'
import { aiInteractionSubjects, setLlmModule } from './NATS/subscriptions/ai-interaction-subjects.ts'
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

import { MetricsClient, metricsConfigFromEnv, type MetricsNats } from './metrics/metrics-client.ts'

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



// AI models synchronization runs hourly on the NATS NEX execution-engine node
// (services/nex). The API reads the AI_MODELS_LIST table live (model::AiModel
// .getAvailableAiModels) and does not run the sync itself. See
// documentation/platform/deployment/NEX-EXECUTION-ENGINE.md.

// NATS registration order is the order below. Keep related subjects together
// here instead of sorting after the fact so startup logs and generated auth
// permissions stay readable and predictable.
const subscriptions = [
    // Identity, billing, and model metadata.
    ...userSubjects,
    ...subscriptionSubjects,
    ...aiModelSubjects,

    // AI orchestration, replay streams, and media description.
    ...aiInteractionSubjects,
    ...mediaGenerationRequestSubjects,
    ...mediaDescriptorSubjects,

    // Workspace records and unified Asset authority.
    ...workspaceSubjects,
    ...assetSubjects,

    // Capability catalog commands and generic Tool run transport.
    ...capabilitySubjects,
    ...promptReferenceSubjects,
]

// Registered NATS-internal identities that the auth callout can authenticate
// without Auth0.
//
// This is the API-side registry consumed by
// `@lixpi/nats-auth-callout-service`. Keep the operational explanation in sync
// with documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md.
//
// Why this lives in the API:
// - `services/api` owns the NATS auth-callout responder on `$SYS.REQ.USER.AUTH`.
// - NATS forwards connection attempts here, and this process returns the final
//   NATS user JWT that decides which account and subjects the client receives.
// - Public NKeys are verification material, not secrets, so the API only needs
//   the public half of any registered internal identity. The matching seed stays
//   with the service that is proving its identity.
const serviceAuthConfigs: ServiceAuthConfig[] = []

if (env.NATS_NEX_NODE_NKEY_PUBLIC) {
    // NEX is a NATS-native tool, not a browser or normal API client. It connects
    // with standard NATS NKey auth (`--nats.nkey` + `--nats.seed`), which means
    // it sends a public NKey plus a signature over the server nonce instead of a
    // Lixpi/Auth0 JWT in `connect_opts.auth_token`.
    //
    // With centralized auth_callout enabled, the static `users` section in a
    // NATS account is not the path that authenticates this client. NATS asks the
    // API auth callout to decide, so the API must know the NEX public key. The
    // callout verifies the raw NKey signature, then mints a NATS user JWT for
    // the account configured below.
    //
    // See documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md,
    // especially the "NATS-native NKey variation" and the longer-term
    // decentralized NATS JWT/operator option documented there.
    serviceAuthConfigs.push({
        // Public user NKey for the NEX node. The seed remains only in the NEX
        // runtime environment. This value lets the auth callout verify that the
        // raw NKey challenge response was signed by the real node credential.
        publicKey: env.NATS_NEX_NODE_NKEY_PUBLIC,
        // Stable Lixpi service identity used as the subject of the NATS user JWT
        // returned by the auth callout. This is not an Auth0 user id.
        userId: 'svc:nex-node',
        // NEX must land in the dedicated NATS `NEX` account, not the default
        // auth account. That keeps `$NEX.>` control-plane subjects and NEX feed
        // subjects isolated from normal application traffic in `AUTH`.
        account: 'NEX',
        // These permissions are the complete NATS allowlist for the NEX node,
        // its bundled native nexlet, and the workloads that the node credentials
        // mint. Anything not listed here should be rejected by NATS.
        permissions: {
            pub: {
                allow: [
                    // NEX node/nexlet control-plane subjects: auctions,
                    // registration, lifecycle, and feed publishing inside the
                    // NEX account.
                    '$NEX.>',
                    // NEX uses NATS micro/service subjects for runtime
                    // coordination. Keep this in the NEX account only.
                    '$SRV.>',
                    // Request/reply inboxes used by NEX CLI/node operations.
                    '_INBOX.>',
                    // JetStream API subjects. State persistence is currently
                    // disabled for the node, but NEX and future workload
                    // artifacts may touch KV/Object Store APIs in this account.
                    '$JS.API.>',
                    '$JS.lixpi.API.>',
                    // JetStream flow-control and acknowledgement subjects used
                    // by consumers/producers when JetStream is involved.
                    '$JS.FC.>',
                    '$JS.ACK.>',
                    // Completion event published by the ai-models-sync workload
                    // in the NEX account and exported/imported into AUTH for the
                    // API subscriber.
                    'aiModels.syncCompleted',
                ],
            },
            sub: {
                allow: [
                    // Subscribe to NEX control-plane and feed subjects.
                    '$NEX.>',
                    // Subscribe to NATS micro/service subjects used by NEX
                    // coordination.
                    '$SRV.>',
                    // Receive request/reply responses.
                    '_INBOX.>',
                    // Allow JetStream API responses and account-scoped domain
                    // responses if NEX starts using persisted state/artifacts.
                    '$JS.API.>',
                    '$JS.lixpi.API.>',
                    // Allow JetStream flow-control and acknowledgements.
                    '$JS.FC.>',
                    '$JS.ACK.>',
                ],
            },
        },
    })
} else {
    // Local and production NEX authentication depends on this public key being
    // present in the API environment. Without it, the NEX node can still sign
    // the NATS challenge, but the auth callout has no registered key to verify
    // against and must reject the connection.
    warn('NATS_NEX_NODE_NKEY_PUBLIC is not configured; NEX clients cannot authenticate through auth callout')
}

const pricingIdentityConfigs = [
    {
        environmentKey: 'NATS_PRICING_SERVICE_NKEY_PUBLIC',
        userId: 'svc:model-pricing',
        permissions: {
            pub: { allow: ['_INBOX.>', 'pricing.changed'] },
            sub: { allow: ['_INBOX.>', 'aiModels.syncCompleted', 'pricing.revision.get', 'pricing.model.get', 'pricing.table.get', 'pricing.consumer.refresh.ack', 'pricing.admin.status.get', 'pricing.admin.override.command', 'pricing.reconciliation.predicted.daily'] },
        },
    },
    {
        environmentKey: 'NATS_PRICING_OPERATOR_NKEY_PUBLIC',
        userId: 'svc:pricing-operator',
        permissions: { pub: { allow: ['_INBOX.>', 'pricing.admin.status.get', 'pricing.admin.override.command'] }, sub: { allow: ['_INBOX.>'] } },
    },
    {
        environmentKey: 'NATS_PRICING_BILLING_NKEY_PUBLIC',
        userId: 'svc:pricing-billing',
        permissions: { pub: { allow: ['_INBOX.>', 'pricing.revision.get', 'pricing.model.get', 'pricing.table.get', 'pricing.consumer.refresh.ack', 'pricing.reconciliation.predicted.daily'] }, sub: { allow: ['_INBOX.>', 'pricing.changed'] } },
    },
]

for (const pricingIdentity of pricingIdentityConfigs) {
    const publicKeys = env[pricingIdentity.environmentKey]?.split(',').map(publicKey => publicKey.trim()).filter(Boolean) ?? []

    if (publicKeys.length === 0) {
        warn(`${pricingIdentity.environmentKey} is not configured; ${pricingIdentity.userId} cannot authenticate through auth callout`)
        continue
    }

    for (const publicKey of publicKeys) {
        serviceAuthConfigs.push({
            publicKey,
            userId: pricingIdentity.userId,
            account: 'PRICING',
            permissions: pricingIdentity.permissions,
        })
    }
}

// Initialize with your NATS server connection
const apiNatsService = await NATS_Service.init({
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

await startAssetMaintenanceWorker(apiNatsService)
new CapabilityRunEventRelay(apiNatsService).start()

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
    // Service registrations are passed into the generic auth-callout package so
    // the package stays reusable. The auth package knows how to verify Auth0
    // JWTs, self-issued service JWTs, and raw NATS NKey challenge responses; it
    // does not hardcode that NEX exists. This API startup file decides which
    // internal service identities are active for this deployment.
    //
    // See documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md for the
    // full service-auth model, including why raw NKey NEX auth is the short-term
    // fix and decentralized NATS JWT/operator auth is the larger future option.
    serviceAuthConfigs,
})

// Metrics client. The spend guard is synchronous: check before a paid provider
// call, confirm after. Requests use the raw NATS_Service.request so they bypass the
// global JWT middleware — an internal metrics subject carries no user token. Off
// (METRICS_ENABLED!=true) → the open-source plug (check approves, confirm no-ops).
const metricsNatsConn = (await NATS_Service.getInstance())!
const metricsNats: MetricsNats = {
    request: (subject, data, timeoutMs) => metricsNatsConn.request(subject, data, timeoutMs),
}
const metrics = new MetricsClient(metricsNats, metricsConfigFromEnv())

// Initialize the in-process LLM module. The LangGraph workflow that previously
// ran in the standalone services/llm-api Python service now runs here directly.
const llmModule = createLlmModule({
    natsService: await NATS_Service.getInstance(),
    metrics,
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
    stop: async run => {
        capabilityDispatcher.stopDetached(run, run.ownerUserId)
    },
})
setLlmModule(llmModule)



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

    if (isHealthy) {
        res.json({ status: 'healthy', services: { httpServer: 'running' } })
    } else {
        res.status(503).json({ status: 'unhealthy', services: { httpServer: 'not running' } })
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
