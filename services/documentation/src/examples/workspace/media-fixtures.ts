export const mediaFixtures = {
    image: {
        url: '/fixtures/canvas-sample.png',
        mimeType: 'image/png',
        blobHash: 'a7557fbbef0930d7ace76cd1231f1afee0d4ef54fe963940835dca73f30ba45a',
        byteSize: 36074,
        width: 640,
        height: 360,
    },
    video: {
        url: '/fixtures/canvas-sample.webm',
        mimeType: 'video/webm',
        blobHash: '28c029b31804b58e7581d49f30074f1151e7453ff86b0fe936daf88c2d044214',
        byteSize: 57698,
        width: 640,
        height: 360,
    },
    audio: {
        url: '/fixtures/canvas-sample.wav',
        mimeType: 'audio/wav',
        blobHash: '2d477471153f8ac479d0d2d2b4df7e08b62bc2ffad260840e9522c93c229b4a7',
        byteSize: 264678,
        width: undefined,
        height: undefined,
    },
} as const

// First-page posters made with the production conversion tools in the nex
// image: LibreOffice for Word to PDF, `pdftocairo -scale-to 1024` for PDF pages
// and the text poster layout for Markdown and plain text.
export const documentPosterFixtures = {
    creativeBrief: {
        url: '/fixtures/document-creative-brief-poster.png',
        blobHash: 'ac053f5a57433e00d1ad5137c8f06ee51a6eafc18150a46cc9eed63529c50b3c',
        byteSize: 105717,
        width: 725,
        height: 1024,
    },
    shotList: {
        url: '/fixtures/document-shot-list-poster.png',
        blobHash: '2b324e68954ebb6a541621b572e05e85f271ac0a3022f655da55b6f6f1f9b7cc',
        byteSize: 65291,
        width: 725,
        height: 1024,
    },
    promptNotes: {
        url: '/fixtures/document-prompt-notes-poster.png',
        blobHash: '0f94f4011074f8412fd8ec7ddb1910a573f79951e3dc4be7433486f23fe0f660',
        byteSize: 98222,
        width: 1024,
        height: 1448,
    },
} as const
