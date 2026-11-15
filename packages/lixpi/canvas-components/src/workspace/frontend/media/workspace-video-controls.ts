import {
    PlaybackControls,
    type PlaybackControlsOptions,
} from '@lixpi/canvas-components/media'
import {
    type VideoCanvasNode,
    type AudioCanvasNode,
} from '@lixpi/constants'

export type { PlaybackControlsSettings as WorkspaceVideoControlsSettings } from '@lixpi/canvas-components/media'
export type WorkspaceVideoControlsOptions = PlaybackControlsOptions<VideoCanvasNode | AudioCanvasNode>

// Workspace nodes provide Asset identity; the reusable player owns all controls and gestures.
export class WorkspaceVideoControls extends PlaybackControls<VideoCanvasNode | AudioCanvasNode> {}
