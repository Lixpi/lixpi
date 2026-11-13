// Scrolls the host at most one bounded step per animation frame while the
// pointer remains near an edge. The editor resolves the drop again after
// each scroll, even when the pointer itself has stopped moving.
export class NestedListAutoScroll {
    private frame?: number
    private pointer?: {
        x: number
        y: number
    }

    constructor(
        private readonly window: Window,
        private readonly container: () => HTMLElement | null,
        private readonly onScroll: (
            x: number,
            y: number,
        ) => void,
    ) {}

    update(
        x: number,
        y: number,
    ): void {
        this.pointer = {
            x,
            y,
        }

        if (this.step() === 0) {
            this.cancelFrame()

            return
        }

        if (this.frame === undefined)
            this.frame = this.window.requestAnimationFrame(this.tick)
    }

    private step(): number {
        const element = this.container()

        if (
            !element
            || !this.pointer
        )
            return 0

        const rect = element.getBoundingClientRect()

        if (
            this.pointer.x < rect.left
            || this.pointer.x > rect.right
        )
            return 0

        const edge = Math.min(24, rect.height / 2)

        if (edge <= 0)
            return 0

        if (
            this.pointer.y < rect.top + edge
            && element.scrollTop > 0
        )
            return -Math.min(
                12,
                Math.max(1, ((rect.top + edge - this.pointer.y) / edge) * 12),
            )

        if (
            this.pointer.y > rect.bottom - edge
            && element.scrollTop < element.scrollHeight - element.clientHeight
        )
            return Math.min(
                12,
                Math.max(1, ((this.pointer.y - rect.bottom + edge) / edge) * 12),
            )

        return 0
    }

    private tick = (): void => {
        this.frame = undefined
        const element = this.container()
        const pointer = this.pointer
        const step = this.step()

        if (
            !element
            || !pointer
            || step === 0
        )
            return

        const previous = element.scrollTop
        element.scrollTop = Math.max(
            0,
            Math.min(element.scrollHeight - element.clientHeight, previous + step),
        )

        if (element.scrollTop === previous)
            return

        this.onScroll(pointer.x, pointer.y)

        if (
            this.pointer
            && this.step() !== 0
        )
            this.frame = this.window.requestAnimationFrame(this.tick)
    }

    private cancelFrame(): void {
        if (this.frame !== undefined)
            this.window.cancelAnimationFrame(this.frame)

        this.frame = undefined
    }

    stop(): void {
        this.pointer = undefined
        this.cancelFrame()
    }
}
