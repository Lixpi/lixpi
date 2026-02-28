<script lang="ts">
    import {
        onMount,
    } from 'svelte'
    import { fade } from 'svelte/transition'

    import {
        LoadingStatus,
        PaymentProcessingStatus
    } from '@lixpi/constants'

    import { Button } from '$lib/registry/ui/button/index.ts'
    import { Label } from '$lib/registry/ui/label/index.ts'
    import { Input } from '$lib/registry/ui/input/index.ts'
    import * as Table from '$lib/registry/ui/table/index.js'
    import { Separator } from '$lib/registry/ui/separator/index.js'
    import * as Alert from '$lib/registry/ui/alert/index.js'

    import { STRIPE_COMISSION } from '@lixpi/constants'

    import WalletCardsIcon from '@lucide/svelte/icons/wallet-cards'
    import CreditCardIcon from '@lucide/svelte/icons/credit-card'
    import TrashIcon from '@lucide/svelte/icons/trash-2'
    import DotIcon from '@lucide/svelte/icons/dot'
    import EllipsisIcon from '@lucide/svelte/icons/ellipsis'
    import PencilIcon from '@lucide/svelte/icons/pencil'
    import IconCheck from '@lucide/svelte/icons/check'

    import AddOrEditPaymentMethod from '$src/components/subscription-management/add-or-edit-payment-method.svelte'
    import ManagePaymentMethods from '$src/components/subscription-management/manage-payment-methods.svelte'

    import SubscriptionService from '$src/services/subscription-service.ts'

    import { subscriptionStore } from '$src/stores/subscriptionStore.ts'
    // import { userStore } from '$src/stores/userStore.ts'

    import Spinner from '$src/components/spinner.svelte'

    type Props = {
        // updateParentDialogTitle: Function
    }

    let {
        // updateParentDialogTitle
    }: Props = $props()


    const currentDialogTitle = 'Add funds'
    const currentDialogDescription = 'Here you can add credits to your account.'


    const subscriptionService: SubscriptionService = new SubscriptionService()

    let showAddNewCard: boolean = $state(false)
    let showListPaymentMethods: boolean = $state(false)
    let showSpinner: boolean = $state(false)
    let currentPaymentMethod: any = $state(null)
    let topUpInputValue: number = $state(10)
    let estimatedTaxes: number = $state(0)
    let totalAmountToBeCharged: number = $state(0)

    $effect(() => {
        showSpinner = $subscriptionStore.meta.isLoading || $subscriptionStore.meta.paymentProcessingStatus === PaymentProcessingStatus.processing
        console.log('$subscriptionStore.data', $subscriptionStore.data)

        if (Array.isArray($subscriptionStore.data?.paymentMethods)) {
            currentPaymentMethod = $subscriptionStore.data?.paymentMethods?.find(paymentMethod => paymentMethod.card.isDefaultPaymentMethod)
        } else {
            // TODO: dev only, remove before going live!!!!!!!!!!!
            console.log('$subscriptionStore.data?.paymentMethods', $subscriptionStore.data?.paymentMethods)
            alert(`No payment methods found \n\n${JSON.stringify($subscriptionStore.data?.paymentMethods)}`)
        }
    })

    const calculateStripeCommission = (amount: number): number => (amount * parseFloat(STRIPE_COMISSION.comissionPercentRate)) + parseFloat(STRIPE_COMISSION.fixedFee)

    const roundToTwoDecimals = (number: number): number => Math.round((number + Number.EPSILON) * 100) / 100

    $effect(() => {
        estimatedTaxes = calculateStripeCommission(topUpInputValue)
        totalAmountToBeCharged = topUpInputValue + estimatedTaxes
    })

    $effect(() => {
        // subscriptionStore.setUiValues({
        //     dialogTitle: currentDialogTitle,
        //     dialogDescription: currentDialogDescription
        // })
    })

    Number.prototype.zeroPad = function() {
        return ('0'+this).slice(-2)
    }

    onMount(async () => {
        subscriptionService.getCustomerPaymentMethods()
    })

    // async topUpUserBalance({ userId, stripeCustomerId, amount, origin = 'undefined' }) {
    const handleTopUpBalanceSubmit = async (e: Event) => {
        e.preventDefault()
        subscriptionStore.setMetaValues({ paymentProcessingStatus: PaymentProcessingStatus.processing })
        subscriptionStore.setUiValues({
            dialogTitle: 'Add funds',
            dialogDescription: 'Processing your payment...',
            hasError: false
        })
        await subscriptionService.topUpCustomerBalance({
            amount: topUpInputValue,
        })
    }
</script>

<Separator class="mb-2" />

<div class="relative min-h-20">

    {#if showSpinner}
        <Spinner withOverlay extendOverlayBeyondParentContentBox={15} />
    {/if}


    {#if $subscriptionStore.meta.paymentProcessingStatus === PaymentProcessingStatus.success}
        <h3 class="croll-m-20 text-2xl">Your payment has been processed!</h3>
        <div class="flex justify-end">
            <Button
                onclick={() => subscriptionStore.setMetaValues({ isPaymentDialogOpen: false })}
                variant="default"
                type="button"
                class="mt-5 mr-3">
                Close
            </Button>
        </div>
    {/if}

    {#if !showListPaymentMethods && $subscriptionStore.meta.paymentProcessingStatus === PaymentProcessingStatus.idle}
        <form id="top-up-balance-form" onsubmit={handleTopUpBalanceSubmit}>
            <div class="grid w-full max-w-sm items-center gap-1.5">
                <Label for="email-2">Credits to purchase</Label>
                <span class="relative">
                    <Input
                        type="number"
                        id="email-2"
                        class="w-full max-w-44 pl-[18px]"
                        placeholder=""
                        min=5
                        max=100
                        bind:value={topUpInputValue}
                    />
                    <span class="absolute inset-y-0 left-2 flex items-center pr-3 text-sm">$</span>
                </span>
                <p class="text-muted-foreground text-sm">Enter an amount between $5 and $100</p>
            </div>


            <Separator class="mt-3 mb-5" />

            <div class="mb-5">
                <div class="flex justify-between">
                    <span>Subtotal</span>
                    <span>${topUpInputValue}</span>
                </div>
                <div class="flex justify-between">
                    <span>Estimated taxes</span>
                    <span>${roundToTwoDecimals(estimatedTaxes)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="font-medium">Total</span>
                    <span class="font-medium">${roundToTwoDecimals(totalAmountToBeCharged)}</span>
                </div>
            </div>

            <div class="flex justify-between items-center  mt-5">
                <Label for="current-payment-method" class="">Charged to</Label>
                <div class="flex items-center capitalize select-none" id="current-payment-method">
                    <CreditCardIcon class="mr-2" /> {currentPaymentMethod?.card.brand}
                    <EllipsisIcon class="mr-0" />
                    {currentPaymentMethod?.card.last4}
                    <Button
                        variant="icon"
                        onclick={() => showListPaymentMethods = true}
                        class="font-medium hover:text-primary pr-0"
                    >
                        Change
                    </Button>
                </div>
            </div>

            <div class="flex justify-end">
                <Button
                    onclick={() => subscriptionStore.setMetaValues({ isPaymentDialogOpen: false })}
                    variant="outline"
                    type="button"
                    class="mt-5 mr-3">
                    Cancel
                </Button>
                <Button
                    id="submit"
                    variant="default"
                    type="submit"
                    class="mt-5">
                    <IconCheck /> Pay
                </Button>
            </div>

        </form>

    {/if}


    {#if showAddNewCard || !$subscriptionStore.data.paymentMethods.length === 0}
        <AddOrEditPaymentMethod
            onCancel={() => showAddNewCard = false}
        />
    {/if}

    {#if showListPaymentMethods}
        <ManagePaymentMethods />
    {/if}

</div>
