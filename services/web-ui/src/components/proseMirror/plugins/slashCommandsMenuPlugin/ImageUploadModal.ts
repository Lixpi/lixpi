import { createEl } from '../../components/domTemplates.ts'
import type { EditorView } from 'prosemirror-view'
import AuthService from '../../../../services/auth-service.ts'
import RouterService from '../../../../services/router-service.ts'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export type ImageUploadResult = {
    success: boolean
    fileId?: string
    src?: string
    error?: string
}

type ImageUploadModalOptions = {
    view?: EditorView
    onComplete: (result: ImageUploadResult) => void
    onCancel: () => void
}

export class ImageUploadModal {
    private overlay: HTMLElement
    private modal: HTMLElement
    private activeTab: 'upload' | 'url' = 'upload'
    private uploadProgress: number = 0
    private isUploading: boolean = false
    private options: ImageUploadModalOptions

    constructor(options: ImageUploadModalOptions) {
        this.options = options
        this.overlay = this.createOverlay()
        this.modal = this.createModal()
        this.overlay.appendChild(this.modal)
    }

    private createOverlay(): HTMLElement {
        return createEl('div', {
            className: 'image-upload-modal-overlay',
            style: {
                position: 'fixed',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                backgroundColor: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '1000',
            },
            onClick: (e: Event) => {
                if (e.target === this.overlay) {
                    this.close()
                    this.options.onCancel()
                }
            },
        })
    }

    private createModal(): HTMLElement {
        const modal = createEl('div', {
            className: 'image-upload-modal',
            style: {
                backgroundColor: 'var(--background, #fff)',
                borderRadius: '8px',
                padding: '24px',
                minWidth: '400px',
                maxWidth: '500px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            },
        })

        // Header
        const header = createEl('div', {
            className: 'image-upload-modal-header',
            style: {
                marginBottom: '16px',
            },
        }, createEl('h3', {
            style: {
                margin: '0',
                fontSize: '18px',
                fontWeight: '600',
            },
        }, 'Insert Image'))

        // Tabs
        const tabs = this.createTabs()

        // Content container
        const contentContainer = createEl('div', {
            className: 'image-upload-modal-content',
            'data-content': 'true',
        })

        modal.appendChild(header)
        modal.appendChild(tabs)
        modal.appendChild(contentContainer)

        // Render initial tab content
        this.renderTabContent(contentContainer)

        return modal
    }

    private createTabs(): HTMLElement {
        const tabsContainer = createEl('div', {
            className: 'image-upload-modal-tabs',
            style: {
                display: 'flex',
                gap: '8px',
                marginBottom: '16px',
                borderBottom: '1px solid var(--border, #e5e7eb)',
            },
        })

        const uploadTab = createEl('button', {
            className: `image-upload-tab ${this.activeTab === 'upload' ? 'active' : ''}`,
            style: {
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderBottom: this.activeTab === 'upload' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                color: this.activeTab === 'upload' ? 'var(--primary, #3b82f6)' : 'var(--muted-foreground, #6b7280)',
                fontWeight: this.activeTab === 'upload' ? '600' : '400',
            },
            onClick: () => this.switchTab('upload'),
        }, 'Upload File')

        const urlTab = createEl('button', {
            className: `image-upload-tab ${this.activeTab === 'url' ? 'active' : ''}`,
            style: {
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderBottom: this.activeTab === 'url' ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                color: this.activeTab === 'url' ? 'var(--primary, #3b82f6)' : 'var(--muted-foreground, #6b7280)',
                fontWeight: this.activeTab === 'url' ? '600' : '400',
            },
            onClick: () => this.switchTab('url'),
        }, 'From URL')

        tabsContainer.appendChild(uploadTab)
        tabsContainer.appendChild(urlTab)

        return tabsContainer
    }

    private switchTab(tab: 'upload' | 'url'): void {
        if (this.isUploading) return
        this.activeTab = tab

        // Re-render tabs and content
        const tabsContainer = this.modal.querySelector('.image-upload-modal-tabs')
        if (tabsContainer) {
            tabsContainer.replaceWith(this.createTabs())
        }

        const contentContainer = this.modal.querySelector('[data-content]') as HTMLElement
        if (contentContainer) {
            this.renderTabContent(contentContainer)
        }
    }

    private renderTabContent(container: HTMLElement): void {
        container.innerHTML = ''

        if (this.activeTab === 'upload') {
            container.appendChild(this.createUploadContent())
        } else {
            container.appendChild(this.createUrlContent())
        }
    }

    private createUploadContent(): HTMLElement {
        const content = createEl('div', {
            className: 'image-upload-content',
        })

        // File drop zone
        const dropZone = createEl('div', {
            className: 'image-upload-dropzone',
            style: {
                border: '2px dashed var(--border, #e5e7eb)',
                borderRadius: '8px',
                padding: '32px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border-color 0.2s, background-color 0.2s',
            },
            onDragover: (e: Event) => {
                e.preventDefault()
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--primary, #3b82f6)'
                ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--accent, #f3f4f6)'
            },
            onDragleave: (e: Event) => {
                e.preventDefault()
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border, #e5e7eb)'
                ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            },
            onDrop: (e: Event) => {
                e.preventDefault()
                const dropEvent = e as DragEvent
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border, #e5e7eb)'
                ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'

                const files = dropEvent.dataTransfer?.files
                if (files && files.length > 0) {
                    this.handleFileSelect(files[0])
                }
            },
            onClick: () => fileInput.click(),
        })

        const dropZoneText = createEl('p', {
            style: {
                margin: '0 0 8px 0',
                color: 'var(--muted-foreground, #6b7280)',
            },
        }, 'Drag and drop an image here, or click to select')

        const dropZoneHint = createEl('p', {
            style: {
                margin: '0',
                fontSize: '12px',
                color: 'var(--muted-foreground, #9ca3af)',
            },
        }, 'Supports: PNG, JPG, GIF, WebP (max 1GB)')

        dropZone.appendChild(dropZoneText)
        dropZone.appendChild(dropZoneHint)

        // Hidden file input
        const fileInput = createEl('input', {
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: (e: Event) => {
                const input = e.target as HTMLInputElement
                if (input.files && input.files.length > 0) {
                    this.handleFileSelect(input.files[0])
                }
            },
        }) as HTMLInputElement

        // Progress bar container (hidden initially)
        const progressContainer = createEl('div', {
            className: 'image-upload-progress',
            style: {
                display: 'none',
                marginTop: '16px',
            },
            'data-progress-container': 'true',
        })

        const progressLabel = createEl('p', {
            style: {
                margin: '0 0 8px 0',
                fontSize: '14px',
            },
            'data-progress-label': 'true',
        }, 'Uploading...')

        const progressBarOuter = createEl('div', {
            style: {
                height: '8px',
                backgroundColor: 'var(--muted, #e5e7eb)',
                borderRadius: '4px',
                overflow: 'hidden',
            },
        })

        const progressBarInner = createEl('div', {
            style: {
                height: '100%',
                width: '0%',
                backgroundColor: 'var(--primary, #3b82f6)',
                transition: 'width 0.2s',
            },
            'data-progress-bar': 'true',
        })

        progressBarOuter.appendChild(progressBarInner)
        progressContainer.appendChild(progressLabel)
        progressContainer.appendChild(progressBarOuter)

        content.appendChild(dropZone)
        content.appendChild(fileInput)
        content.appendChild(progressContainer)

        return content
    }

    private createUrlContent(): HTMLElement {
        const content = createEl('div', {
            className: 'image-url-content',
        })

        const label = createEl('label', {
            style: {
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500',
            },
        }, 'Image URL')

        const input = createEl('input', {
            type: 'url',
            placeholder: 'https://example.com/image.jpg',
            style: {
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
            },
            'data-url-input': 'true',
        }) as HTMLInputElement

        const buttonContainer = createEl('div', {
            style: {
                marginTop: '16px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
            },
        })

        const cancelButton = createEl('button', {
            style: {
                padding: '8px 16px',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
            },
            onClick: () => {
                this.close()
                this.options.onCancel()
            },
        }, 'Cancel')

        const insertButton = createEl('button', {
            style: {
                padding: '8px 16px',
                border: 'none',
                borderRadius: '6px',
                backgroundColor: 'var(--primary, #3b82f6)',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
            },
            onClick: () => {
                const urlInput = this.modal.querySelector('[data-url-input]') as HTMLInputElement
                const url = urlInput?.value?.trim()

                if (url) {
                    this.close()
                    this.options.onComplete({
                        success: true,
                        src: url,
                    })
                }
            },
        }, 'Insert')

        buttonContainer.appendChild(cancelButton)
        buttonContainer.appendChild(insertButton)

        content.appendChild(label)
        content.appendChild(input)
        content.appendChild(buttonContainer)

        return content
    }

    private async handleFileSelect(file: File): Promise<void> {
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file')
            return
        }

        const maxSize = 1024 * 1024 * 1024 // 1GB
        if (file.size > maxSize) {
            alert('File size exceeds 1GB limit')
            return
        }

        this.isUploading = true
        this.showProgress()

        try {
            const result = await this.uploadFile(file)
            this.close()
            this.options.onComplete(result)
        } catch (error: any) {
            console.error('Upload failed:', error)
            this.hideProgress()
            this.isUploading = false
            alert(`Upload failed: ${error.message || 'Unknown error'}`)
        }
    }

    private async uploadFile(file: File): Promise<ImageUploadResult> {
        const workspaceId = RouterService.getRouteParams().workspaceId as string
        if (!workspaceId) {
            throw new Error('No workspace ID available')
        }

        const token = await AuthService.getTokenSilently()
        if (!token) {
            throw new Error('Authentication required')
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            const formData = new FormData()
            formData.append('file', file)

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100)
                    this.updateProgress(percent)
                }
            })

            xhr.addEventListener('load', async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText)
                        // Include token in image URL for browser to load via <img> tag
                        const token = await AuthService.getTokenSilently()
                        const imageUrl = `${API_BASE_URL}${response.url}?token=${encodeURIComponent(token)}`
                        resolve({
                            success: true,
                            fileId: response.fileId,
                            src: imageUrl,
                        })
                    } catch {
                        reject(new Error('Invalid response from server'))
                    }
                } else {
                    try {
                        const errorResponse = JSON.parse(xhr.responseText)
                        reject(new Error(errorResponse.error || `Upload failed with status ${xhr.status}`))
                    } catch {
                        reject(new Error(`Upload failed with status ${xhr.status}`))
                    }
                }
            })

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'))
            })

            xhr.addEventListener('abort', () => {
                reject(new Error('Upload was cancelled'))
            })

            xhr.open('POST', `${API_BASE_URL}/api/images/${workspaceId}`)
            xhr.setRequestHeader('Authorization', `Bearer ${token}`)
            xhr.send(formData)
        })
    }

    private showProgress(): void {
        const progressContainer = this.modal.querySelector('[data-progress-container]') as HTMLElement
        if (progressContainer) {
            progressContainer.style.display = 'block'
        }
    }

    private hideProgress(): void {
        const progressContainer = this.modal.querySelector('[data-progress-container]') as HTMLElement
        if (progressContainer) {
            progressContainer.style.display = 'none'
        }
    }

    private updateProgress(percent: number): void {
        this.uploadProgress = percent
        const progressBar = this.modal.querySelector('[data-progress-bar]') as HTMLElement
        const progressLabel = this.modal.querySelector('[data-progress-label]') as HTMLElement

        if (progressBar) {
            progressBar.style.width = `${percent}%`
        }
        if (progressLabel) {
            progressLabel.textContent = `Uploading... ${percent}%`
        }
    }

    show(): void {
        document.body.appendChild(this.overlay)

        // Focus the URL input if on URL tab
        if (this.activeTab === 'url') {
            const urlInput = this.modal.querySelector('[data-url-input]') as HTMLInputElement
            urlInput?.focus()
        }
    }

    close(): void {
        this.overlay.remove()
    }
}
