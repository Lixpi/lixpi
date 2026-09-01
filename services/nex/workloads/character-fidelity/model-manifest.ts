export type CharacterFidelityModelArtifact = {
    artifactId: string
    version: string
    fileName: string
    sha256: string
    sourceUrl: string
    license: 'Apache-2.0' | 'MIT'
    licenseUrl: string
}

export const CHARACTER_FIDELITY_MODEL_MANIFEST = {
    detector: {
        artifactId: 'opencv-zoo-yunet-2026may',
        version: '2026may',
        fileName: 'face_detection_yunet_2026may.onnx',
        sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
        sourceUrl: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/face_detection_yunet_2026may.onnx',
        license: 'MIT',
        licenseUrl: 'https://github.com/opencv/opencv_zoo/blob/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/LICENSE',
    },
    recognizer: {
        artifactId: 'opencv-zoo-sface-2021dec',
        version: '2021dec',
        fileName: 'face_recognition_sface_2021dec.onnx',
        sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
        sourceUrl: 'https://huggingface.co/opencv/face_recognition_sface/resolve/89e1f6f89ab68a12ab974b5b65162abf464a461f/face_recognition_sface_2021dec.onnx',
        license: 'Apache-2.0',
        licenseUrl: 'https://huggingface.co/opencv/face_recognition_sface/blob/89e1f6f89ab68a12ab974b5b65162abf464a461f/LICENSE',
    },
} as const satisfies Record<'detector' | 'recognizer', CharacterFidelityModelArtifact>
