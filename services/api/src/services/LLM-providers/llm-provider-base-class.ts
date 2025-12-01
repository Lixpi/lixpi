'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

// Types for circuit breaker configuration
export type CircuitBreakerTrigger = {
    name: string
    shouldTrigger: (context: CircuitBreakerContext) => boolean
    getErrorMessage: (context: CircuitBreakerContext) => string
}

export type CircuitBreakerContext = {
    elapsed: number
    [key: string]: any
}

export type CircuitBreakerResult = {
    shouldBreak: boolean
    reason?: string
    context?: CircuitBreakerContext
}

class LlmProviderBaseClass {
    interruptStream: boolean
    contentListeners: any[]
    markdownStreamParser: any
    markdownStreamParserUnsubscribe: any

    constructor() {
        this.interruptStream = false
        this.contentListeners = []
    }

    // Terminate the markdown parser and optionally emit a final message.
    // Flushes buffered content, resets parser state, emits optional message, and stops parsing.
    terminateParser(message?: string) {
        if (!this.markdownStreamParser || typeof this.markdownStreamParser.parseToken !== 'function') {
            return
        }

        // First, flush any buffered content to ensure it's emitted before the message
        if (this.markdownStreamParser.tokensStreamProcessor && typeof this.markdownStreamParser.tokensStreamProcessor.flushBuffer === 'function') {
            this.markdownStreamParser.tokensStreamProcessor.flushBuffer()
        }

        // Force exit from current block context by manipulating the parser's state
        if (this.markdownStreamParser.markdownStreamParser) {
            const stateMachine = this.markdownStreamParser.markdownStreamParser

            // Reset the parser state to routing (exit any current block)
            if (typeof stateMachine.resetParser === 'function') {
                stateMachine.resetParser()
            }

            // Force the context to indicate we're starting a new line/block
            if (stateMachine.context) {
                stateMachine.context.isProcessingNewLine = true
                stateMachine.context.blockContentBuffer = ''
            }

            // Reset both block and inline element states to routing
            if (stateMachine.transitionBlockElementState && stateMachine.transitionInlineElementState) {
                stateMachine.transitionBlockElementState('routing')
                stateMachine.transitionInlineElementState('routing')
            }
        }

        // Feed the optional message to the parser to naturally generate segments
        if (message) {
            this.markdownStreamParser.parseToken(message)
        }

        // Stop parsing - this will flush remaining content and emit END_STREAM
        if (typeof this.markdownStreamParser.stopParsing === 'function') {
            this.markdownStreamParser.stopParsing()
        }
    }

    // General purpose circuit breaker for stream processing.
    // NOTE: No built-in triggers. All triggers must be created by the caller and passed in.
    // If an empty array is provided, the circuit breaker will never trigger.
    createCircuitBreaker({ triggers = [] }: { triggers?: CircuitBreakerTrigger[] }) {
        const startTime = Date.now()

        const emitCircuitBreakerError = (_reason: string, errorMessage: string) => {
            this.terminateParser(errorMessage)
        }

        return {
            checkLimits: (additionalContext: Record<string, any> = {}): CircuitBreakerResult => {
                const currentTime = Date.now()
                const elapsed = currentTime - startTime

                // Build context for triggers
                const context: CircuitBreakerContext = {
                    elapsed,
                    ...additionalContext
                }

                // Check each trigger
                for (const trigger of triggers) {
                    if (trigger.shouldTrigger(context)) {
                        const errorMessage = trigger.getErrorMessage(context)
                        err(`LLM_CIRCUIT_BREAK: ${trigger.name} triggered`)
                        emitCircuitBreakerError(trigger.name, errorMessage)
                        return {
                            shouldBreak: true,
                            reason: trigger.name,
                            context
                        }
                    }
                }

                return { shouldBreak: false, context }
            }
        }
    }

    // Allow to subscribe to token receive, returns an unsubscribe function
    subscribeToTokenReceive(listener: any) {
        const wrappedListener = (data: any) => {
            listener(data, unsubscribe)
        }

        const unsubscribe = () => {
            // Remove the listener
            this.contentListeners = this.contentListeners.filter(l => l !== wrappedListener)

            infoStr([
                chalk.blue('AiStreamParser -> '),
                'LlmProviderBaseClass::',
                chalk.red('unsubscribe'),
                '::this.contentListeners.length: ',
                chalk.white(this.contentListeners.length.toString())
            ])
        }

        this.contentListeners.push(wrappedListener)
        return unsubscribe
    }

    notifyTokenReceive(data: any) {
        this.contentListeners.forEach(listener => listener(data))
    }

    cleanup() {
        this.contentListeners = []
    }

    setInterruptStream() {
        this.interruptStream = true
    }

    // Stop the active stream gracefully.
    // Sets the interrupt flag which will cause the streaming loop to stop.
    // The streaming loop will detect the interrupt flag and call stopParsing() to finalize the stream.
    // This method should be called when the user manually stops the AI generation.
    stopStream() {
        infoStr([
            chalk.blue('LlmProviderBaseClass -> '),
            chalk.red('stopStream'),
            ' :: Setting interrupt flag'
        ])

        // Set interrupt flag to stop the streaming loop
        this.interruptStream = true

        // Note: We don't call terminateParser() here - the streaming loop will detect
        // the interrupt flag and handle termination properly to avoid race conditions
    }
}

export default LlmProviderBaseClass
