'use strict'

import * as process from 'process'

const env = process.env

export const LLM_TIMEOUT_MS = Number(env.LLM_TIMEOUT_SECONDS ?? 1200) * 1000

// How often the VEO submit+poll loop wakes to call operations.getVideosOperation
// and publishes a VIDEO_GENERATING keepalive ping so the browser does not look
// frozen during a multi-minute generation.
export const VEO_POLL_INTERVAL_MS = Number(env.VEO_POLL_INTERVAL_MS ?? 10000)
