'use strict'

export type ImageSourceRequest = {
    url: string
    credentials?: RequestCredentials
    headers?: Record<string, string>
}

export type ImageDecodeRequest =
    | { kind: 'decode'; requestId: string; source: ImageSourceRequest }
    | { kind: 'cancel'; requestId: string }

export type ImageDecodeResponse =
    | { requestId: string; bitmap: ImageBitmap }
    | { requestId: string; error: string }
