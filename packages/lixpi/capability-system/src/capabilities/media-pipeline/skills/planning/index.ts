import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'
import { MEDIA_PIPELINE_SKILL_ID } from '../../shared/media-pipeline.ts'

export const createMediaPipelinePlanningSkillPackage = (storage: InstructionSkillStorage) =>
    createInstructionSkillPackage(
        {
            capabilityId: MEDIA_PIPELINE_SKILL_ID,
            name: 'Media Pipeline Planning',
            description: 'Plans typed media dependencies while preserving source references, constraints, and the boundary between drafts and execution.',
            summary: 'Builds executable media plans without treating discussion or draft edits as generation approval.',
            tags: ['media', 'pipeline', 'planning'],
            exportName: 'pipeline-planning',
            resourceId: 'media-pipeline-planning-instructions',
            resourceName: 'Media Pipeline Planning',
            agentSkillName: 'media-pipeline-planning',
            skillFile: new URL('./SKILL.md', import.meta.url),
        },
        storage,
    )
