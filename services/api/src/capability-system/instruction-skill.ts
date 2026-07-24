'use strict'

import {
    type InstructionSkillStorage,
} from '@lixpi/capability-system/backend'

import {
    seedBuiltInCapability,
    storeCapabilityResource,
} from '../models/capability.ts'

export const capabilityInstructionSkillStorage: InstructionSkillStorage = {
    storeResource: storeCapabilityResource,
    seedBuiltInCapability,
}
