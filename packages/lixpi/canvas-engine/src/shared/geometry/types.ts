'use strict'

export type CanvasEnginePoint = {
    x: number
    y: number
}

export type CanvasEngineSize = {
    width: number
    height: number
}

export type CanvasEngineRect = CanvasEnginePoint & CanvasEngineSize
