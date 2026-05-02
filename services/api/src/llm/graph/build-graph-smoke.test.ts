'use strict'

import { describe, it, expect } from 'vitest'
import { StateGraph, END, START } from '@langchain/langgraph'

import { channels, type ProviderState } from './state.ts'

// Phase 0 spike: prove three non-negotiable behaviors of @langchain/langgraph TS:
//   1. Channel reducer with `keep` semantics preserves unset fields on partial returns.
//   2. AbortSignal cancels mid-node.
//   3. Async conditional edge functions work twice in a row.
describe('LangGraph TS parity', () => {
    it('channel reducer preserves unset fields on partial returns', async () => {
        const graph = new StateGraph<ProviderState>({ channels: channels as any })
            .addNode('setOne', async () => ({
                workspaceId: 'ws-1',
                temperature: 0.5,
            }))
            .addNode('setTwo', async () => ({
                aiChatThreadId: 'thread-1',
            }))

        graph.addEdge(START, 'setOne' as any)
        graph.addEdge('setOne' as any, 'setTwo' as any)
        graph.addEdge('setTwo' as any, END)

        const compiled = graph.compile()
        const final = await compiled.invoke({
            messages: [{ role: 'user', content: 'hi' }],
            aiModelMetaInfo: { provider: 'OpenAI', model: 'gpt', modelVersion: 'gpt-5' },
            eventMeta: {},
            workspaceId: '',
            aiChatThreadId: '',
            instanceKey: 'k',
            provider: 'OpenAI',
            modelVersion: 'gpt-5',
            temperature: 0.7,
            streamActive: false,
            aiRequestReceivedAt: 1000,
        } as ProviderState)

        // Both partial updates merged in. Initial values for fields neither
        // node returned (messages, aiModelMetaInfo, instanceKey, provider, ...)
        // should be preserved.
        expect(final.workspaceId).toBe('ws-1')
        expect(final.temperature).toBe(0.5)
        expect(final.aiChatThreadId).toBe('thread-1')
        expect(final.instanceKey).toBe('k')
        expect(final.provider).toBe('OpenAI')
        expect(final.modelVersion).toBe('gpt-5')
        expect(final.aiRequestReceivedAt).toBe(1000)
        expect(final.messages).toHaveLength(1)
    })

    it('AbortSignal cancels mid-node', async () => {
        const controller = new AbortController()

        const graph = new StateGraph<ProviderState>({ channels: channels as any })
            .addNode('longRunning', async () => {
                // Cooperative cancellation: poll the signal in a loop.
                for (let i = 0; i < 100; i++) {
                    if (controller.signal.aborted) {
                        throw new Error('aborted')
                    }
                    await new Promise(resolve => setTimeout(resolve, 10))
                }
                return { workspaceId: 'completed' }
            })

        graph.addEdge(START, 'longRunning' as any)
        graph.addEdge('longRunning' as any, END)

        const compiled = graph.compile()

        // Abort after 50ms
        setTimeout(() => controller.abort(), 50)

        await expect(
            compiled.invoke({
                messages: [],
                aiModelMetaInfo: {} as any,
                eventMeta: {},
                workspaceId: '',
                aiChatThreadId: '',
                instanceKey: 'k',
                provider: 'OpenAI',
                modelVersion: '',
                temperature: 0,
                streamActive: false,
                aiRequestReceivedAt: 0,
            } as ProviderState, { signal: controller.signal }),
        ).rejects.toThrow()
    })

    it('async conditional edges route correctly twice in a row', async () => {
        const calls: string[] = []
        const router = async (s: ProviderState): Promise<'yes' | 'no'> => {
            return s.generatedImagePrompt ? 'yes' : 'no'
        }

        const graph = new StateGraph<ProviderState>({ channels: channels as any })
            .addNode('first', async (_s: ProviderState) => {
                calls.push('first')
                return { generatedImagePrompt: 'a prompt' }
            })
            .addNode('validateBranch', async (_s: ProviderState) => {
                calls.push('validateBranch')
                return {}
            })
            .addNode('executeBranch', async (_s: ProviderState) => {
                calls.push('executeBranch')
                return {}
            })
            .addNode('skipBranch', async (_s: ProviderState) => {
                calls.push('skipBranch')
                return {}
            })

        graph.addEdge(START, 'first' as any)
        graph.addConditionalEdges(
            'first' as any,
            router,
            { yes: 'validateBranch' as any, no: 'skipBranch' as any },
        )
        graph.addConditionalEdges(
            'validateBranch' as any,
            router,
            { yes: 'executeBranch' as any, no: 'skipBranch' as any },
        )
        graph.addEdge('executeBranch' as any, END)
        graph.addEdge('skipBranch' as any, END)

        const compiled = graph.compile()
        await compiled.invoke({
            messages: [],
            aiModelMetaInfo: {} as any,
            eventMeta: {},
            workspaceId: '',
            aiChatThreadId: '',
            instanceKey: 'k',
            provider: 'OpenAI',
            modelVersion: '',
            temperature: 0,
            streamActive: false,
            aiRequestReceivedAt: 0,
        } as ProviderState)

        // first → router('yes') → validateBranch → router('yes') → executeBranch
        expect(calls).toEqual(['first', 'validateBranch', 'executeBranch'])
    })
})
