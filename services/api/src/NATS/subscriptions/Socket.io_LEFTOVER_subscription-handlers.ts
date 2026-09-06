import chalk from 'chalk'
import {
    log,
    infoStr,
} from '@lixpi/debug-tools'

import SocketIoConnectionsManager from '../socket.io-connections-manager.ts'

import {
    USER_SUBSCRIPTION_SUBJECTS,
    PaymentProcessingStatus,
    type SocketIoResponse,
} from '@lixpi/constants'

export const notifyClientOfBalanceTopUp = async data => {
    log('notifyClientOfBalanceTopUp', data)

    const socketIoConnectionsManager = SocketIoConnectionsManager.getInstance({})

    const {
        userId,
        balance,
        netBalance,
    } = data

    socketIoConnectionsManager.emit({
        room: `session-${userId}`,
        event: USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE_RESPONSE,
        data: {
            meta: {
                paymentProcessingStatus: PaymentProcessingStatus.success,
            },
            data: {
                balance,
                netBalance,
            },
        } as SocketIoResponse,
    })

    infoStr([
        chalk.green('Socket.IO -> '),
        chalk.green(USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE_RESPONSE),
        ', ',
        chalk.grey('userId::'),
        userId,
    ])
}

export const notifyClientOfCreditsUse = async data => {
    log('notifyClientOfCreditsUse', data)

    const socketIoConnectionsManager = SocketIoConnectionsManager.getInstance({})

    const {
        userId,
        balance,
        netBalance,
    } = data

    // console.log('data USER_SUBJECTS.GET_USER_RESPONSE', data)

    socketIoConnectionsManager.emit({
        room: `session-${userId}`,
        event: USER_SUBSCRIPTION_SUBJECTS.USE_CREDITS_RESPONSE,
        data: {
            meta: {
                // paymentProcessingStatus: PaymentProcessingStatus.success
            },
            data: {
                balance,
                netBalance,
            },
        } as SocketIoResponse,
    })

    infoStr([
        chalk.green('Socket.IO -> '),
        chalk.green(USER_SUBSCRIPTION_SUBJECTS.USE_CREDITS_RESPONSE),
        ', ',
        chalk.grey('userId::'),
        userId,
    ])
}
