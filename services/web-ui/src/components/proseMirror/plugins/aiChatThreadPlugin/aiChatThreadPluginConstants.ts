// @ts-nocheck
import { PluginKey } from 'prosemirror-state'

// Shared PluginKey to avoid identity mismatches and circular imports
export const AI_CHAT_THREAD_PLUGIN_KEY = new PluginKey('aiChatThread')

// Transaction meta keys for AI chat thread actions
export const USE_AI_CHAT_META = 'use:aiChat'
export const STOP_AI_CHAT_META = 'stop:aiChat'
