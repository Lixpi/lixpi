import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    type CapabilityArtifactCanvasHost,
    type CapabilityArtifactFrontendDefinition,
} from '../../../frontend/capability-artifact-registry.ts'
import {
    MEDIA_SEQUENCE_ARTIFACT_TYPE_ID,
    MEDIA_SEQUENCE_TOOL_ID,
} from '../shared/media-sequence.ts'
import { readMediaSequenceDocument } from '../shared/media-sequence-artifact.ts'
import { ticksToSeconds } from '../shared/sequence-time.ts'

export const MEDIA_SEQUENCE_FRONTEND_STYLES = `
.media-sequence-card { display: flex; flex-direction: column; gap: 8px; padding: 18px; border-radius: 12px; background: hsl(var(--muted, 215 20% 94%)); color: hsl(var(--foreground, 220 20% 14%)); }
`

class MediaSequenceCard {
    private readonly dom: HTMLElement
    constructor(private readonly host: CapabilityArtifactCanvasHost) {
        const html = createDocumentHtml(host.container.ownerDocument)
        this.dom = html`<div class="media-sequence-card"></div>` as HTMLElement
        host.container.append(this.dom)
        this.updateDocument(host.document)
    }

    updateDocument(document: object): void {
        const html = createDocumentHtml(this.host.container.ownerDocument)

        try {
            const sequence = readMediaSequenceDocument(document)
            this.dom.replaceChildren(
                html`<strong>${sequence.name}</strong>` as HTMLElement,
                html`
                    <span>${sequence.tracks.length} tracks · ${sequence.clips.length} clips · ${ticksToSeconds(sequence.duration, sequence.timeBase).toFixed(2)} s · revision ${sequence.revision}</span>
                ` as HTMLElement,
            )
        } catch (error) {
            this.dom.replaceChildren(
                html`<strong>Media Sequence</strong>` as HTMLElement,
                html`
                    <span>${error instanceof Error
                        && error.message.includes('READ_ONLY_VERSION')
                        ? 'This sequence uses a newer format. It is preserved as read-only.'
                        : 'The sequence could not be read.'}</span>
                ` as HTMLElement,
            )
        }

        this.host.onHeightChange(150)
    }

    destroy(): void {
        this.dom.remove()
    }
}

class SequenceLabel {
    private readonly dom: HTMLElement
    constructor(
        container: HTMLElement,
        title: string,
        detail: string,
        action?: () => void,
    ) {
        const html = createDocumentHtml(container.ownerDocument)
        this.dom = action
            ? html`
                <button
                    type="button"
                    class="media-sequence-card"
                    onclick=${action}
                ><strong>${title}</strong><span>${detail}</span></button>
            ` as HTMLElement
            : html`<div class="media-sequence-card"><strong>${title}</strong><span>${detail}</span></div>` as HTMLElement
        container.append(this.dom)
    }

    destroy(): void {
        this.dom.remove()
    }
}

export const mediaSequenceFrontendDefinition: CapabilityArtifactFrontendDefinition = {
    artifactTypeId: MEDIA_SEQUENCE_ARTIFACT_TYPE_ID,
    iconId: 'ordered-list',
    initialCanvasDimensions: {
        width: 360,
        height: 170,
    },
    createCanvasNodeView: host => new MediaSequenceCard(host),
    createGeneratedOutputInfoView: host => {
        try {
            const sequence = readMediaSequenceDocument(host.document)

            return new SequenceLabel(
                host.container,
                sequence.name,
                `${sequence.width} × ${sequence.height} · revision ${sequence.revision}`,
            )
        } catch {
            return new SequenceLabel(
                host.container,
                'Media Sequence',
                'Read-only sequence',
            )
        }
    },
    createPromptReferenceView: host => new SequenceLabel(
        host.container,
        host.title,
        'Media sequence',
    ),
    createLibraryItemView: host => new SequenceLabel(
        host.container,
        host.title,
        `${host.scope} sequence`,
        host.onAddToCanvas,
    ),
    buildReplaySubmitData: () => ({
        capabilityId: MEDIA_SEQUENCE_TOOL_ID,
        capabilityInputs: {},
        reasoningModelIds: [],
    }),
}
