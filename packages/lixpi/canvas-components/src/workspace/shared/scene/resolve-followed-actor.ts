import {
    resolveCanvasViewerActor,
    type CanvasCollaborationActor,
} from '@lixpi/constants'

export const resolveFollowedActor = (
    actors: readonly CanvasCollaborationActor[],
    actorId: string,
): CanvasCollaborationActor | null => {
    const byId = new Map(
        actors.map(actor => [actor.actorId, actor]),
    )
    const visited = new Set([actorId])
    const nextActor = (actor: CanvasCollaborationActor | undefined): CanvasCollaborationActor | undefined => actor?.followingViewerId
        ? resolveCanvasViewerActor(
            actors,
            actor.followingViewerId,
            actor.actorId,
        )
        : actor?.followingActorId
            ? byId.get(actor.followingActorId)
            : undefined
    let followed = nextActor(
        byId.get(actorId),
    )
    let current: CanvasCollaborationActor | null = null

    while (
        followed
        && !visited.has(followed.actorId)
    ) {
        visited.add(followed.actorId)
        current = followed
        followed = nextActor(followed)

        if (
            !followed
            && current.followingViewerId
        )
            return null
    }

    return followed ? null : current
}
