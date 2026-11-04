import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'
import {
    type AgentScratchFile,
    type AgentScopedBackendPorts,
} from './agent-harness.ts'

type ScratchRow = Omit<AgentScratchFile, 'content'> & { payload: AgentPayload }

export class AgentScratchStore {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly owner: ConversationOwner,
        private readonly namespace: string,
        private readonly continuationEpoch: number,
        private readonly skills: ReadonlyMap<string, string> = new Map(),
    ) {}

    ports(): AgentScopedBackendPorts {
        return {
            assertCurrent: async () => void (await this.owner.fences(this.continuationEpoch)),
            list: async () => {
                const rows: Array<Omit<AgentScratchFile, 'content'> & { size: number }> = []
                let after: string | undefined

                do {
                    const page = await this.repository.query<ScratchRow>(
                        this.owner.partition,
                        this.prefix(),
                        { after },
                    )
                    rows.push(
                        ...page.items.map(
                            row => ({
                                path: row.path,
                                revision: row.revision,
                                updatedAt: row.updatedAt,
                                size: row.payload.byteSize,
                            }),
                        ),
                    )
                    after = page.cursor
                } while (
                    after
                    && rows.length < 256
                )

                return [...this.skills.entries()].map(
                    ([path, content]) => ({
                        path,
                        revision: 1,
                        updatedAt: '',
                        size: content.length,
                    }),
                ).concat(rows)
            },
            read: async path => {
                const skill = this.skills.get(path)

                if (skill !== undefined)
                    return {
                        path,
                        content: skill,
                        revision: 1,
                        updatedAt: '',
                    }

                const row = await this.repository.read<ScratchRow>(
                    this.owner.partition,
                    this.key(path),
                )

                if (!row)
                    return undefined

                return {
                    path: row.path,
                    content: Buffer.from(await this.payloads.read(row.payload)).toString('utf8'),
                    revision: row.revision,
                    updatedAt: row.updatedAt,
                }
            },
            write: async (
                path,
                content,
                expectedRevision,
            ) => {
                const sk = this.key(path)
                const previous = await this.repository.read<ScratchRow>(this.owner.partition, sk)
                const prepared = await this.payloads.prepare(
                    'text',
                    Buffer.from(content),
                    sk,
                )

                if (
                    previous?.payload.hash === prepared.payload.hash
                    && previous.revision === expectedRevision
                )
                    return

                const removal = previous ? await this.payloads.release(previous.payload, sk) : undefined
                await this.repository.commit([
                    ...await this.owner.fences(this.continuationEpoch),
                    this.repository.put(
                        this.owner.partition,
                        sk,
                        {
                            path,
                            revision: expectedRevision + 1,
                            updatedAt: new Date().toISOString(),
                            payload: prepared.payload,
                        },
                        expectedRevision || undefined,
                    ),
                    ...prepared.operations,
                    ...removal?.operations ?? [],
                ])
                await removal?.afterCommit()
            },
        }
    }

    private prefix(): string {
        return `SCRATCH#${Buffer.from(this.namespace).toString('base64url')}#`
    }

    private key(path: string): string {
        return `${this.prefix()}${Buffer.from(path).toString('base64url')}`
    }
}
