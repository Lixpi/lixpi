<script lang="ts">

    import { setContext, getContext } from 'svelte'
    import { fade } from 'svelte/transition'

    import { PaymentProcessingStatus } from '@lixpi/constants'

    // import Sidebar from '$src/components/sidebar/Sidebar.svelte'
    import Sidebar2 from '$src/components/sidebar/Sidebar2.svelte'
    import IntroPage from '$src/components/intro-page.svelte'
    import WorkspaceCanvas from '$src/components/WorkspaceCanvas.svelte'
    import ProjectDetails from '$src/components/project-details/project-details.svelte'
    import PaymentDetails from '$src/components/subscription-management/payment-details.svelte'

    import AuthService from '$src/services/auth-service'
    import { authStore } from '$src/stores/authStore.ts'
    import { routerStore } from '$src/stores/routerStore.ts'
    import { userStore } from '$src/stores/userStore.ts'
    import { subscriptionStore } from '$src/stores/subscriptionStore.ts'


    // import UserMenu from '$src/components/user-menu.svelte'
    import UserAvatar from '$src/components/user-avatar.svelte'
    // import Spinner from '$src/components/spinner.svelte'


    // import { toast } from "svelte-sonner";
    // import { Toaster } from '$lib/registry/new-york/ui/sonner/index.js'
    import { Button } from '$lib/registry/new-york/ui/button/index.ts'
	import * as DropdownMenu from '$lib/registry/new-york/ui/dropdown-menu/index.ts'
    import { buttonVariants } from '$lib/registry/new-york/ui/button/index.ts'
    import { Label } from '$lib/registry/new-york/ui/label/index.ts'
    import * as Drawer from '$lib/registry/new-york/ui/drawer/index.ts'
    import * as Card from '$lib/registry/new-york/ui/card/index.ts'

    import EllipsisIcon from '@lucide/svelte/icons/ellipsis'
    import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open'
    import PanelRightOpen from '@lucide/svelte/icons/panel-right-open'
    import LogOutIcon from '@lucide/svelte/icons/log-out'



    import Sun from '@lucide/svelte/icons/sun'
    import Moon from '@lucide/svelte/icons/moon'
    import DollarSign from '@lucide/svelte/icons/dollar-sign'
    import { ModeWatcher, mode, setMode, toggleMode } from 'mode-watcher'



	import Search from "@lucide/svelte/icons/search";
	// import { primaryRoutes, secondaryRoutes } from "../config.js";
	// import { mailStore } from "../store.js";
	// import type { Account, Mail } from "../data.js";
	// import AccountSwitcher from "./account-switcher.svelte";
	// import MailDisplay from "./mail-display.svelte";
	// import MailList from "./mail-list.svelte";
	// import Nav from "./nav.svelte";
	import { cn } from "$lib/utils.ts";
	import { Input } from '$lib/registry/new-york/ui/input/index.ts';
	import * as Resizable from '$lib/registry/new-york/ui/resizable/index.ts';
    import { type PaneAPI } from 'paneforge';
	import { Separator } from '$lib/registry/new-york/ui/separator/index.ts';
	import * as Tabs from '$lib/registry/new-york/ui/tabs/index.ts';
	// import MailLight from '$lib/img/examples/mail-light.png?enhanced';
	// import MailDark from '$lib/img/examples/mail-dark.png?enhanced';

    import { PaneGroup, Pane, PaneResizer, type PaneAPI } from 'paneforge';

    import * as Dialog from '$lib/registry/new-york/ui/dialog/index.ts'

    let {
        layout,
    } = $props()

	// export let accounts: Account[];
	// export let mails: Mail[];
	// export let defaultCollapsed = false;
    // export let layout: number[] | undefined = undefined;
	// export let navCollapsedSize: number;

	// let isSidebarCollapsed = false;
    // let sidebarPane = null


    let sidebarPane: Resizable.Pane = $state(null!);
    let isSidebarCollapsed = $state(false);

    let isUserInfoSidePanelOpen = $state(false);

    $effect(() => {
        // console.log('userStore', $userStore.data.balance);
    })

    const triggerUserInfoSidePanel = () => {
        isUserInfoSidePanelOpen = true
    }

    const triggerAddFundsDialogOpen = () => {
        // isPaymentDialogOpen = true
        isUserInfoSidePanelOpen = false

        subscriptionStore.setMetaValues({ isPaymentDialogOpen: true })
        subscriptionStore.setUiValues({
            dialogTitle: 'Add funds',
            dialogDescription: 'Here you can add credits to your account.'
        })
    }

</script>


<ModeWatcher />


<!-- <Toaster /> -->

<Dialog.Root
    bind:open={$subscriptionStore.meta.isPaymentDialogOpen}
    onOpenChange={(isDialogOpen: boolean) => {
        if (!isDialogOpen) {
            setTimeout(() => {
               subscriptionStore.resetStore()    // Reset store values after 300ms delay when dialog is closed
            }, 300);
        }
    }} >
    <!-- TODO: HACK: setting preventScroll={false} fixes an issue with content and all controls end events propagation being locked afeter opening modal from the drawer section. Revise later -->
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

<div class="user-menu">
    <UserAvatar
        avatar={$authStore.data.user?.picture}
        name={$authStore.data.user?.given_name || 'User'}
        isLightTheme={true}
        size="25px"
        onclick={triggerUserInfoSidePanel}
    />
</div>


<div class="sidebar-right-menu-wrapper">
    <Drawer.Root
        direction="right"
        bind:open={isUserInfoSidePanelOpen}
    >
        <Drawer.Content>
            <Drawer.Header>
                <div in:fade|global="{{ duration: 300 }}">
                    <Drawer.Title>{$authStore.data.user?.name}</Drawer.Title>
                    <Drawer.Description class="mt-2">
                        <!-- <span class="font-bold "><span class="">$</span>{$userStore.data.balance}</span> -->
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



<div class="sidebar-collapse-actions absolute left-5 top-5">
    <Button variant="ghost" size="icon" class="[&_svg]:size-6" onclick={() => { isSidebarCollapsed ? sidebarPane.expand() : sidebarPane.collapse() }}>
        {#if isSidebarCollapsed}
            <PanelLeftOpen />
        {:else}
            <PanelRightOpen />
        {/if}
    </Button>
</div>




<div class="md:block h-full">
	<Resizable.PaneGroup
		direction="horizontal"
		class="h-full items-stretch"
		onLayoutChange = {(sizes: number[]) => {
            // console.log('onLayoutChange', sizes);
            document.cookie = `PaneForge:layout=${JSON.stringify(sizes)}`;
        }}
	>
		<Resizable.Pane
            class="hidden md:block"
            collapsible
			defaultSize={ layout ? layout[0] : 14 }
			collapsedSize={0}
			minSize={10}
			maxSize={25}
            bind:this={sidebarPane}
			onCollapse = {() => {
                isSidebarCollapsed = true;
                document.cookie = `PaneForge:collapsed=${true}`;
            }}
			onExpand = {() => {
                isSidebarCollapsed = false;
                document.cookie = `PaneForge:collapsed=${false}`;
            }}
		>
			<!-- <div
				class={cn(
					"flex h-[52px] items-center justify-center",
					isSidebarCollapsed ? "h-[52px]" : "px-2"
				)}
			>
				<AccountSwitcher {isSidebarCollapsed} {accounts} />
			</div> -->
			<!-- <Separator /> -->
			<!-- <Nav {isSidebarCollapsed} routes={primaryRoutes} /> -->
            <!-- <Sidebar /> -->


            <Sidebar2 />
			<!-- <Separator /> -->
			<!-- <Nav {isSidebarCollapsed} routes={secondaryRoutes} /> -->
		</Resizable.Pane>
		<Resizable.Handle withHandle={false} />
		<Resizable.Pane

            >
			<!-- <MailDisplay mail={mails.find((item) => item.id === $mailStore.selected) || null} /> -->

            {#if $routerStore.data.currentRoute.path === '/document/:documentId'}
                <ProjectDetails />
            {:else if $routerStore.data.currentRoute.path === '/workspace/:workspaceId'}
                <WorkspaceCanvas />
            {:else}
                <!-- <PaymentDetails /> -->
                <IntroPage />
            {/if}
		</Resizable.Pane>
	</Resizable.PaneGroup>


</div>

<style global lang="scss">
    //NOTE Shared SASS variables available globally

    @import '../../sass/styles.scss';

    // .content-wrapper {
    //     height: 100vh;
    //     display: flex;
    //     flex-direction: row;
    // }

    .sidebar-collapse-actions {
        // z-index: 999999;
        z-index: 10;
    }

    .sidebar-right-menu-wrapper {
        position: absolute;
        z-index: 60;
        top: .5rem;
        right: .5rem;
    }
    .user-menu {
        position: absolute;
        top: .7rem;
        right: 1rem;
        z-index: 60;
    }

    [data-vaul-drawer] {
        height: 100%;
        width: 300px;
        left: auto;
    }
</style>
