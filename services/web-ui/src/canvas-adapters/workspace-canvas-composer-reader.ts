import {
    type CanvasCollaborationComposerEvent,
    type EncryptedCanvasCollaborationComposerEvent,
} from '@lixpi/constants'

const encodeKey = (bytes: ArrayBuffer): string =>
    btoa(
        String.fromCharCode(...new Uint8Array(bytes)),
    )
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '')

const decodeKey = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(
    atob(
        value.replaceAll('-', '+').replaceAll('_', '/'),
    ),
    value => value.charCodeAt(0),
)

export class WorkspaceCanvasComposerReader {
    readonly inboxId = crypto.randomUUID()

    private constructor(
        readonly publicKey: string,
        private readonly privateKey: CryptoKey,
    ) {}

    static async create(): Promise<WorkspaceCanvasComposerReader> {
        const keys = await crypto.subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256',
            },
            true,
            ['deriveKey'],
        )
        const clear = await crypto.subtle.exportKey('raw', keys.publicKey)

        return new WorkspaceCanvasComposerReader(
            encodeKey(clear),
            keys.privateKey,
        )
    }

    async read(packet: EncryptedCanvasCollaborationComposerEvent): Promise<CanvasCollaborationComposerEvent> {
        const publicKey = await crypto.subtle.importKey(
            'raw',
            decodeKey(packet.publicKey),
            {
                name: 'ECDH',
                namedCurve: 'P-256',
            },
            false,
            [],
        )
        const secret = await crypto.subtle.deriveKey(
            {
                name: 'ECDH',
                public: publicKey,
            },
            this.privateKey,
            {
                name: 'AES-GCM',
                length: 256,
            },
            false,
            ['decrypt'],
        )
        const content = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: decodeKey(packet.iv),
            },
            secret,
            decodeKey(packet.ciphertext),
        )

        return JSON.parse(
            new TextDecoder().decode(content),
        ) as CanvasCollaborationComposerEvent
    }
}
