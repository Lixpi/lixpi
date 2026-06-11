// Simple singleton to manage which info bubble is open (mutual exclusion)
// Ensures only one bubble is visible at a time across the entire application
class InfoBubbleStateManager {
    private openBubbleId: string | null = null
    private bubbles: Map<string, { close: () => void }> = new Map()

    register(id: string, bubble: { close: () => void }): void {
        this.bubbles.set(id, bubble)
    }

    unregister(id: string): void {
        this.bubbles.delete(id)
    }

    open(id: string): void {
        const previousId = this.openBubbleId

        // Close previously open bubble if different
        if (previousId && previousId !== id) {
            this.bubbles.get(previousId)?.close()
        }

        this.openBubbleId = id
    }

    close(id: string): void {
        if (this.openBubbleId === id) {
            this.openBubbleId = null
        }
    }

    closeAll(): void {
        const currentId = this.openBubbleId
        if (currentId) {
            this.openBubbleId = null
            this.bubbles.get(currentId)?.close()
        }
    }

    isOpen(id: string): boolean {
        return this.openBubbleId === id
    }
}

export const infoBubbleStateManager = new InfoBubbleStateManager()
