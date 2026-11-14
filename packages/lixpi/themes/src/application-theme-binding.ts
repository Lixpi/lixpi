import {
    getTheme,
    isThemePreference,
    lixpiLightTheme,
    oneDarkProMarianaTheme,
    type ApplicationTheme,
} from './index.ts'

type ApplicationThemeBindingConfig = {
    document?: Document
    subscribePreference: (listener: (preference?: string) => void) => () => void
    onChange?: (theme: ApplicationTheme) => void
}

export class ApplicationThemeBinding {
    private readonly root: HTMLElement
    private readonly systemScheme?: MediaQueryList
    private readonly unsubscribe: () => void
    private readonly previousTheme?: string
    private readonly previousScheme?: string
    private preference?: string
    private applied?: ApplicationTheme

    constructor(private readonly config: ApplicationThemeBindingConfig) {
        const document = config.document ?? globalThis.document
        this.root = document.documentElement
        this.previousTheme = this.root.dataset.colorTheme
        this.previousScheme = this.root.dataset.theme
        this.systemScheme = document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')
        this.systemScheme?.addEventListener('change', this.apply)
        this.unsubscribe = config.subscribePreference(preference => {
            this.preference = preference
            this.apply()
        })
    }

    private readonly apply = (): void => {
        const preset = this.preference === 'system'
            ? this.systemScheme?.matches
                ? oneDarkProMarianaTheme
                : lixpiLightTheme
            : isThemePreference(this.preference)
                ? getTheme(this.preference)
                : lixpiLightTheme

        if (this.applied === preset)
            return

        this.applied = preset
        this.root.dataset.colorTheme = preset.name
        this.root.dataset.theme = preset.colorScheme
        this.config.onChange?.(preset)
    }

    destroy(): void {
        this.unsubscribe()
        this.systemScheme?.removeEventListener('change', this.apply)

        if (this.previousTheme === undefined)
            delete this.root.dataset.colorTheme
        else
            this.root.dataset.colorTheme = this.previousTheme

        if (this.previousScheme === undefined)
            delete this.root.dataset.theme
        else
            this.root.dataset.theme = this.previousScheme

        this.config.onChange?.(
            isThemePreference(this.previousTheme)
                && this.previousTheme !== 'system'
                ? getTheme(this.previousTheme)
                : lixpiLightTheme,
        )
    }
}
