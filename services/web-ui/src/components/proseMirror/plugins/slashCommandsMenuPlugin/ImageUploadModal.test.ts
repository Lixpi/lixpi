'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ImageUploadModal } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/ImageUploadModal.ts'
import type { ImageUploadResult } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/ImageUploadModal.ts'
import RouterService from '$src/services/router-service.ts'
import AuthService from '$src/services/auth-service.ts'
import { MAX_UPLOAD_FILE_SIZE } from '@lixpi/constants'

vi.mock('$src/services/router-service.ts', () => ({
    default: {
        getRouteParams: vi.fn(),
    },
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(),
    },
}))

type ProgressEventLike = {
    lengthComputable?: boolean
    loaded?: number
    total?: number
}

type Listener = (event: any) => void

type ListenerMap = Map<string, Listener[]>

class MockXMLHttpRequest {
    static getActiveRequests(): readonly MockXMLHttpRequest[] {
        return requests
    }

    static reset(): void {
        requests.length = 0
    }

    public method = ''
    public requestUrl = ''
    public sentBody: unknown = null
    public responseText = ''
    public status = 0

    public headers: Record<string, string> = {}
    public upload: { addEventListener: (type: string, listener: Listener) => void }

    private readonly requestListeners: ListenerMap = new Map()
    private readonly uploadListeners: ListenerMap = new Map()

    constructor() {
        requests.push(this)
        this.upload = {
            addEventListener: (type: string, listener: Listener) => {
                thisAddUploadListener(this.uploadListeners, type, listener)
            },
        }
    }

    open(method: string, url: string): void {
        this.method = method
        this.requestUrl = url
    }

    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value
    }

    send(body: unknown): void {
        this.sentBody = body
    }

    addEventListener(type: string, listener: Listener): void {
        thisAddListener(this.requestListeners, type, listener)
    }

    triggerUploadProgress(event: ProgressEventLike): void {
        for (const listener of this.uploadListeners.get('progress') ?? []) {
            listener({ ...event, type: 'progress' })
        }
    }

    triggerLoad(): void {
        for (const listener of this.requestListeners.get('load') ?? []) {
            listener({ type: 'load' })
        }
    }

    triggerError(): void {
        for (const listener of this.requestListeners.get('error') ?? []) {
            listener({ type: 'error' })
        }
    }

    triggerAbort(): void {
        for (const listener of this.requestListeners.get('abort') ?? []) {
            listener({ type: 'abort' })
        }
    }
}

const requests: MockXMLHttpRequest[] = []
const thisAddListener = (listeners: ListenerMap, type: string, listener: Listener): void => {
    const list = listeners.get(type) ?? []
    list.push(listener)
    listeners.set(type, list)
}

const thisAddUploadListener = (listeners: ListenerMap, type: string, listener: Listener): void => {
    const list = listeners.get(type) ?? []
    list.push(listener)
    listeners.set(type, list)
}

type DeferredPromise<T> = {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
}

const createDeferred = <T>(): DeferredPromise<T> => {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void

    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })

    return { promise, resolve, reject }
}

function createImageFile(overrides: { name?: string; type?: string; size?: number } = {}): File {
    const file = new File(['image-bytes'], overrides.name ?? 'image.png', { type: overrides.type ?? 'image/png' })
    if (overrides.size !== undefined) {
        try {
            Object.defineProperty(file, 'size', {
                value: overrides.size,
                configurable: true,
            })
        } catch {
            // Happy-dom's File can sometimes enforce size in a way that blocks defineProperty.
        }
    }
    return file
}

function createModal() {
    const onComplete = vi.fn()
    const onCancel = vi.fn()

    const modal = new ImageUploadModal({
        onComplete,
        onCancel,
    })

    return { modal, onComplete, onCancel }
}

describe('ImageUploadModal', () => {
    let originalXmlHttpRequest: typeof XMLHttpRequest | undefined
    let originalAlert: any
    let alertSpy: ReturnType<typeof vi.fn> | null = null
    let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        document.body.innerHTML = ''
        vi.clearAllMocks()

        originalXmlHttpRequest = globalThis.XMLHttpRequest
        globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest

        MockXMLHttpRequest.reset()
        vi.mocked(AuthService.getTokenSilently).mockResolvedValue('token-1')
        vi.mocked(RouterService.getRouteParams).mockReturnValue({
            workspaceId: 'workspace-id',
        })

        originalAlert = (globalThis as any).alert
        alertSpy = vi.fn()
        ;(globalThis as any).alert = alertSpy

        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        document.body.innerHTML = ''
        if (originalXmlHttpRequest) {
            globalThis.XMLHttpRequest = originalXmlHttpRequest
        }
        if (originalAlert === undefined) {
            delete (globalThis as any).alert
        } else {
            ;(globalThis as any).alert = originalAlert
        }
        alertSpy = null
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('renders overlay and defaults to the upload tab', () => {
        const { modal } = createModal()

        modal.show()

        const overlay = document.querySelector('.image-upload-modal-overlay')
        const uploadContent = document.querySelector('.image-upload-content')
        const urlContent = document.querySelector('.image-url-content')
        const uploadTab = document.querySelectorAll('.image-upload-tab')[0] as HTMLButtonElement
        const urlTab = document.querySelectorAll('.image-upload-tab')[1] as HTMLButtonElement

        expect(overlay).not.toBeNull()
        expect(uploadContent).not.toBeNull()
        expect(urlContent).toBeNull()
        expect(uploadTab.className).toContain('active')
        expect(urlTab.className).not.toContain('active')
    })

    it('switches between upload and URL content and prevents switching while uploading', async () => {
        const { modal, onComplete } = createModal()
        const file = createImageFile()

        const uploadDeferred = createDeferred<ImageUploadResult>()
        vi.spyOn(modal as any, 'uploadFile').mockReturnValue(uploadDeferred.promise)

        modal.show()
        const uploadTab = document.querySelectorAll('.image-upload-tab')[0] as HTMLButtonElement
        const urlTab = document.querySelectorAll('.image-upload-tab')[1] as HTMLButtonElement

        const runningUpload = (modal as any).handleFileSelect(file)
        await Promise.resolve()

        urlTab.dispatchEvent(new MouseEvent('click'))

        expect(uploadTab.className).toContain('active')
        expect(urlTab.className).not.toContain('active')
        expect(document.querySelector('.image-upload-content')).not.toBeNull()
        expect(document.querySelector('.image-url-content')).toBeNull()

        uploadDeferred.resolve({
            success: true,
            fileId: 'file-id',
            src: '/api/files/workspace-id/image.png',
        })

        await runningUpload
        expect(onComplete).toHaveBeenCalledWith({
            success: true,
            fileId: 'file-id',
            src: '/api/files/workspace-id/image.png',
        })
    })

    it('inserts a URL and closes the modal', () => {
        const { modal, onComplete } = createModal()

        modal.show()

        const urlTab = document.querySelectorAll('.image-upload-tab')[1] as HTMLButtonElement
        urlTab.dispatchEvent(new MouseEvent('click'))

        const urlInput = document.querySelector('[data-url-input]') as HTMLInputElement
        const insertButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Insert') as HTMLButtonElement

        urlInput.value = 'https://example.com/photo.jpg '
        insertButton.dispatchEvent(new MouseEvent('click'))

        expect(onComplete).toHaveBeenCalledWith({
            success: true,
            src: 'https://example.com/photo.jpg',
        })
        expect(document.querySelector('.image-upload-modal-overlay')).toBeNull()
    })

    it('calls onCancel when overlay or URL cancel is clicked', () => {
        const { modal, onCancel } = createModal()

        modal.show()

        const overlay = document.querySelector('.image-upload-modal-overlay') as HTMLElement
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(document.querySelector('.image-upload-modal-overlay')).toBeNull()
    })

    it('calls onCancel when URL cancel is clicked', () => {
        const { modal, onCancel } = createModal()

        modal.show()
        const urlTab = document.querySelectorAll('.image-upload-tab')[1] as HTMLButtonElement
        urlTab.dispatchEvent(new MouseEvent('click'))

        const cancelButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cancel') as HTMLButtonElement
        cancelButton.dispatchEvent(new MouseEvent('click'))

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(document.querySelector('.image-upload-modal-overlay')).toBeNull()
    })

    it('blocks non-image uploads with an alert', async () => {
        const { modal, onComplete } = createModal()
        const badFile = {
            type: 'text/plain',
            name: 'notes.txt',
            size: 123,
        } as File

        await (modal as any).handleFileSelect(badFile)

        expect(alertSpy).toHaveBeenCalledWith('Please select an image file')
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('blocks oversized image uploads with an alert', async () => {
        const { modal, onComplete } = createModal()
        const oversizedFile = createImageFile({ size: MAX_UPLOAD_FILE_SIZE + 1 })

        await (modal as any).handleFileSelect(oversizedFile)

        expect(alertSpy).toHaveBeenCalledWith('File size exceeds 1GB limit')
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('uploads files via XMLHttpRequest, applies progress updates, and returns tokenized src', async () => {
        const { modal, onComplete } = createModal()
        const file = createImageFile()

        modal.show()
        const uploadResult = (modal as any).handleFileSelect(file)
        await Promise.resolve()

        const request = MockXMLHttpRequest.getActiveRequests()[0] as MockXMLHttpRequest
        expect(request.method).toBe('POST')
        expect(request.requestUrl).toContain('/api/files/workspace-id')
        expect(request.headers.Authorization).toBe('Bearer token-1')

        expect(request.sentBody).toBeInstanceOf(FormData)

        const progressBar = document.querySelector('[data-progress-bar]') as HTMLDivElement
        const progressLabel = document.querySelector('[data-progress-label]') as HTMLParagraphElement

        request.triggerUploadProgress({
            lengthComputable: true,
            loaded: 5,
            total: 10,
        })

        expect(progressBar.style.width).toBe('50%')
        expect(progressLabel.textContent).toBe('Uploading... 50%')

        request.status = 200
        request.responseText = JSON.stringify({ fileId: 'file-abc', url: '/api/files/workspace-id/image.png' })
        request.triggerLoad()

        const result = await uploadResult

        expect(result).toBeUndefined()
        expect(onComplete).toHaveBeenCalledWith({
            success: true,
            fileId: 'file-abc',
            src: 'http://localhost:3005/api/files/workspace-id/image.png?token=token-1',
        })
        expect(document.querySelector('.image-upload-modal-overlay')).toBeNull()
        expect(vi.mocked(AuthService.getTokenSilently)).toHaveBeenCalledTimes(2)
    })

    it('handles upload server errors by rejecting and surfacing the server error message', async () => {
        const { modal } = createModal()
        const file = createImageFile()

        const uploadPromise = (modal as any).uploadFile(file)
        await Promise.resolve()

        const request = MockXMLHttpRequest.getActiveRequests()[0] as MockXMLHttpRequest
        expect(request).toBeDefined()
        request.status = 413
        request.responseText = JSON.stringify({ error: 'File too large' })

        request.triggerLoad()

        await expect(uploadPromise).rejects.toThrow('File too large')
    })

    it('handles upload network errors by rejecting', async () => {
        const { modal } = createModal()
        const file = createImageFile()

        const uploadPromise = (modal as any).uploadFile(file)
        await Promise.resolve()

        const request = MockXMLHttpRequest.getActiveRequests()[0] as MockXMLHttpRequest
        expect(request).toBeDefined()
        request.triggerError()

        await expect(uploadPromise).rejects.toThrow('Network error during upload')
    })

    it('handles upload failures in handleFileSelect by showing alert and remaining mounted', async () => {
        const { modal, onComplete } = createModal()
        const file = createImageFile()

        vi.spyOn(modal as any, 'uploadFile').mockRejectedValue(new Error('Upload failed hard'))

        modal.show()

        const progressContainer = document.querySelector('[data-progress-container]') as HTMLElement
        await (modal as any).handleFileSelect(file)

        expect(progressContainer.style.display).toBe('none')
        expect(alertSpy).toHaveBeenCalledTimes(1)
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Upload failed:'))
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Upload failed hard'))
        expect(document.querySelector('.image-upload-modal-overlay')).not.toBeNull()
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('falls back to Unknown error when upload rejection is not an Error object', async () => {
        const { modal, onComplete } = createModal()
        const file = createImageFile()

        vi.spyOn(modal as any, 'uploadFile').mockRejectedValue('upload service unavailable')

        modal.show()
        const progressContainer = document.querySelector('[data-progress-container]') as HTMLElement
        await (modal as any).handleFileSelect(file)

        expect(progressContainer.style.display).toBe('none')
        expect(alertSpy).toHaveBeenCalledWith('Upload failed: Unknown error')
        expect(document.querySelector('.image-upload-modal-overlay')).not.toBeNull()
        expect(onComplete).not.toHaveBeenCalled()
    })
})
