'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { FILE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

// Async file-conversion completion channel.
//
// The actual conversion is performed by the NEX file-conversion workload over
// WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT (request/reply, initiated by the API
// in the background — see services/file-ingest.ts). When it settles, the API
// publishes a ConvertFileNotification on
//   workspace.file.convert.response.<workspaceId>.<conversionId>
// which the browser is subscribed to (it shows an upload placeholder until then).
//
// This descriptor exists ONLY to grant the browser the subscribe permission for
// that per-upload response subject (the auth callout derives a user's allowlist
// from the registered subscriptions' permissions). The API never request/replies
// on the bare CONVERT_RESPONSE subject — it only publishes to the scoped children
// — so the handler is a defensive no-op that should never fire.
export const fileConversionSubjects = [
    {
        subject: FILE_SUBJECTS.CONVERT_RESPONSE,
        type: 'reply',
        payloadType: 'json',

        permissions: {
            // Browsers never publish here; the API publishes the notifications.
            pub: { allow: [] },
            // Subscribe to every per-upload completion subject for this user's
            // uploads: workspace.file.convert.response.<workspaceId>.<conversionId>.
            sub: { allow: [`${FILE_SUBJECTS.CONVERT_RESPONSE}.>`] },
        },

        handler: async () => ({ error: 'CONVERT_RESPONSE is a one-way notification subject' }),
    },
]
