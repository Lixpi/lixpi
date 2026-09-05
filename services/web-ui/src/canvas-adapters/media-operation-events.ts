import {
    type WorkspaceMediaOperationRecoveryPorts,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { servicesStore } from '$src/stores/servicesStore.ts'

export const subscribeCanvasMediaOperation: WorkspaceMediaOperationRecoveryPorts['subscribe'] = (
    subject,
    receive,
) => {
    const subscription = servicesStore.getData('nats')?.subscribe(subject, receive)

    if (!subscription)
        throw new Error('Canvas media recovery requires an active NATS connection')

    return () => subscription.unsubscribe()
}
