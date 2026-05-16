'use strict'

import * as process from 'process'

const env = process.env

export const LLM_TIMEOUT_MS = Number(env.LLM_TIMEOUT_SECONDS ?? 1200) * 1000
