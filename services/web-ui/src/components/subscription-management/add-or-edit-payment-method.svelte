<script lang="ts">
    import {
        onMount,
    } from 'svelte'
    import { fade } from 'svelte/transition'

    import { Button } from "$lib/registry/ui/button/index.ts"
    import SubscriptionService from '$src/services/subscription-service.ts'

    import WalletCardsIcon from "@lucide/svelte/icons/wallet-cards"

    import { subscriptionStore } from '$src/stores/subscriptionStore.ts'

    import Spinner from `$src/components/spinner.svelte`


    type Props = {
		onCancel: Function,
	}

	let {
		onCancel,
	}: Props = $props()

    const VITE_STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY as string;
    const VITE_AUTH0_REDIRECT_URI = import.meta.env.VITE_AUTH0_REDIRECT_URI as string;

    const currentDialogTitle = 'Add new card'
    const currentDialogDescription = 'Here you can add new payment method that will be used for buying credits.'


    let stripe: stripe.Stripe = Stripe(VITE_STRIPE_PUBLIC_KEY);
    let elements: stripe.elements.Elements | null = null;
    let processing: boolean = $state(false)
    let stripePaymentElement = $state(null)

    let subscriptionService: SubscriptionService = new SubscriptionService()


    Number.prototype.zeroPad = function() {
      return ('0'+this).slice(-2);
    };

    onMount(async () => {
        // subscriptionService = new SubscriptionService()

        // stripe = Stripe(VITE_STRIPE_PUBLIC_KEY);

        subscriptionService.getPaymentMethodSetupIntent()

    });

    $effect(() => {
        subscriptionStore.setUiValues({ dialogTitle: currentDialogTitle, dialogDescription: currentDialogDescription })
    })

    // TODO:
        // https://docs.stripe.com/js/elements_object/create_payment_element
        // https://docs.stripe.com/payments/accept-a-payment?platform=web&client=js


    $effect(() => {
        if (!$subscriptionStore.data.paymentMethodSetupIntentSecret || !stripePaymentElement) return;

        elements = stripe.elements({
            appearance: {

                theme: 'stripe',
                // labels: 'floating',
            },
            clientSecret: $subscriptionStore.data.paymentMethodSetupIntentSecret
        });

        const paymentElementOptions: stripe.elements.PaymentElementOptions = {
            layout: {
                type: 'tabs',
                defaultCollapsed: false,
                radios: false,
                spacedAccordionItems: true
            },
            business: {
                name: 'Lixpi'
            },
            classes: {
                base: 'lixpi-stripe-base',
                complete: 'lixpi-stripe-complete',
                empty: 'lixpi-stripe-empty',
                focus: 'lixpi-stripe-focus',
                invalid: 'lixpi-stripe-invalid',
                webkitAutofill: 'lixpi-stripe-webkit-autofill',
            },

            wallets: {
                applePay: 'never',
                googlePay: 'never'
            }
        };

        const paymentElement = elements.create("payment", paymentElementOptions);
        paymentElement.mount("#payment-element");
    });

    async function onSubmitHandler(e) {

        console.log('onSubmitHandler', e)
        e.preventDefault()
        if (processing) return
        processing = true

        try {
            const { error: setupError, setupIntent } = await stripe.confirmSetup({
                elements,
                confirmParams: {
                    return_url: VITE_AUTH0_REDIRECT_URI,
                    payment_method_data: {
                        billing_details: {
                            // name: cardholderName,
                        },
                    },
                },
                redirect: 'if_required',
            })

            if (setupError) {
                error = setupError
                console.error('Setup error:', setupError)
            } else {
                console.log('Setup succeeded:', setupIntent)
                // Handle successful setup (e.g., show success message, navigate to a new page)
                subscriptionService.getCustomerPaymentMethods()
            }
        } catch (err) {
            error = err
            console.error('Unexpected error:', err)
        } finally {
            processing = false
        }
    }

</script>


{#if (processing || $subscriptionStore.meta.isLoading)}
    <Spinner withOverlay />
{/if}

<form id="payment-method-form" onsubmit={onSubmitHandler}>
    {#if !$subscriptionStore.meta.isLoading}
        <div id="payment-element" bind:this={stripePaymentElement} />    <!-- Stripe.js injects the Payment Element -->

        <div class="flex justify-end w-full" in:fade|global="{{ duration: 500 }}">
            <Button
                onclick={onCancel}
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
                <WalletCardsIcon /> Add Card
            </Button>
        </div>
    {/if}
</form>

