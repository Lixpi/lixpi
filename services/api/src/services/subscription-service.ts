'use strict'

import chalk from 'chalk'
import LambdaService from '@lixpi/lambda-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import { NATS_SUBJECTS, AuthenticationStatus } from '@lixpi/constants'

import User from '../models/user.ts'

const lambdaService = new LambdaService({
    region: process.env.AWS_REGION,
    ssoProfile: process.env.AWS_PROFILE
})

const { BILLING_HANDLER_LAMBDA_TARGETS } = NATS_SUBJECTS

const logStats = ({ operation, userId, origin }) => {
    const logOrigin = `Subscription -> ${operation}`
    infoStr([
        chalk.white(logOrigin),
        ' (User: ',
        userId,
        '), origin: ',
        origin
    ])
}

class SubscriptionService {
    constructor() {}

    async checkUserBalance({ userId }) {
        const user = await User.get(userId)

        if (!user) return AuthenticationStatus.userNotFound
        if (!user.hasActiveSubscription) return AuthenticationStatus.noActiveSubscription    // On every request verify that user has active subscription

        return AuthenticationStatus.success
    }

    async getPaymentMethods({ userId, stripeCustomerId, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods')
        // const customerPaymentMethods = await lambdaService.invokeFunction({
        //     functionName: ssmParams.StripeBillingHandlerLambda,
        //     payload: {
        //         target: BILLING_HANDLER_LAMBDA_TARGETS.GET_CUSTOMER_PAYMENT_METHODS,
        //         userId,
        //         stripeCustomerId
        //     },
        //     origin
        // })

        // info('getUserPaymentMethods', customerPaymentMethods)

        // return customerPaymentMethods
    }

    async deletePaymentMethod({ userId, stripeCustomerId, paymentMethodId, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods deletePaymentMethod')
        // const deletePaymentMethodResponse = await lambdaService.invokeFunction({
        //     functionName: ssmParams.StripeBillingHandlerLambda,
        //     payload: {
        //         target: BILLING_HANDLER_LAMBDA_TARGETS.DELETE_CUSTOMER_PAYMENT_METHOD,
        //         // userId,
        //         stripeCustomerId,
        //         paymentMethodId
        //     },
        //     origin
        // })

        // logStats({ operation: 'deletePaymentMethod', userId, origin: 'SubscriptionService' })

        // return deletePaymentMethodResponse
    }

    async topUpUserBalance({ userId, stripeCustomerId, amount, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods topUpUserBalance')
        // const topUpResponse = await lambdaService.invokeFunction({
        //     functionName: ssmParams.StripeBillingHandlerLambda,
        //     payload: {
        //         target: BILLING_HANDLER_LAMBDA_TARGETS.TOP_UP_CUSTOMER_BALANCE,
        //         userId,
        //         stripeCustomerId,
        //         amount
        //     },
        //     origin
        // })

        // logStats({ operation: 'topUpUserBalance', userId, amount, origin: 'SubscriptionService' })

        // return topUpResponse
    }
}

export default SubscriptionService
