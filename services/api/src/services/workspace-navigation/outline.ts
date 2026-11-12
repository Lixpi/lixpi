import {
    WORKSPACE_NOTE_LEVEL,
    type WorkspaceHeadingLevel,
} from '@lixpi/constants'

// The level an outline block groups at, or undefined for a note, which
// groups nothing and ends no section.
export const sectionLevel = (level: WorkspaceHeadingLevel | undefined): number | undefined => {
    const value = level ?? 1

    return value === WORKSPACE_NOTE_LEVEL ? undefined : value
}

// A workspace cannot move under itself or under one of its descendants.
export const wouldCreateCycle = ({
    workspaceId,
    targetParentId,
    targetAncestorIds,
}: {
    workspaceId: string
    targetParentId: string | undefined
    targetAncestorIds: string[]
}): boolean => targetParentId === workspaceId
    || targetAncestorIds.includes(workspaceId)
