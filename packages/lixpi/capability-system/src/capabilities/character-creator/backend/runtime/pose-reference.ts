import { readFile } from 'node:fs/promises'

import {
    type CharacterPanelSpec,
} from '../../shared/character-sheet-media-plan.ts'
import {
    type CharacterImageReference,
} from './runtime-ports.ts'

const poseReferenceFileByPanelId: Readonly<Record<string, string>> = {
    'head-front-neutral': 'head-front-neutral.png',
    'body-front': 'body-front.png',
    'body-profile': 'body-profile.png',
    'body-back': 'body-back.png',
    'prop-primary': 'prop-primary.png',
    'prop-secondary': 'prop-primary.png',
    'action-signature': 'action-signature.png',
}

const sourceOnlyPanelIds = new Set([
    'head-three-quarter',
    'outfit-front-detail',
    'outfit-back-detail',
])

const poseReferenceBytesByFileName = new Map<string, Promise<Buffer>>()

export async function loadCharacterPoseReference(
    panel: CharacterPanelSpec,
): Promise<CharacterImageReference | undefined> {
    const fileName = poseReferenceFileByPanelId[panel.panelId]
    if (!fileName && sourceOnlyPanelIds.has(panel.panelId)) return undefined
    if (!fileName) throw new Error(`CHARACTER_PANEL_POSE_REFERENCE_MISSING:${panel.panelId}`)
    const bytes = await loadPoseReferenceBytes(fileName)
    return {
        url: `data:image/png;base64,${bytes.toString('base64')}`,
        role: 'pose-reference',
        fileName: `POSE_REFERENCE_${panel.panelId}.png`,
    }
}

export function hasCharacterPoseReference(panel: CharacterPanelSpec): boolean {
    return Boolean(poseReferenceFileByPanelId[panel.panelId])
}

function loadPoseReferenceBytes(fileName: string): Promise<Buffer> {
    const cached = poseReferenceBytesByFileName.get(fileName)
    if (cached) return cached
    const pending = readFile(new URL(`../../tools/resources/pose-references/${fileName}`, import.meta.url))
    poseReferenceBytesByFileName.set(fileName, pending)
    return pending
}
