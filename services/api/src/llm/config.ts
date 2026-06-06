'use strict'

import * as process from 'process'

const env = process.env

export const LLM_TIMEOUT_MS = Number(env.LLM_TIMEOUT_SECONDS ?? 1200) * 1000

// How often the VEO submit+poll loop wakes to call operations.getVideosOperation
// and publishes a VIDEO_GENERATING keepalive ping so the browser does not look
// frozen during a multi-minute generation.
export const VEO_POLL_INTERVAL_MS = Number(env.VEO_POLL_INTERVAL_MS ?? 10000)

// BytePlus ModelArk (Seedance) runtime base URL. International route by default;
// override for China/Volcengine Ark (doubao-* model ids) or a proxy.
export const BYTEPLUS_ARK_BASE_URL = env.BYTEPLUS_ARK_BASE_URL ?? 'https://ark.ap-southeast.bytepluses.com/api/v3'

// How often the Seedance create+poll loop wakes to GET the task and publish a
// VIDEO_GENERATING keepalive. Falls back to the VEO interval (10s) so the two
// video providers behave consistently unless tuned independently.
export const BYTEPLUS_VIDEO_POLL_INTERVAL_MS = Number(env.BYTEPLUS_VIDEO_POLL_INTERVAL_MS ?? env.VEO_POLL_INTERVAL_MS ?? 10000)
