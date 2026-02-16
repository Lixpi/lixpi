type AnchoredImageEntry = {
    imageNodeId: string
    threadNodeId: string
    threadReferenceId: string
    responseMessageId: string
    imageHeight: number
}

type AnchoredImageManager = {
    anchorImage(entry: AnchoredImageEntry): void
    updateImageSize(imageNodeId: string, newHeight: number): void
    removeAnchor(imageNodeId: string): AnchoredImageEntry | undefined
    getAnchorsForThread(threadNodeId: string): AnchoredImageEntry[]
    isAnchored(imageNodeId: string): boolean
    getAnchor(imageNodeId: string): AnchoredImageEntry | undefined
    getExclusionPairsForCollisions(): Set<string>
    clear(): void
}

export function createAnchoredImageManager(): AnchoredImageManager {
    const anchors: Map<string, AnchoredImageEntry> = new Map()

    return {
        anchorImage(entry: AnchoredImageEntry): void {
            anchors.set(entry.imageNodeId, entry)
        },

        updateImageSize(imageNodeId: string, newHeight: number): void {
            const entry = anchors.get(imageNodeId)
            if (entry) {
                entry.imageHeight = newHeight
            }
        },

        removeAnchor(imageNodeId: string): AnchoredImageEntry | undefined {
            const entry = anchors.get(imageNodeId)
            if (entry) {
                anchors.delete(imageNodeId)
            }
            return entry
        },

        getAnchorsForThread(threadNodeId: string): AnchoredImageEntry[] {
            const result: AnchoredImageEntry[] = []
            for (const entry of anchors.values()) {
                if (entry.threadNodeId === threadNodeId) {
                    result.push(entry)
                }
            }
            return result
        },

        isAnchored(imageNodeId: string): boolean {
            return anchors.has(imageNodeId)
        },

        getAnchor(imageNodeId: string): AnchoredImageEntry | undefined {
            return anchors.get(imageNodeId)
        },

        getExclusionPairsForCollisions(): Set<string> {
            const pairs = new Set<string>()
            for (const entry of anchors.values()) {
                pairs.add(`${entry.imageNodeId}-${entry.threadNodeId}`)
                pairs.add(`${entry.threadNodeId}-${entry.imageNodeId}`)
            }
            return pairs
        },

        clear(): void {
            anchors.clear()
        },
    }
}

export type { AnchoredImageEntry, AnchoredImageManager }
