<script lang="ts">

    import { setContext, getContext, onMount, onDestroy } from 'svelte'
    import { fade } from 'svelte/transition'

    import { PaymentProcessingStatus } from '@lixpi/constants'

    import { createNavigationSidePanel } from '$src/components/navigationSidePanel/index.ts'
    import '$src/components/navigationSidePanel/navigation-side-panel.scss'
    import IntroPage from '$src/components/intro-page.svelte'
    import WorkspaceCanvas from '$src/components/WorkspaceCanvas.svelte'
    // import PaymentDetails from '$src/components/subscription-management/payment-details.svelte'    // Rendered by the commented-out add-funds dialog below

    import AuthService from '$src/services/auth-service'
    import { authStore } from '$src/stores/authStore.ts'
    import { routerStore } from '$src/stores/routerStore.ts'
    import { userStore } from '$src/stores/userStore.ts'
    import { subscriptionStore } from '$src/stores/subscriptionStore.ts'
    import { userInfoPanelStore } from '$src/stores/navigationSidePanelStore.ts'
    import { settings } from '$src/settings.ts'


    // import UserMenu from '$src/components/user-menu.svelte'
    // import Spinner from '$src/components/spinner.svelte'


    // shadcn-svelte has been removed from the project. The user drawer, add-funds dialog
    // and theme switcher below depended on it and are commented out pending a rewrite
    // on top of @lixpi/ui-kit.
    // import { toast } from "svelte-sonner"
    // import { Toaster } from '$lib/registry/ui/sonner/index.js'
    // import { Button } from '$lib/registry/ui/button/index.ts'
    // import * as DropdownMenu from '$lib/registry/ui/dropdown-menu/index.ts'
    // import { buttonVariants } from '$lib/registry/ui/button/index.ts'
    // import { Label } from '$lib/registry/ui/label/index.ts'
    // import * as Drawer from '$lib/registry/ui/drawer/index.ts'
    // import * as Card from '$lib/registry/ui/card/index.ts'
    // import { cn } from '$lib/utils.ts'
    // import { Input } from '$lib/registry/ui/input/index.ts'
    // import { Separator } from '$lib/registry/ui/separator/index.ts'
    // import * as Tabs from '$lib/registry/ui/tabs/index.ts'
    // import * as Dialog from '$lib/registry/ui/dialog/index.ts'
    // import LogOutIcon from '@lucide/svelte/icons/log-out'
    // import Sun from '@lucide/svelte/icons/sun'
    // import Moon from '@lucide/svelte/icons/moon'
    // import DollarSign from '@lucide/svelte/icons/dollar-sign'
    // import Search from '@lucide/svelte/icons/search'
    // import { ModeWatcher, mode, setMode, toggleMode } from 'mode-watcher'

    let {
        layout,
    } = $props()

    let navigationSidePanelPaneEl: HTMLDivElement
    let navigationSidePanel: ReturnType<typeof createNavigationSidePanel> | null = null
    let previousDefaultHoverTransitionDuration = ''

    onMount(() => {
        previousDefaultHoverTransitionDuration = document.documentElement.style.getPropertyValue('--default-hover-transition-duration')
        document.documentElement.style.setProperty('--default-hover-transition-duration', `${settings.hover.transitionDurationMs}ms`)
        navigationSidePanel = createNavigationSidePanel({ paneEl: navigationSidePanelPaneEl })
    })

    onDestroy(() => {
        navigationSidePanel?.destroy()
        if (previousDefaultHoverTransitionDuration) {
            document.documentElement.style.setProperty('--default-hover-transition-duration', previousDefaultHoverTransitionDuration)
        } else {
            document.documentElement.style.removeProperty('--default-hover-transition-duration')
        }
    })

    const triggerAddFundsDialogOpen = () => {
        userInfoPanelStore.set(false)

        subscriptionStore.setMetaValues({ isPaymentDialogOpen: true })
        subscriptionStore.setUiValues({
            dialogTitle: 'Add funds',
            dialogDescription: 'Here you can add credits to your account.'
        })
    }

</script>


<!--
<ModeWatcher />


 <Toaster /> 

<Dialog.Root
    bind:open={$subscriptionStore.meta.isPaymentDialogOpen}
    onOpenChange={(isDialogOpen: boolean) => {
        if (!isDialogOpen) {
            setTimeout(() => {
               subscriptionStore.resetStore()    // Reset store values after 300ms delay when dialog is closed
            }, 300);
        }
    }} >
     TODO: HACK: setting preventScroll={false} fixes an issue with content and all controls end events propagation being locked afeter opening modal from the drawer section. Revise later 
    <Dialog.Content class="h-auto" preventScroll={false}>
        <Dialog.Header>
            <Dialog.Title>{$subscriptionStore.ui.dialogTitle}</Dialog.Title>
            <Dialog.Description>
                <span class:text-red-600={$subscriptionStore.ui.hasError}>
                    {$subscriptionStore.ui.dialogDescription}
                </span>
            </Dialog.Description>
        </Dialog.Header>
        <PaymentDetails />
    </Dialog.Content>
</Dialog.Root>

<div class="sidebar-right-menu-wrapper">
    <Drawer.Root
        direction="right"
        bind:open={$userInfoPanelStore}
    >
        <Drawer.Content>
            <Drawer.Header>
                <div in:fade|global="{{ duration: 300 }}">
                    <Drawer.Title>{$authStore.data.user?.name}</Drawer.Title>
                    <Drawer.Description class="mt-2">
                         <span class="font-bold "><span class="">$</span>{$userStore.data.balance}</span> 
                    </Drawer.Description>

                    <Separator class="mt-5" />

                    <div class="flex flex-row items-center justify-between space-y-0 mt-4 mb-4">
                        <div class="">
                            <div class="text-2xl font-semibold"><span class="mr-[1px]">$</span>{$userStore.data.balance}</div>
                            <p class="text-muted-foreground text-xs mb-0 pb-0">Balance</p>
                        </div>
                        <Button variant="default" size="sm" class="mt-4" onclick={triggerAddFundsDialogOpen}>Add funds</Button>
                    </div>

                    <div class="space-y-1.5 mt-3">
                        <Label class="text-xs">Mode</Label>
                        <div class="grid grid-cols-3 gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() => setMode("light")}
                                class={cn($mode === "light" && "border-primary border-2")}
                            >
                                <Sun class="mr-1 -translate-x-1" />
                                Light
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() => setMode("dark")}
                                class={cn($mode === "dark" && "border-primary border-2")}
                            >
                                <Moon class="mr-1 -translate-x-1" />
                                Dark
                            </Button>
                        </div>
                    </div>
                </div>
            </Drawer.Header>
            <Drawer.Footer>
                <Button onclick = {() => AuthService.logout()}><LogOutIcon /> Logout</Button>
                <Drawer.Close>Close</Drawer.Close>
            </Drawer.Footer>
        </Drawer.Content>
    </Drawer.Root>
</div>
-->



<div class="navigation-side-panel-pane" bind:this={navigationSidePanelPaneEl}></div>

<div class="workspace-main-pane">
    <div class="workspace-main-content">
        {#if $routerStore.data.currentRoute.path === '/workspace/:workspaceId'}
            <WorkspaceCanvas />
        {:else}
            <IntroPage />
        {/if}
    </div>
</div>

<style global lang="scss">
    @import '$src/sass/styles.scss';

    .sidebar-right-menu-wrapper {
        position: absolute;
        z-index: 60;
        top: .5rem;
        right: .5rem;
    }

    // Replaces the Tailwind `h-full` utilities that used to size these panes
    .workspace-main-pane {
        height: 100%;
    }

    .workspace-main-content {
        width: 100%;
        height: 100%;
    }

    // Belonged to the shadcn-svelte/vaul drawer that was removed
    // :global([data-vaul-drawer]) {
    //     height: 100%;
    //     width: 300px;
    //     left: auto;
    // }
</style>
