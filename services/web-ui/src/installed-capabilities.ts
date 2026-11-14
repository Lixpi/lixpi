import {
    CapabilityArtifactFrontendRegistry,
    CapabilityArtifactSharedRegistry,
    createMediaPipelineFrontendDefinition,
    mediaPipelineSharedDefinition,
    type CapabilityPromptControls,
} from '@lixpi/capability-system/frontend'

import {
    type CapabilityControlsHost,
    type CapabilityControlsView,
} from '@lixpi/prosemirror/frontend/editor'
import { html } from '@lixpi/ui-primitives/dom'
import { orderedListIcon } from '@lixpi/ui-kit/svg'

type InstalledFrontendModule = {
    moduleId: string
    toolId: string
    artifactTypeId: string
}

const installedModules: InstalledFrontendModule[] = []

export const capabilityArtifactFrontendRegistry = new CapabilityArtifactFrontendRegistry()
capabilityArtifactFrontendRegistry.register(
    createMediaPipelineFrontendDefinition(),
)
export const capabilityArtifactSharedRegistry = new CapabilityArtifactSharedRegistry()
capabilityArtifactSharedRegistry.register(mediaPipelineSharedDefinition)

const capabilityArtifactIcons = {
    'ordered-list': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 896" aria-hidden="true"><path d="${orderedListIcon}"></path></svg>`,
} as const

export const getCapabilityArtifactIcon = (artifactTypeId: string): string => {
    const definition = capabilityArtifactFrontendRegistry.get(artifactTypeId)

    if (!definition)
        return capabilityArtifactIcons['ordered-list']

    const icon = capabilityArtifactIcons[definition.iconId as keyof typeof capabilityArtifactIcons]

    if (!icon)
        throw new Error(`CAPABILITY_ARTIFACT_ICON_NOT_INSTALLED:${definition.iconId}`)

    return icon
}

export const ensureCapabilityStyles = (_document: Document): void => {}

export const createInstalledCapabilityControls = (host: CapabilityControlsHost): CapabilityControlsView => {
    const mounted = new Map<string, {
        root: HTMLElement
        controls: CapabilityPromptControls
    }>()
    ensureCapabilityStyles(host.container.ownerDocument)

    const unmount = (module: InstalledFrontendModule): void => {
        const current = mounted.get(module.moduleId)

        if (!current)
            return

        current.controls.destroy()
        current.root.remove()
        mounted.delete(module.moduleId)
        host.setValidity(module.toolId, true)
        const inputs = { ...host.getCapabilityInputs() }
        delete inputs[module.toolId]
        host.setCapabilityInputs(inputs)
    }

    return {
        update: () => {
            const activeModuleIds = new Set(
                host.getModuleIds(),
            )

            for (const module of installedModules) {
                if (!activeModuleIds.has(module.moduleId)) {
                    unmount(module)

                    continue
                }

                if (mounted.has(module.moduleId))
                    continue

                const definition = capabilityArtifactFrontendRegistry.require(module.artifactTypeId)

                if (!definition.createPromptControls)
                    continue

                const root = html`<div className="installed-capability-prompt-controls"></div>` as HTMLDivElement
                host.container.appendChild(root)
                const controls = definition.createPromptControls({
                    container: root,
                    initialValue: host.getCapabilityInputs()[module.toolId],
                    setValue: value => {
                        const inputs = { ...host.getCapabilityInputs() }

                        if (value)
                            inputs[module.toolId] = value
                        else
                            delete inputs[module.toolId]

                        host.setCapabilityInputs(inputs)
                    },
                    setValid: (valid, message) => host.setValidity(
                        module.toolId,
                        valid,
                        message,
                    ),
                })
                controls.hydrateText?.(
                    host.getPromptText(),
                )
                mounted.set(
                    module.moduleId,
                    {
                        root,
                        controls,
                    },
                )
            }
        },
        destroy: () => {
            for (const module of installedModules)
                unmount(module)
        },
    }
}
