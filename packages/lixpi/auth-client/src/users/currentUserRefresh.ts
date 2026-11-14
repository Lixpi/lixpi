import {
    type WebClientUserService,
} from './userService.ts'

type CurrentUserRefreshConfig = {
    user: Pick<WebClientUserService, 'refreshUser'>
    onReconnect: (listener: () => void) => () => void
}

export class CurrentUserRefresh {
    private readonly stopReconnect: (() => void) | undefined
    private running = false
    private destroyed = false

    constructor(private readonly config: CurrentUserRefreshConfig) {
        this.stopReconnect = config.onReconnect(this.refresh)
        window.addEventListener('focus', this.refresh)
    }

    private readonly refresh = async (): Promise<void> => {
        if (
            this.running
            || this.destroyed
        )
            return

        this.running = true

        try {
            await this.config.user.refreshUser()
        } catch {
            // A later focus or reconnect can retry without clearing the signed-in user.
        } finally {
            this.running = false
        }
    }

    destroy(): void {
        this.destroyed = true
        window.removeEventListener('focus', this.refresh)
        this.stopReconnect?.()
    }
}
