'use strict'

import { mount, flushSync } from "svelte"

import NatsService from '@lixpi/nats-service'

import RouterService from '$src/services/router-service.js'
import AuthService from '$src/services/auth-service.ts'
import UserService from '$src/services/user-service.ts'
import SubscriptionService from '$src/services/subscription-service.js'
import OrganizationService from '$src/services/organization-service.js'
import AiModelService from '$src/services/ai-model-service.ts'
import DocumentService from '$src/services/document-service.ts'
import WorkspaceService from '$src/services/workspace-service.ts'
import AiChatThreadService from '$src/services/ai-chat-thread-service.ts'

import App from '$src/App.svelte'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { authStore } from '$src/stores/authStore.ts'

const VITE_NATS_SERVER = import.meta.env.VITE_NATS_SERVER

// In Tauri builds, the user can override the NATS endpoint via the Settings panel.
// The override is persisted in plugin-store under settings.json. The web build skips
// this branch entirely (the dynamic import is tree-shaken by Vite when not in Tauri).
async function resolveNatsServerUrl(): Promise<string> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
            const { Store } = await import('@tauri-apps/plugin-store')
            const store = await Store.load('settings.json')
            const override = await store.get<string>('nats_server_url')
            if (override) return override
        } catch (error) {
            console.warn('Failed to read NATS URL override from Tauri store; falling back to build-time default', error)
        }
    }
    return VITE_NATS_SERVER
}

// Init services and then start the app
async function initializeServicesSequentially() {
    try {
        await AuthService.init();
        const authToken = await AuthService.getTokenSilently();

        if (!authToken) {
            throw new Error('No auth token');
        }

        const natsServerUrl = await resolveNatsServerUrl();

        console.log('NATS server URL resolved:', {
            natsServer: natsServerUrl,
            buildDefault: VITE_NATS_SERVER,
        });

        const natsInstance = await NatsService.init({
            servers: [natsServerUrl],
            webSocket: true,
            name: 'web-client',
            token: authToken,
        });

        servicesStore.setDataValues({
            nats: natsInstance,
            userService: new UserService(),
            subscriptionService: new SubscriptionService(),
            aiModelService: new AiModelService(),
            documentService: new DocumentService(),
            workspaceService: new WorkspaceService(),
            organizationService: new OrganizationService(),
            aiChatThreadService: new AiChatThreadService()
        });

        // Fetch registered user
        servicesStore.getData('userService')!.getUser();

        // Fetch organization details
        servicesStore.getData('organizationService')!.getOrganization({
            organizationId: userStore.getData('organizations')[0]
        });

        // Fetch available AI models
        servicesStore.getData('aiModelService')!.getAvailableAiModels();

        // Fetch user workspaces
        servicesStore.getData('workspaceService')!.getUserWorkspaces();

        await RouterService.init();
    } catch (error) {
        console.error('Error during service initialization', error);
        throw error; // Re-throw to handle it in the caller
    }
}

initializeServicesSequentially()
    .then(() => {
        // console.log('All services initialized successfully');
        const app = mount(App, {
            target: document.getElementById('app')
        })
        flushSync();
    })
    .catch(error => {
        console.error('Application failed to start', error);
    });