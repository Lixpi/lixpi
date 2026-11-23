export const workspaceExportUrl = ({
    workspaceId,
    apiBaseUrl,
    origin,
    token,
}: {
    workspaceId: string
    apiBaseUrl: string
    origin: string
    token: string
}): string => {
    const url = new URL(`${apiBaseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/export`, origin)
    url.searchParams.set('token', token)

    return url.toString()
}

type WorkspaceExportOptions = {
    workspaceId: string
    apiBaseUrl: string
    getToken: () => Promise<string | false | null | undefined>
    window: Window
}

export const openWorkspaceExport = async ({
    workspaceId,
    apiBaseUrl,
    getToken,
    window,
}: WorkspaceExportOptions): Promise<void> => {
    const popup = window.open('', '_blank')

    if (!popup)
        throw new Error('Allow pop-ups to download the workspace archive.')

    popup.opener = null

    try {
        const token = await getToken()

        if (!token)
            throw new Error('Sign in to download the workspace archive.')

        if (popup.closed)
            throw new Error('The workspace export tab was closed.')

        popup.location.replace(
            workspaceExportUrl({
                apiBaseUrl,
                workspaceId,
                origin: window.location.origin,
                token,
            }),
        )
    } catch (error) {
        popup.close()

        throw error
    }
}
