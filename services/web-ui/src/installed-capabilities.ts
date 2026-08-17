'use strict'

import {
    ACTION_TIMELINE_FRONTEND_STYLES,
    ACTION_TIMELINE_MODULE_ID,
    ACTION_TIMELINE_TOOL_ID,
    CapabilityArtifactFrontendRegistry,
    CapabilityArtifactSharedRegistry,
    actionTimelineArtifactDefinition,
    actionTimelineFrontendDefinition,
    type CapabilityPromptControls,
} from '@lixpi/capability-system/frontend'

import type {
    CapabilityControlsHost,
    CapabilityControlsView,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import { html } from '$src/utils/domTemplates.ts'
import { orderedListIcon } from '@lixpi/ui-kit/svg'

type InstalledFrontendModule = {
    moduleId: string
    toolId: string
    artifactTypeId: string
}

const installedModules: InstalledFrontendModule[] = [{
    moduleId: ACTION_TIMELINE_MODULE_ID,
    toolId: ACTION_TIMELINE_TOOL_ID,
    artifactTypeId: actionTimelineFrontendDefinition.artifactTypeId,
}]

export const capabilityArtifactFrontendRegistry = new CapabilityArtifactFrontendRegistry()
capabilityArtifactFrontendRegistry.register(actionTimelineFrontendDefinition)
export const capabilityArtifactSharedRegistry = new CapabilityArtifactSharedRegistry()
capabilityArtifactSharedRegistry.register(actionTimelineArtifactDefinition)

const capabilityArtifactIcons = {
    'ordered-list': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 896" aria-hidden="true"><path d="${orderedListIcon}"></path></svg>`,
} as const

export function getCapabilityArtifactIcon(artifactTypeId: string): string {
    const definition = capabilityArtifactFrontendRegistry.require(artifactTypeId)
    const icon = capabilityArtifactIcons[definition.iconId as keyof typeof capabilityArtifactIcons]
    if (!icon) throw new Error(`CAPABILITY_ARTIFACT_ICON_NOT_INSTALLED:${definition.iconId}`)
    return icon
}

const styledDocuments = new WeakSet<Document>()

export function createInstalledCapabilityControls(host: CapabilityControlsHost): CapabilityControlsView {
    const mounted = new Map<string, { root: HTMLElement; controls: CapabilityPromptControls }>()
    ensureCapabilityStyles(host.container.ownerDocument)

    const unmount = (module: InstalledFrontendModule): void => {
        const current = mounted.get(module.moduleId)
        if (!current) return
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
            const activeModuleIds = new Set(host.getModuleIds())
            for (const module of installedModules) {
                if (!activeModuleIds.has(module.moduleId)) {
                    unmount(module)
                    continue
                }
                if (mounted.has(module.moduleId)) continue
                const definition = capabilityArtifactFrontendRegistry.require(module.artifactTypeId)
                if (!definition.createPromptControls) continue
                const root = html`<div className="installed-capability-prompt-controls"></div>` as HTMLDivElement
                host.container.appendChild(root)
                const controls = definition.createPromptControls({
                    container: root,
                    initialValue: host.getCapabilityInputs()[module.toolId],
                    setValue: value => {
                        const inputs = { ...host.getCapabilityInputs() }
                        if (value) inputs[module.toolId] = value
                        else delete inputs[module.toolId]
                        host.setCapabilityInputs(inputs)
                    },
                    setValid: (valid, message) => host.setValidity(module.toolId, valid, message),
                })
                controls.hydrateText?.(host.getPromptText())
                mounted.set(module.moduleId, { root, controls })
            }
        },
        destroy: () => {
            for (const module of installedModules) unmount(module)
        },
    }
}

export function ensureCapabilityStyles(document: Document): void {
    if (styledDocuments.has(document)) return
    const style = document.createElement('style')
    style.dataset.capabilityStyles = ACTION_TIMELINE_MODULE_ID
    style.textContent = ACTION_TIMELINE_FRONTEND_STYLES
    document.head.appendChild(style)
    styledDocuments.add(document)
}
