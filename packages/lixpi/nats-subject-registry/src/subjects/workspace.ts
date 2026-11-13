import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type EndpointContract,
} from '../types.ts'

const WORKSPACE_SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS

// Every workspace subject is a user request that the API answers. The API
// checks the caller's effective access on each request, so the user
// permission only grants publishing to the subject itself.
const userRequest = <Subject extends string>(
    id: string,
    subject: Subject,
) =>
    ({
        id,
        subject,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [subject] },
            sub: { allow: [] },
        },
    }) as const

export const contracts = [
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_NAVIGATION),
        WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_NAVIGATION,
    ),
    {
        ...userRequest(
            getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.SAVE_WORKSPACE_NAVIGATION),
            WORKSPACE_SUBJECTS.SAVE_WORKSPACE_NAVIGATION,
        ),
        queue: 'workspaceNavigationWrites',
    },
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_WORKSPACE),
        WORKSPACE_SUBJECTS.GET_WORKSPACE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE),
        WORKSPACE_SUBJECTS.CREATE_WORKSPACE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE),
        WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE),
        WORKSPACE_SUBJECTS.UPDATE_WORKSPACE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE),
        WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE),
        WORKSPACE_SUBJECTS.DELETE_WORKSPACE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.MOVE_WORKSPACE),
        WORKSPACE_SUBJECTS.MOVE_WORKSPACE,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE_HEADING),
        WORKSPACE_SUBJECTS.CREATE_WORKSPACE_HEADING,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE_HEADING),
        WORKSPACE_SUBJECTS.UPDATE_WORKSPACE_HEADING,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.MOVE_WORKSPACE_HEADING),
        WORKSPACE_SUBJECTS.MOVE_WORKSPACE_HEADING,
    ),
    userRequest(
        getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE_HEADING),
        WORKSPACE_SUBJECTS.DELETE_WORKSPACE_HEADING,
    ),
] as const satisfies readonly EndpointContract[]
