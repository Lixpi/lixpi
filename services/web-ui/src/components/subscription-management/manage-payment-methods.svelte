<script lang="ts">
    import {
        onMount,
    } from 'svelte'
    import { fade } from 'svelte/transition'

    import { Button } from "$lib/registry/ui/button/index.ts"
    import { Label } from "$lib/registry/ui/label/index.ts";
    import { Input } from "$lib/registry/ui/input/index.ts"
    import * as Table from "$lib/registry/ui/table/index.js";

    import WalletCardsIcon from "@lucide/svelte/icons/wallet-cards"
    import CreditCardIcon from "@lucide/svelte/icons/credit-card";
    import TrashIcon from "@lucide/svelte/icons/trash-2";
    import DotIcon from "@lucide/svelte/icons/dot";
    import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
    import PlusIcon from "@lucide/svelte/icons/plus";

    import AddOrEditPaymentMethod from '$src/components/subscription-management/add-or-edit-payment-method.svelte'

    import SubscriptionService from '$src/services/subscription-service.ts'

    import { subscriptionStore } from '$src/stores/subscriptionStore.ts'

    const currentDialogTitle = 'Manage payment methods'
    const currentDialogDescription = 'Here you can manage your saved payment methods or add a new one.'


    const subscriptionService: SubscriptionService = new SubscriptionService()

    let showAddNewCard: boolean = $state(false)



    Number.prototype.zeroPad = function() {
      return ('0'+this).slice(-2);
    };

    onMount(async () => {
        subscriptionService.getCustomerPaymentMethods()

    });

    $effect(() => {
        subscriptionStore.setUiValues({ dialogTitle: currentDialogTitle, dialogDescription: currentDialogDescription })
    });
</script>


<div class="relative min-h-20">

    {#if $subscriptionStore.data.paymentMethods?.length > 0 && !showAddNewCard}
        <!-- <h4>Saved credit cards</h4> -->
        <Table.Root>
            <Table.Caption>Saved credit cards</Table.Caption>
            <Table.Header>
                <Table.Row>
                    <Table.Head class="w-[100px]">Type</Table.Head>
                    <Table.Head>Card</Table.Head>
                    <Table.Head>Exp</Table.Head>
                    <Table.Head></Table.Head>
                    <Table.Head class="text-right"></Table.Head>
                </Table.Row>
            </Table.Header>
            <Table.Body>
                {#each $subscriptionStore.data.paymentMethods as paymentMethod}
                <Table.Row>
                    <Table.Cell class="capitalize flex items-center"><CreditCardIcon class="mr-2" /> {paymentMethod.card.brand}</Table.Cell>
                    <!-- <Table.Cell>{paymentMethod.id}</Table.Cell> -->
                    <Table.Cell class="font-medium">
                        <div class="flex items-center">
                            <EllipsisIcon class="mr-0" />
                            <span class="font-medium">{paymentMethod.card.last4}</span>
                        </div>
                    </Table.Cell>
                    <Table.Cell class="font-medium">{parseInt(paymentMethod.card.expMonth).zeroPad()} / {paymentMethod.card.expYear}</Table.Cell>
                    <Table.Cell>{paymentMethod.card.isDefaultPaymentMethod ? 'Default' : ''}</Table.Cell>
                    <Table.Cell class="text-right">
                        <Button
                            onclick={() => subscriptionService.deletePaymentMethod({ paymentMethodId: paymentMethod.id })}
                            variant="icon"
                            size="sm"
                            class="hover:text-red-500" >
                            <TrashIcon/>
                        </Button>
                    </Table.Cell>
                </Table.Row>
                {/each}
            </Table.Body>
        </Table.Root>
    {/if}

    {#if showAddNewCard || $subscriptionStore.data.paymentMethods?.length === 0}
        <AddOrEditPaymentMethod
            onCancel={() => showAddNewCard = false}
        />
    {/if}

    {#if !showAddNewCard && $subscriptionStore.data.paymentMethods?.length > 0}
        <Button variant="outline" size="sm" class="" onclick={() => showAddNewCard = !showAddNewCard}><PlusIcon />Add New</Button>
    {/if}

</div>