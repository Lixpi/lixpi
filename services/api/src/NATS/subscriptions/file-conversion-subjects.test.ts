'use strict'

import { describe, expect, it } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

import { fileConversionSubjects } from './file-conversion-subjects.ts'

const { FILE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

describe('File conversion subject subscriptions', () => {
    it('defines the conversion response subscription with wildcard subscribe permission', () => {
        const subject = FILE_SUBJECTS.CONVERT_RESPONSE
        const subscription = fileConversionSubjects.find((candidate) => candidate.subject === subject)

        expect(subscription).toBeDefined()
        expect(subscription?.type).toBe('reply')
        expect(subscription?.payloadType).toBe('json')
        expect(subscription?.permissions).toEqual({
            pub: { allow: [] },
            sub: { allow: [`${FILE_SUBJECTS.CONVERT_RESPONSE}.>`] },
        })
    })

    it('returns an explicit no-op error for unexpected request/reply traffic', async () => {
        const handler = fileConversionSubjects[0]!.handler
        const result = await handler({ any: 'payload' }, { sid: 'sub-1' })

        expect(result).toEqual({ error: 'CONVERT_RESPONSE is a one-way notification subject' })
    })
})
