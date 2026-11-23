// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ConversationHumanAction,
} from '@lixpi/constants'
import {
    type WorkspaceConversationController,
} from './workspace-conversation-controller.ts'
import { WorkspaceConversationHandoff } from './workspace-conversation-handoff.ts'

const mount = (action: ConversationHumanAction) => {
    const controller = {
        pendingHumanAction: {
            action,
            interruptId: 'interrupt',
        },
        completeHumanAction: vi.fn(async () => {}),
    }
    const ports = {
        upload: vi.fn(async () => ({ assetId: 'asset' })),
        attest: vi.fn(async () => {}),
        openVerification: vi.fn(async () => {}),
        download: vi.fn(async () => {}),
        exportWorkspace: vi.fn(async () => {}),
    }
    const handoff = new WorkspaceConversationHandoff(controller as unknown as WorkspaceConversationController, document, ports)
    handoff.render()

    const click = (text: string) => handoff.element.querySelector<HTMLButtonElement>(`button[aria-label="${text}"]`)!.click()

    return {
        controller,
        ports,
        handoff,
        click,
    }
}

describe('workspace conversation human actions', () => {
    it('starts the authorized media transfer after the person clicks Download media', async () => {
        const action = {
            kind: 'download',
            assetId: 'asset',
            title: 'Portrait',
            rendition: 'original',
            userId: 'user',
            issuedAt: 1,
        } as const
        const {
            controller,
            ports,
            click,
        } = mount(action)
        expect(ports.download).not.toHaveBeenCalled()

        click('Download media')

        await vi.waitFor(() => expect(controller.completeHumanAction).toHaveBeenCalledExactlyOnceWith('interrupt', {}))
        expect(ports.download).toHaveBeenCalledExactlyOnceWith(action)
    })

    it('starts the active workspace archive after the person clicks Download workspace ZIP', async () => {
        const {
            controller,
            ports,
            click,
        } = mount({
            kind: 'workspace-export',
            workspaceId: 'workspace',
            userId: 'user',
            issuedAt: 1,
        })
        expect(ports.exportWorkspace).not.toHaveBeenCalled()

        click('Download workspace ZIP')

        await vi.waitFor(() => expect(controller.completeHumanAction).toHaveBeenCalledExactlyOnceWith('interrupt', {}))
        expect(ports.exportWorkspace).toHaveBeenCalledExactlyOnceWith('workspace')
    })

    it('opens the native file chooser on click and sends the completed upload as the interrupt answer', async () => {
        const {
            controller,
            handoff,
            ports,
            click,
        } = mount({
            kind: 'file',
            assetId: 'asset',
            userId: 'user',
            issuedAt: 1,
        })
        const input = handoff.element.querySelector('input')!
        const open = vi.spyOn(input, 'click').mockImplementation(() => {})
        click('Choose file')
        expect(open).toHaveBeenCalledOnce()
        expect(controller.completeHumanAction).not.toHaveBeenCalled()

        const file = new File(['payload'], 'upload.txt', { type: 'text/plain' })
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [file],
        })
        input.dispatchEvent(new Event('change'))

        await vi.waitFor(() => expect(controller.completeHumanAction).toHaveBeenCalledExactlyOnceWith('interrupt', { assetId: 'asset' }))
        expect(ports.upload).toHaveBeenCalledExactlyOnceWith(file, 'interrupt')
    })

    it('shows the consent statement and performs attestation only on explicit confirmation', async () => {
        const action = {
            kind: 'attestation',
            assetId: 'asset',
            assetRevision: 2,
            title: 'Portrait',
            classification: 'self',
            userId: 'user',
            issuedAt: 1,
        } as const
        const {
            controller,
            handoff,
            ports,
            click,
        } = mount(action)
        expect(handoff.element.textContent).toContain('I am the person depicted in "Portrait".')
        expect(ports.attest).not.toHaveBeenCalled()

        click('Confirm attestation')

        await vi.waitFor(() => expect(controller.completeHumanAction).toHaveBeenCalledExactlyOnceWith('interrupt', {}))
        expect(ports.attest).toHaveBeenCalledExactlyOnceWith(action)
    })

    it('opens provider verification without claiming completion until the person continues', async () => {
        const action = {
            kind: 'provider-verification',
            assetId: 'asset',
            generationRequestId: 'generation',
            generationRun: 1,
            requestRevision: 4,
            userId: 'user',
            issuedAt: 1,
        } as const
        const {
            controller,
            ports,
            click,
        } = mount(action)
        click('Open provider verification')
        expect(ports.openVerification).toHaveBeenCalledExactlyOnceWith(action)
        expect(controller.completeHumanAction).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(controller.completeHumanAction).not.toHaveBeenCalled())
        await Promise.resolve()

        click('Continue after verification')

        await vi.waitFor(() => expect(controller.completeHumanAction).toHaveBeenCalledExactlyOnceWith('interrupt', {}))
    })
})
