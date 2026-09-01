'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

import { capabilitySubjects } from './capability-subjects.ts'

const subjects = NATS_SUBJECTS.CAPABILITY_SUBJECTS

describe('Capability NATS transport contract', () => {
    it('registers every catalog and run command exactly once', () => {
        const registered = capabilitySubjects.map((subscription) => subscription.subject)

        expect(registered).toEqual([
            subjects.CATALOG.SEARCH,
            subjects.CATALOG.GET,
            subjects.CATALOG.CREATE,
            subjects.CATALOG.UPDATE,
            subjects.CATALOG.DELETE,
            subjects.CATALOG.GRANT,
            subjects.CATALOG.REVOKE,
            subjects.CATALOG.LIST,
            subjects.CATALOG.SAVE,
            subjects.RUN.START,
            subjects.RUN.STATUS,
            subjects.RUN.RESUME,
            subjects.RUN.STOP,
            subjects.RUN.GET,
            subjects.RUN.REPLAY,
        ])
        expect(new Set(registered).size).toBe(registered.length)
    })

    it('exposes browser event subscriptions only through the per-user token projection', () => {
        const start = capabilitySubjects.find((subscription) => subscription.subject === subjects.RUN.START)
        const create = capabilitySubjects.find((subscription) => subscription.subject === subjects.CATALOG.CREATE)

        expect(start?.permissions.sub.allow).toEqual([`${subjects.RUN.STATUS}.{userIdToken}.>`])
        expect(create?.permissions.sub.allow).toEqual([`${subjects.CATALOG.CATALOG_CHANGED}.{userIdToken}`])
        expect(start?.permissions.sub.allow).not.toContain(`${subjects.RUN.EVENTS}.>`)
        expect(create?.permissions.sub.allow).not.toContain(subjects.CATALOG.CATALOG_CHANGED)
    })
})
