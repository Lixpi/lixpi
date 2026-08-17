import { describe, expect, it } from 'vitest'

import { CHARACTER_FIDELITY_MODEL_MANIFEST } from './model-manifest.ts'

describe('character fidelity model manifest', () => {
    it('pins OpenCV current model artifacts and their model-specific licenses', () => {
        expect(CHARACTER_FIDELITY_MODEL_MANIFEST.detector).toEqual({
            artifactId: 'opencv-zoo-yunet-2026may',
            version: '2026may',
            fileName: 'face_detection_yunet_2026may.onnx',
            sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
            sourceUrl: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/face_detection_yunet_2026may.onnx',
            license: 'MIT',
            licenseUrl: 'https://github.com/opencv/opencv_zoo/blob/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/LICENSE',
        })
        expect(CHARACTER_FIDELITY_MODEL_MANIFEST.recognizer).toEqual({
            artifactId: 'opencv-zoo-sface-2021dec',
            version: '2021dec',
            fileName: 'face_recognition_sface_2021dec.onnx',
            sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
            sourceUrl: 'https://huggingface.co/opencv/face_recognition_sface/resolve/89e1f6f89ab68a12ab974b5b65162abf464a461f/face_recognition_sface_2021dec.onnx',
            license: 'Apache-2.0',
            licenseUrl: 'https://huggingface.co/opencv/face_recognition_sface/blob/89e1f6f89ab68a12ab974b5b65162abf464a461f/LICENSE',
        })
    })
})
