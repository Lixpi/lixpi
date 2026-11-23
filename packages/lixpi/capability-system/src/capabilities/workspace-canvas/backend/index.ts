import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import {
    type CapabilityModuleDefinition,
} from '../../../backend/capability-module.ts'
import {
    createCanvasAgentTools,
    WORKSPACE_CANVAS_OPERATION,
} from './canvas-agent-tools.ts'
import {
    createCanvasHandoffAgentTools,
    type CanvasHandoffAccess,
} from './handoff-tools.ts'
import { createCanvasComposerAgentTools } from './canvas-composer-tools.ts'
import {
    type CanvasComposerAccess,
} from './canvas-composer-ports.ts'
import {
    createCanvasGenerationRecoveryTools,
    type CanvasGenerationRecoveryAccess,
} from './canvas-generation-recovery-tools.ts'
import { createExtendedCanvasAgentTools } from './canvas-extended-agent-tools.ts'
import {
    type CanvasExtendedAccess,
} from './canvas-extended-agent-ports.ts'
import {
    type CanvasAgentAccess,
} from './canvas-agent-ports.ts'

const capabilityId = 'global.workspace-canvas'
const tags = ['canvas', 'workspace', 'collaboration', 'editing']

export const createWorkspaceCanvasModule = (
    access: CanvasAgentAccess,
    storage: InstructionSkillStorage,
    extended?: CanvasExtendedAccess,
    handoff?: CanvasHandoffAccess,
    composer?: CanvasComposerAccess,
    recovery?: CanvasGenerationRecoveryAccess,
): CapabilityModuleDefinition => ({
    moduleId: 'workspace-canvas',
    name: 'Workspace Canvas',
    normalizedName: 'workspace canvas',
    summary: 'Inspect and interact with the active shared workspace canvas.',
    tags,
    descriptionSheet: {
        purpose: 'Move around the workspace canvas, inspect its shared state and edit the layout, connections and content.',
        expectedInputs: [{
            name: 'Canvas action',
            requirement: 'required',
            accepts: ['prompt'],
            description: 'Describe the view, placement, connection or document to inspect or change.',
        }],
        bestResults: ['Name the target and describe the intended change.'],
        limitations: ['Editing requires current workspace access and an available target.'],
        executionCharacteristics: {
            cost: 'low',
            latency: 'low',
            summary: 'Canvas changes appear as they are committed. An occupied target waits in the edit queue.',
        },
    },
    entry: {
        kind: 'skill',
        capabilityId,
    },
    operationFamilies: [{
        family: WORKSPACE_CANVAS_OPERATION,
        description: 'Interact with the current workspace canvas and its shared nodes, connections, documents and participant presence.',
        operationKeys: ['canvas.interact'],
    }],
    tools: [],
    skills: [
        createInstructionSkillPackage(
            {
                capabilityId,
                name: 'Workspace Canvas',
                description: 'Interact with the current shared workspace canvas.',
                summary: 'Canvas geometry, Asset edits, participant presence and edit ownership.',
                tags,
                exportName: 'workspace-canvas',
                resourceId: 'workspace-canvas-instructions',
                resourceName: 'Workspace Canvas',
                agentSkillName: 'workspace-canvas',
                skillFile: new URL('../skills/canvas/SKILL.md', import.meta.url),
            },
            storage,
        ),
    ],
    agentEntries: [
        ...createCanvasAgentTools(access),
        ...extended ? createExtendedCanvasAgentTools(access, extended) : [],
        ...handoff ? createCanvasHandoffAgentTools(handoff) : [],
        ...composer ? createCanvasComposerAgentTools(composer) : [],
        ...recovery ? createCanvasGenerationRecoveryTools(access, recovery) : [],
    ],
})
