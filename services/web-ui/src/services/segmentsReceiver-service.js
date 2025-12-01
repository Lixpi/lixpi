'use strict'

class SegmentsReceiver {
    static instance

    static getInstance() {
        if (!SegmentsReceiver.instance) {
            new SegmentsReceiver()
        }
        return SegmentsReceiver.instance
    }

    constructor() {
        if (SegmentsReceiver.instance) {
            return SegmentsReceiver.instance
        }

        this.eceiveSegmentListeners = []

        // Ensure the instance is available statically
        SegmentsReceiver.instance = this
    }

    // Allow components to subscribe to token completion
    subscribeToeceiveSegment(listener) {
        this.eceiveSegmentListeners.push(listener)
        return () => this.unsubscribeToTokenParse(listener)
    }

    // Allow components to unsubscribe from token completion
    unsubscribeToTokenParse(listener) {
        this.eceiveSegmentListeners = this.eceiveSegmentListeners.filter(l => l !== listener)
    }

    // Internal method to notify all token complete listeners
    notifyReceiveSegment(token) {
        this.eceiveSegmentListeners.forEach(listener => listener(token))
    }

    // Parse individual chunk token
    receiveSegment(chunk) {
        this.notifyReceiveSegment(chunk) // Relay the parsed segment event
    }
}


// Ensure that SegmentsReceiver.getInstance() is now the only way to get an instance of the parser
const markdownStreamParserInstance = SegmentsReceiver.getInstance()

export default markdownStreamParserInstance
