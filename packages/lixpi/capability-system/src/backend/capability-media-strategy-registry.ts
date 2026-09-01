import {
    type CapabilityMediaExecutionPlan,
} from '../shared/capability-media-execution-plan.ts'

import {
    type CapabilityMediaStrategy,
} from './capability-media-strategy.ts'

export class CapabilityMediaStrategyRegistry {
    private readonly strategies = new Map<string, CapabilityMediaStrategy>()

    register(strategy: CapabilityMediaStrategy): void {
        if (this.strategies.has(strategy.kind)) {
            throw new Error(`CAPABILITY_MEDIA_STRATEGY_DUPLICATE:${strategy.kind}`)
        }
        this.strategies.set(strategy.kind, strategy)
    }

    get(plan: CapabilityMediaExecutionPlan): CapabilityMediaStrategy {
        const strategy = this.strategies.get(plan.kind)
        if (!strategy) throw new Error(`CAPABILITY_MEDIA_STRATEGY_NOT_REGISTERED:${plan.kind}`)
        return strategy
    }
}
