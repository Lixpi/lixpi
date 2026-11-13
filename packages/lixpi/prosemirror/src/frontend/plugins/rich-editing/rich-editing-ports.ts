// What the rich-editing features need from the host. The host binds its API
// address and authentication into these, so the features never see a token.

export type MediaUrlOptions = {
    // Turns a bare base64 payload into a data URL of this type.
    base64MimeType?: string
}

// Turns a stored media reference into a URL the browser can load.
export type MediaUrlResolver = (
    url: string,
    options?: MediaUrlOptions,
) => Promise<string>

// The model badge shown on generated media.
export type GeneratedMediaModelBadge = {
    // Sizes the badge chrome on the element that holds the media.
    decorate: (container: HTMLElement) => void
    render: (
        target: HTMLElement,
        modelId: string | null | undefined,
    ) => void
    // Calls back when model names or colors change.
    subscribe: (listener: () => void) => () => void
}

export type RichEditingPorts = {
    resolveMediaUrl: MediaUrlResolver
    downloadImage?: (src: string) => Promise<void>
    modelBadge?: GeneratedMediaModelBadge
}
