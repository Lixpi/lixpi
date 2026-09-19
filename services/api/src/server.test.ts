import {
    afterEach,
    beforeEach,
    describe,
    it,
    expect,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => {
    const appUseCalls: Array<{ args: unknown[] }> = []
    const appGetCalls: Array<{
        path: string
        handler: (...args: unknown[]) => unknown
    }> = []
    const appSetCalls: Array<{
        key: string
        value: unknown
    }> = []

    const expressJson = vi.fn(() => 'json-middleware')
    const expressUrlencoded = vi.fn(() => 'urlencoded-middleware')

    const expressUse = vi.fn()
    const app = {
        set: vi.fn((key: string, value: unknown) => void appSetCalls.push({
            key,
            value,
        })),
        use: vi.fn((...args: unknown[]) => {
            appUseCalls.push({ args })
            expressUse(...args)
        }),
        get: vi.fn((path: string, handler: (...args: unknown[]) => unknown) => void appGetCalls.push({
            path,
            handler,
        })),
    }

    // Express's default export is a callable factory that also carries middleware builders.
    const express: ReturnType<typeof vi.fn> & {
        json?: typeof expressJson
        urlencoded?: typeof expressUrlencoded
    } = vi.fn(() => app)
    express.json = expressJson
    express.urlencoded = expressUrlencoded

    const cors = vi.fn()
    const cookieParser = vi.fn()

    const httpServer = {
        listening: true,
        listen: vi.fn((port: number, host: string, callback?: () => void) => {
            callback?.()

            return undefined
        }),
    }

    const createServer = vi.fn(() => httpServer)

    const natsInstance = {
        drain: vi.fn(async () => undefined),
        request: vi.fn(async () => undefined),
    }

    const natsInit = vi.fn(async () => natsInstance)
    const natsGetInstance = vi.fn(() => natsInstance)

    const jwtAuthMiddleware = vi.fn(() => 'jwt-auth-middleware')
    const userSubjects = [{ subject: 'user-subject' }]
    const organizationMembershipSubjects = [{ subject: 'organization-membership-subject' }]
    const aiModelSubjects = [{ subject: 'ai-model-subject' }]
    const aiInteractionSubjects = [{ subject: 'ai-interaction-subject' }]
    const mediaGenerationRequestSubjects = [{ subject: 'media-generation-request-subject' }]
    const mediaDescriptorSubjects = [{ subject: 'media-descriptor-subject' }]
    const workspaceSubjects = [{ subject: 'workspace-subject' }]
    const assetSubjects = [{ subject: 'asset-subject' }]
    const capabilitySubjects = [{ subject: 'capability-subject' }]
    const promptReferenceSubjects = [{ subject: 'prompt-reference-subject' }]
    const setCapabilityRunDispatcher = vi.fn()
    const setPromptReferenceModuleCatalog = vi.fn()
    const capabilityModuleCatalog = {}
    const capabilityDispatcher = {
        startDetached: vi.fn(),
        stopDetached: vi.fn(),
    }

    const assetRoutes = {}
    const workspaceExportRoutes = {}
    const capabilityRoutes = {}
    const transientMediaRoutes = {}
    const providerVerificationRoutes = {}

    const createLlmModule = vi.fn()
    let llmModule: {
        seedCapabilities: ReturnType<typeof vi.fn>
        shutdown: ReturnType<typeof vi.fn>
    } | null = null

    const setLlmModule = vi.fn()

    const startAssetMaintenanceWorker = vi.fn(async () => undefined)
    const capabilityRunEventRelayStart = vi.fn()
    class CapabilityRunEventRelay {
        start(): void {
            capabilityRunEventRelayStart()
        }
    }

    const providerUsageOptionsFromEnv = vi.fn(() => ({}))
    const ProviderUsageClient = vi.fn()

    const log = vi.fn()
    const info = vi.fn()
    const infoStr = vi.fn()
    const warn = vi.fn()
    const err = vi.fn()

    const chalkGreen = vi.fn((value: string) => `green:${value}`)
    const chalkBlue = vi.fn((value: string) => `blue:${value}`)

    const DynamoDBService = vi.fn()

    return {
        app,
        appSetCalls,
        appUseCalls,
        appGetCalls,
        express,
        expressJson,
        expressUrlencoded,
        expressUse,
        cors,
        cookieParser,
        httpServer,
        createServer,
        natsInstance,
        natsInit,
        registrationApply: vi.fn(async () => undefined),
        natsGetInstance,
        jwtAuthMiddleware,
        userSubjects,
        organizationMembershipSubjects,
        aiModelSubjects,
        aiInteractionSubjects,
        mediaGenerationRequestSubjects,
        mediaDescriptorSubjects,
        workspaceSubjects,
        assetSubjects,
        capabilitySubjects,
        promptReferenceSubjects,
        setCapabilityRunDispatcher,
        setPromptReferenceModuleCatalog,
        capabilityModuleCatalog,
        capabilityDispatcher,
        assetRoutes,
        workspaceExportRoutes,
        capabilityRoutes,
        transientMediaRoutes,
        providerVerificationRoutes,
        createLlmModule: createLlmModule.mockImplementation(() => {
            const module = {
                capabilityModuleCatalog,
                seedCapabilities: vi.fn(async () => undefined),
                shutdown: vi.fn(),
            }
            llmModule = module

            return module
        }),
        getLlmModule: () => llmModule,
        setLlmModule,
        startAssetMaintenanceWorker,
        CapabilityRunEventRelay,
        capabilityRunEventRelayStart,
        providerUsageOptionsFromEnv,
        ProviderUsageClient,
        log,
        info,
        infoStr,
        warn,
        err,
        chalkGreen,
        chalkBlue,
        DynamoDBService,
    }
})

vi.mock('express', () => ({
    default: mocks.express,
}))
vi.mock('cors', () => ({
    default: mocks.cors,
}))
vi.mock('cookie-parser', () => ({
    default: mocks.cookieParser,
}))
vi.mock('chalk', () => ({
    default: {
        green: mocks.chalkGreen,
        blue: mocks.chalkBlue,
    },
}))
vi.mock('http', () => ({
    createServer: mocks.createServer,
}))

vi.mock('@lixpi/debug-tools', () => ({
    log: mocks.log,
    info: mocks.info,
    infoStr: mocks.infoStr,
    warn: mocks.warn,
    err: mocks.err,
}))

vi.mock('@lixpi/dynamodb-service', () => ({
    default: mocks.DynamoDBService,
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        init: mocks.natsInit,
        getInstance: mocks.natsGetInstance,
    },
}))
vi.mock('@lixpi/nats-service/registration', () => ({ NatsRegistrationClient: { apply: mocks.registrationApply } }))

vi.mock('./NATS/create-nats-subscriptions.ts', () => ({ composeApiSubscriptions: (groups: Record<string, unknown[]>) => Object.values(groups).flat() }))

vi.mock('./NATS/middleware/nats-auth-middleware.ts', () => ({
    jwtAuthMiddleware: mocks.jwtAuthMiddleware,
}))
vi.mock('./NATS/subscriptions/user-subjects.ts', () => ({ userSubjects: mocks.userSubjects }))
vi.mock('./NATS/subscriptions/organization-membership-subjects.ts', () => ({
    organizationMembershipSubjects: mocks.organizationMembershipSubjects,
}))
vi.mock('./NATS/subscriptions/ai-model-subjects.ts', () => ({ aiModelSubjects: mocks.aiModelSubjects }))
vi.mock('./NATS/subscriptions/ai-interaction-subjects.ts', () => ({
    aiInteractionSubjects: mocks.aiInteractionSubjects,
    setLlmModule: mocks.setLlmModule,
}))
vi.mock('./NATS/subscriptions/media-generation-request-subjects.ts', () => ({
    mediaGenerationRequestSubjects: mocks.mediaGenerationRequestSubjects,
}))
vi.mock('./NATS/subscriptions/media-descriptor-subjects.ts', () => ({ mediaDescriptorSubjects: mocks.mediaDescriptorSubjects }))
vi.mock('./NATS/subscriptions/workspace-subjects.ts', () => ({ workspaceSubjects: mocks.workspaceSubjects }))
vi.mock('./NATS/subscriptions/asset-subjects.ts', () => ({ assetSubjects: mocks.assetSubjects }))
vi.mock('./NATS/subscriptions/capability-subjects.ts', () => ({
    capabilitySubjects: mocks.capabilitySubjects,
    setCapabilityRunDispatcher: mocks.setCapabilityRunDispatcher,
}))
vi.mock('./NATS/subscriptions/prompt-reference-subjects.ts', () => ({
    promptReferenceSubjects: mocks.promptReferenceSubjects,
    setPromptReferenceModuleCatalog: mocks.setPromptReferenceModuleCatalog,
}))
vi.mock('./capability-system/capability-runtime.ts', () => ({
    getCapabilityDispatcher: () => mocks.capabilityDispatcher,
}))
vi.mock('./capability-system/capability-state-resolver.ts', () => ({
    asCapabilityArguments: (value: unknown) => value,
}))

vi.mock('./routes/asset-routes.ts', () => ({
    default: mocks.assetRoutes,
}))
vi.mock('./routes/workspace-export-routes.ts', () => ({
    default: mocks.workspaceExportRoutes,
}))
vi.mock('./routes/capability-routes.ts', () => ({
    default: mocks.capabilityRoutes,
}))
vi.mock('./routes/transient-media-routes.ts', () => ({
    default: mocks.transientMediaRoutes,
}))
vi.mock('./routes/provider-verification-routes.ts', () => ({
    default: mocks.providerVerificationRoutes,
}))

vi.mock('./llm/index.ts', () => ({
    createLlmModule: mocks.createLlmModule,
}))

vi.mock('./services/asset-maintenance-worker.ts', () => ({
    startAssetMaintenanceWorker: mocks.startAssetMaintenanceWorker,
}))
vi.mock('./services/capability-run-event-log.ts', () => ({
    CapabilityRunEventRelay: mocks.CapabilityRunEventRelay,
}))

vi.mock('@lixpi/usage-reporter', () => ({
    ProviderUsageClient: mocks.ProviderUsageClient,
    providerUsageOptionsFromEnv: mocks.providerUsageOptionsFromEnv,
}))

const loadServer = async (): Promise<void> => {
    vi.resetModules()
    await import('./server.ts')
}

const routeForPath = (path: string) => mocks.appUseCalls.find((call) => call.args.at(0) === path)?.args.at(1)

const resetServerEnv = (overrides: Record<string, string | undefined>): void => {
    process.env.ENVIRONMENT = 'local'
    process.env.NATS_SERVERS = 'nats://localhost:4222'
    process.env.NATS_APPLICATION_REGISTRATION = 'signed-registration'
    process.env.NATS_REGISTRATION_PASSWORD = 'bootstrap-password'
    process.env.NATS_API_NKEY_SEED = 'synthetic-api-seed'
    process.env.ORIGIN_HOST_URL = 'https://api.example.test'
    process.env.MOCK_AUTH0 = 'false'
    process.env.AUTH0_DOMAIN = 'https://auth.example.test'
    process.env.AUTH0_API_IDENTIFIER = 'auth-audience'
    delete process.env.NATS_AUTH_NKEY_ISSUER_SEED
    delete process.env.NATS_AUTH_XKEY_ISSUER_SEED

    Object.keys(overrides).forEach((key) => {
        const value = overrides[key]

        if (value === undefined) {
            delete process.env[key]

            return
        }

        process.env[key] = value
    })
}

const resetMockState = (): void => {
    mocks.appUseCalls.length = 0
    mocks.appGetCalls.length = 0
    mocks.appSetCalls.length = 0

    mocks.express.mockClear()
    mocks.expressJson.mockClear()
    mocks.expressUrlencoded.mockClear()
    mocks.expressUse.mockClear()
    mocks.cors.mockClear()
    mocks.cookieParser.mockClear()
    mocks.createServer.mockClear()
    mocks.natsInit.mockClear()
    mocks.registrationApply.mockReset().mockResolvedValue(undefined)
    mocks.natsGetInstance.mockClear()
    mocks.natsInstance.drain.mockClear()
    mocks.natsInstance.request.mockClear()
    mocks.createLlmModule.mockClear()
    mocks.setLlmModule.mockClear()
    mocks.setPromptReferenceModuleCatalog.mockClear()
    mocks.startAssetMaintenanceWorker.mockClear()
    mocks.providerUsageOptionsFromEnv.mockClear()
    mocks.ProviderUsageClient.mockClear()
    mocks.log.mockClear()
    mocks.info.mockClear()
    mocks.infoStr.mockClear()
    mocks.warn.mockClear()
    mocks.err.mockClear()
    mocks.chalkGreen.mockClear()
    mocks.chalkBlue.mockClear()
    mocks.app.set.mockClear()
    mocks.app.use.mockClear()
    mocks.app.get.mockClear()
    mocks.httpServer.listen.mockClear()
    mocks.capabilityRunEventRelayStart.mockClear()
}

describe('services/api server startup', () => {
    const expectedSubscriptionOrder = [
        ...mocks.userSubjects,
        ...mocks.organizationMembershipSubjects,
        ...mocks.aiModelSubjects,
        ...mocks.aiInteractionSubjects,
        ...mocks.mediaGenerationRequestSubjects,
        ...mocks.mediaDescriptorSubjects,
        ...mocks.workspaceSubjects,
        ...mocks.assetSubjects,
        ...mocks.capabilitySubjects,
        ...mocks.promptReferenceSubjects,
    ]

    beforeEach(() => {
        resetServerEnv({})
        resetMockState()
    })

    afterEach(() => void vi.restoreAllMocks())

    it('initializes core services, middleware, routes, and shutdown handlers', async () => {
        const processOnCalls: Array<{
            event: string
            handler: (...args: unknown[]) => unknown
        }> = []
        const processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => unknown) => {
            processOnCalls.push({
                event,
                handler,
            })

            return process as NodeJS.Process
        })
        const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

        delete process.env.NATS_NEX_NODE_NKEY_PUBLIC

        await loadServer()

        expect(mocks.natsInit).toHaveBeenCalledTimes(1)
        expect(mocks.registrationApply).toHaveBeenCalledWith({
            servers: ['nats://localhost:4222'],
            password: 'bootstrap-password',
            registration: 'signed-registration',
        })
        expect(mocks.registrationApply.mock.invocationCallOrder[0]).toBeLessThan(mocks.natsInit.mock.invocationCallOrder[0])
        expect(mocks.natsInit.mock.calls[0]?.[0]).toMatchObject({
            servers: 'nats://localhost:4222',
            name: 'api-server',
            nkeySeed: 'synthetic-api-seed',
            userId: 'svc:api',
            initialConnectMaxAttempts: 20,
            middleware: [mocks.jwtAuthMiddleware],
            subscriptions: expectedSubscriptionOrder,
        })

        expect(mocks.startAssetMaintenanceWorker).toHaveBeenCalledTimes(1)
        expect(mocks.startAssetMaintenanceWorker.mock.calls[0]?.[0]).toBe(mocks.natsInstance)

        expect(mocks.natsInit.mock.calls[0]?.[0]).not.toHaveProperty('persistence')
        expect(mocks.createLlmModule).toHaveBeenCalledWith({
            natsService: mocks.natsInstance,
            providerUsage: expect.anything(),
        })
        expect(mocks.getLlmModule()?.seedCapabilities).toHaveBeenCalledTimes(1)
        expect(mocks.setPromptReferenceModuleCatalog).toHaveBeenCalledWith(mocks.capabilityModuleCatalog)

        expect(mocks.app.use).toHaveBeenCalledTimes(9)
        expect(mocks.expressJson).toHaveBeenCalledWith({ limit: '100mb' })
        expect(mocks.expressUrlencoded).toHaveBeenCalledWith({
            limit: '100mb',
            extended: true,
        })
        expect(mocks.cors).toHaveBeenCalledWith({
            origin: 'https://api.example.test',
            credentials: true,
        })
        expect(mocks.cookieParser).toHaveBeenCalledWith()

        expect(routeForPath('/api/assets')).toBe(mocks.assetRoutes)
        expect(routeForPath('/api/workspaces')).toBe(mocks.workspaceExportRoutes)
        expect(routeForPath('/api/capabilities')).toBe(mocks.capabilityRoutes)
        expect(routeForPath('/api/transient-media')).toBe(mocks.transientMediaRoutes)
        expect(routeForPath('/api/provider-verification')).toBe(mocks.providerVerificationRoutes)
        expect(mocks.capabilityRunEventRelayStart).toHaveBeenCalledTimes(1)

        const healthRoute = mocks.appGetCalls.find((call) => call.path === '/health-check')
        expect(healthRoute).toBeDefined()

        const req = {} as Record<string, unknown>
        const res = {
            json: vi.fn(),
            status: vi.fn().mockReturnThis(),
        }
        healthRoute?.handler(req, res)
        expect(res.json).toHaveBeenCalledWith({
            status: 'healthy',
            services: { httpServer: 'running' },
        })

        expect(mocks.httpServer.listen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function))
        expect(mocks.infoStr).toHaveBeenCalledWith([
            'green:Server is running on: ',
            'blue:http://localhost:3000',
            '\n\n\n',
        ])

        expect(mocks.setLlmModule).toHaveBeenCalledWith(mocks.getLlmModule())

        const sigint = processOnCalls.find((entry) => entry.event === 'SIGINT')
        const sigterm = processOnCalls.find((entry) => entry.event === 'SIGTERM')
        expect(sigint).toBeDefined()
        expect(sigterm).toBeDefined()

        await sigint?.handler()

        expect(mocks.getLlmModule()?.shutdown).toHaveBeenCalledTimes(1)
        expect(mocks.natsInstance.drain).toHaveBeenCalledTimes(1)
        expect(processExitSpy).toHaveBeenCalledWith(0)

        processOnSpy.mockRestore()
        processExitSpy.mockRestore()
    })

    it('uses immediate exit on SIGTERM without initiating graceful shutdown paths', async () => {
        const processOnCalls: Array<{
            event: string
            handler: (...args: unknown[]) => unknown
        }> = []
        const processOnSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => unknown) => {
            processOnCalls.push({
                event,
                handler,
            })

            return process as NodeJS.Process
        })
        const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

        delete process.env.NATS_NEX_NODE_NKEY_PUBLIC

        await loadServer()

        const sigterm = processOnCalls.find((entry) => entry.event === 'SIGTERM')
        const llmModule = mocks.getLlmModule()

        expect(sigterm).toBeDefined()

        await sigterm?.handler()

        expect(llmModule?.shutdown).not.toHaveBeenCalled()
        expect(mocks.natsInstance.drain).not.toHaveBeenCalled()
        expect(processExitSpy).toHaveBeenCalledWith(0)

        processOnSpy.mockRestore()
        processExitSpy.mockRestore()
    })

    it('starts as a service client without broker signing secrets or a NEX registration', async () => {
        resetServerEnv({
            NATS_NEX_NODE_NKEY_PUBLIC: undefined,
            MOCK_AUTH0: 'false',
        })

        await loadServer()

        expect(mocks.natsInit).toHaveBeenCalledWith(expect.objectContaining({
            nkeySeed: 'synthetic-api-seed',
            userId: 'svc:api',
        }))
        expect(mocks.natsInit.mock.calls[0]?.[0]).not.toHaveProperty('persistence')
    })
})
