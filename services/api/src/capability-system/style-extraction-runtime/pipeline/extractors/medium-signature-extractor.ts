import {
    type StyleExtractor,
} from '../types.ts'
import { runAxisVlm } from './_helpers.ts'
import { registerExtractor } from './registry.ts'

// Commits to a medium classification grounded in visible process signatures.
const SYSTEM_PROMPT = `You are a senior visual-analysis specialist focused EXCLUSIVELY on identifying the medium and technique signature of the attached reference. Your sole job is to decide what physical or digital medium the work appears to be made in, and to enumerate the concrete artifacts that justify that classification.

Rules:
- Use objective visible evidence rather than stylistic resemblance, subject matter, or mood.
- Classify the medium with one precise evidence-supported label. Do not select from a stock default list.
- digitalArtifacts and traditionalArtifacts contain only process signatures actually visible in the pixels. Leave either or both empty when unsupported.
- techniqueSignatures[] contains only specific visible technique behavior, expressed without naming unobserved tools or content.
- softwareGuess[] contains zero to three tool or process guesses only when unique visible evidence supports them. Otherwise leave it empty.
- mediumConfidence: 0..1 — how confident you are.
- mediumMismatchWarning: 1 sentence ONLY IF this medium classification CONTRADICTS the upstream router's classification — explain which evidence forced the override.

Do not use any medium term unless visible process signatures support it. Similarity of mood, softness, palette, subject, or composition is not medium evidence.`

const FIELDS_SCHEMA = {
    type: 'object',
    properties: {
        medium: { type: 'string' },
        mediumConfidence: { type: 'number', description: '0..1' },
        techniqueSignatures: { type: 'array', items: { type: 'string' } },
        softwareGuess: { type: 'array', items: { type: 'string' } },
        digitalArtifacts: { type: 'array', items: { type: 'string' } },
        traditionalArtifacts: { type: 'array', items: { type: 'string' } },
        mediumMismatchWarning: { type: 'string', description: 'empty string if no mismatch with the router; 1 sentence otherwise' },
    },
    required: ['medium', 'mediumConfidence', 'techniqueSignatures', 'softwareGuess', 'digitalArtifacts', 'traditionalArtifacts', 'mediumMismatchWarning'],
    additionalProperties: false,
}

const extractor: StyleExtractor = {
    axis: 'medium-signature',
    displayName: 'Medium signature',
    description: "Classifies the medium and enumerates the concrete technique signatures and artifacts that justify the classification. Cross-checks the router's medium claim.",
    minDominance: 0.0,
    applicableTo: () => true,
    extract: async ({ scene, state, logger }) => runAxisVlm({ extractor, state, scene, systemPrompt: SYSTEM_PROMPT, fieldsSchema: FIELDS_SCHEMA, logger }),
}

registerExtractor(extractor)
export default extractor
