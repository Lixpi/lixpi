import { describe, expect, it, vi } from 'vitest'
import { ToolMessage } from '@langchain/core/messages'
import { validateMediaPipeline, type MediaPipeline } from '@lixpi/capability-system/shared'
import { AgentToolResults } from './agent-tool-results.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const largePipeline = (): MediaPipeline => ({
    schemaVersion: 'media-pipeline-v1',
    pipelineId: 'pipeline-large',
    revision: 1,
    origin: {
        conversationAssetId: 'conversation',
        turnId: 'turn',
    },
    requestedOutcome: 'Create the selected local sequence variants.',
    constraints: ['Keep every output identity intact.'],
    sources: [],
    nodes: Array.from({ length: 128 }, (_, index) => ({
        nodeId: `sequence-${index}`,
        operationKey: 'sequence.create',
        parameters: {
            name: `Sequence ${index}`,
            operations: [],
            notes: 'Detailed selected instructions. '.repeat(30),
        },
        inputs: [],
        outputs: [{
            portId: 'sequence',
            kind: 'sequence',
            required: true,
        }],
    })),
    edges: [],
    executionPolicy: {
        maxConcurrency: 2,
        maxFanout: 2,
    },
    outputBindings: Array.from({ length: 128 }, (_, index) => ({
        outputId: `output-${index}`,
        nodeId: `sequence-${index}`,
        portId: 'sequence',
    })),
})
const toolMessage = (value: unknown) => new ToolMessage({
    id: 'tool-message',
    name: 'save_pipeline',
    tool_call_id: 'native-call',
    status: 'success',
    content: JSON.stringify(value),
})
const createFixture = async () => {
    const fixture = await createConversationExecutionFixture()
    const assertCurrent = vi.fn(async () => {})
    const results = new AgentToolResults(fixture.repository, fixture.payloads, fixture.owner, 'context-1-turn-1', 0, assertCurrent)

    return {
        ...fixture,
        assertCurrent,
        results,
    }
}

describe('bounded private tool results', () => {
    it('retains a large valid pipeline and reads exact complete identities and paginated JSON', async () => {
        const fixture = await createFixture()
        const pipeline = largePipeline()
        expect(validateMediaPipeline(pipeline)).toEqual([])
        const original = toolMessage({
            status: 'succeeded',
            data: { artifact: {
                assetId: 'pipeline-large',
                revision: 1,
                pipeline,
            } },
        })
        const [bounded] = await fixture.results.messages([original])
        expect(bounded).toBeInstanceOf(ToolMessage)
        expect(bounded.id).toBe('tool-message')
        expect((bounded as ToolMessage).tool_call_id).toBe('native-call')
        expect(Buffer.byteLength(bounded.content as string)).toBeLessThanOrEqual(8000)
        const summary = JSON.parse(bounded.content as string)
        expect(summary).toMatchObject({
            status: 'succeeded',
            data: { artifact: {
                assetId: 'pipeline-large',
                revision: 1,
            } },
            summaryOnly: true,
        })
        expect(original.content).toContain('sequence-127')
        const { resultId } = summary.resultReference
        expect(await fixture.results.read({
            resultId,
            pointer: '/data/artifact/pipeline/nodes/127/nodeId',
        })).toMatchObject({ text: 'sequence-127' })
        const nodes = await fixture.results.read({
            resultId,
            pointer: '/data/artifact/pipeline/nodes',
            offset: 127,
        })
        expect(nodes).toMatchObject({
            totalEntries: 128,
            entries: [{
                key: '127',
                pointer: '/data/artifact/pipeline/nodes/127',
            }],
        })
        let offset = 0
        const fragments: string[] = []

        do {
            const page = await fixture.results.read({
                resultId,
                pointer: '/data/artifact/pipeline',
                format: 'json',
                offset,
                limit: 4000,
            }) as {
                text: string
                nextOffset?: number
            }
            expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8000)
            fragments.push(page.text)

            if (page.nextOffset === undefined)
                break

            offset = page.nextOffset
        } while (true)

        expect(JSON.parse(fragments.join(''))).toEqual(pipeline)
    })

    it('does not expose a reference in another namespace and rechecks source access and Stop before reads', async () => {
        const fixture = await createFixture()
        const [bounded] = await fixture.results.messages([toolMessage({ details: 'large '.repeat(3000) })])
        const { resultId } = JSON.parse(bounded.content as string).resultReference
        const other = new AgentToolResults(fixture.repository, fixture.payloads, fixture.owner, 'context-2-turn-1', 0, async () => {})
        await expect(other.readForModel({ resultId })).rejects.toThrow('AGENT_TOOL_RESULT_NOT_IN_CONTEXT')
        fixture.assertCurrent.mockRejectedValueOnce(new Error('SOURCE_ACCESS_REVOKED'))
        await expect(fixture.results.readForModel({ resultId })).rejects.toThrow('SOURCE_ACCESS_REVOKED')
        fixture.assertCurrent.mockRejectedValueOnce(new Error('AGENT_TOOL_RESULT_POINTER_NOT_FOUND'))
        await expect(fixture.results.readForModel({ resultId })).rejects.toThrow('AGENT_TOOL_RESULT_POINTER_NOT_FOUND')
        const payloadRead = vi.spyOn(fixture.payloads, 'read').mockRejectedValueOnce(new Error('AGENT_PAYLOAD_INTEGRITY_FAILED'))
        await expect(fixture.results.readForModel({ resultId })).rejects.toThrow('AGENT_PAYLOAD_INTEGRITY_FAILED')
        payloadRead.mockRestore()
        await fixture.owner.finish('stopped')
        await expect(fixture.results.readForModel(null)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
    })

    it('returns recoverable read-argument errors and lets the model discover and read the correct pointer', async () => {
        const fixture = await createFixture()
        const [bounded] = await fixture.results.messages([toolMessage({ data: { pipeline: largePipeline() } })])
        const { resultId } = JSON.parse(bounded.content as string).resultReference
        const invalidReads: Array<[unknown, string]> = [
            [{
                resultId,
                pointer: '/pipeline/nodes',
            }, 'AGENT_TOOL_RESULT_POINTER_NOT_FOUND'],
            [{
                resultId,
                pointer: 'data',
            }, 'AGENT_TOOL_RESULT_POINTER_INVALID'],
            [{
                resultId,
                pointer: '/data~2',
            }, 'AGENT_TOOL_RESULT_POINTER_INVALID'],
            [{
                resultId,
                pointer: `/${'a'.repeat(2500)}`,
            }, 'AGENT_TOOL_RESULT_POINTER_TOO_LARGE_USE_JSON_RANGE'],
            [{
                resultId,
                offset: 9999,
            }, 'AGENT_TOOL_RESULT_RANGE_INVALID'],
            [{
                resultId,
                offset: -1,
            }, 'AGENT_TOOL_RESULT_RANGE_INVALID'],
            [{
                resultId,
                limit: 0,
            }, 'AGENT_TOOL_RESULT_RANGE_INVALID'],
            [{
                resultId,
                limit: 4001,
            }, 'AGENT_TOOL_RESULT_RANGE_INVALID'],
            [{
                resultId,
                limit: 1.5,
            }, 'AGENT_TOOL_RESULT_RANGE_INVALID'],
            [{
                resultId,
                pointer: 5,
            }, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
            [{
                resultId,
                offset: '0',
            }, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
            [{
                resultId,
                format: 'yaml',
            }, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
            [{
                resultId,
                extra: true,
            }, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
            [{ resultId: 'guessed' }, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
            [null, 'AGENT_TOOL_RESULT_INPUT_INVALID'],
        ]

        for (const [input, code] of invalidReads)
            expect(await fixture.results.readForModel(input)).toMatchObject({
                status: 'error',
                error: {
                    code,
                    recoverable: true,
                },
            })

        expect(await fixture.results.readForModel({
            resultId,
            pointer: '',
            format: 'structure',
        })).toMatchObject({
            entries: [{
                key: 'data',
                pointer: '/data',
            }],
        })
        expect(await fixture.results.readForModel({
            resultId,
            pointer: '/data',
        })).toMatchObject({
            entries: [{
                key: 'pipeline',
                pointer: '/data/pipeline',
            }],
        })
        expect(await fixture.results.readForModel({
            resultId,
            pointer: '/data/pipeline/pipelineId',
        })).toMatchObject({ text: 'pipeline-large' })
    })

    it('recovers a lost reference commit acknowledgment without creating another payload owner', async () => {
        const fixture = await createFixture()
        const prepare = vi.spyOn(fixture.payloads, 'prepare')
        const message = toolMessage({
            state: 'succeeded',
            details: 'large '.repeat(3000),
        })
        fixture.database.failAfterCommit = true
        await expect(fixture.results.messages([message])).rejects.toThrow('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        const [bounded] = await fixture.results.messages([message])
        expect(prepare).toHaveBeenCalledTimes(1)
        expect(JSON.parse(bounded.content as string).state).toBe('succeeded')
        expect([...fixture.database.rows.values()].filter(row => String(row.sk).startsWith('TOOL_RESULT#'))).toHaveLength(1)
    })

    it('bounds escaped text and structural pages without silently cutting field values or identifiers', async () => {
        const fixture = await createFixture()
        const value = {
            details: '\u0000'.repeat(12000),
            identifiers: Array.from({ length: 40 }, (_, index) => `asset-${index}-${'a'.repeat(150)}`),
        }
        const [bounded] = await fixture.results.messages([toolMessage(value)])
        const { resultId } = JSON.parse(bounded.content as string).resultReference
        const page = await fixture.results.read({
            resultId,
            pointer: '/details',
            limit: 4000,
        }) as {
            text: string
            nextOffset: number
        }
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8000)
        expect(page.text).toBe(value.details.slice(0, page.nextOffset))
        const identities = await fixture.results.read({
            resultId,
            pointer: '/identifiers',
            limit: 32,
        }) as {
            entries: Array<{ value: string }>
            nextOffset: number
        }
        expect(identities.nextOffset).toBeGreaterThan(0)
        expect(identities.entries.map(entry => entry.value)).toEqual(value.identifiers.slice(0, identities.nextOffset))
        await expect(fixture.results.read({
            resultId,
            pointer: '/missing',
        })).rejects.toThrow('AGENT_TOOL_RESULT_POINTER_NOT_FOUND')
        await expect(fixture.results.read({
            resultId,
            pointer: '/details',
            offset: 99999,
        })).rejects.toThrow('AGENT_TOOL_RESULT_RANGE_INVALID')
    })

    it('preserves small pending receipts unchanged and bounds nested summary identity fields', async () => {
        const fixture = await createFixture()
        const pending = toolMessage({
            status: 'pending',
            operationId: 'operation-1',
        })
        expect((await fixture.results.messages([pending]))[0]).toBe(pending)
        const identities = {
            status: 'succeeded',
            assetId: 'x'.repeat(256),
            operationId: 'y'.repeat(256),
        }
        const nested = Object.fromEntries(['data', 'artifact', 'pipeline', 'sequence', 'result', 'error'].map(key => [key, identities]))
        const [bounded] = await fixture.results.messages([toolMessage({
            data: nested,
            result: nested,
            sequence: nested,
            details: 'large '.repeat(3000),
        })])
        expect(Buffer.byteLength(bounded.content as string)).toBeLessThanOrEqual(8000)
    })
})
