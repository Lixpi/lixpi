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
