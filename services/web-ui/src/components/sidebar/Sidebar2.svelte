<script lang="ts">


    import {
        LoadingStatus,
    } from '@lixpi/constants'

    import {
        lixpiLogo,
        createNewFileIcon,
        logoutIcon,
    } from '$src/svgIcons'

    import routerService from '$src/services/router-service'
    import WorkspaceService from '$src/services/workspace-service.ts'
    import { routerStore } from '$src/stores/routerStore'
    import { workspacesStore } from '$src/stores/workspacesStore.ts'
    import { workspaceStore } from '$src/stores/workspaceStore.ts'
    import { aiModelsStore } from '$src/stores/aiModelsStore'
    import { authStore } from '$src/stores/authStore'
    import { organizationStore } from '$src/stores/organizationStore.ts'
    import { popOutTransition } from '$src/constants/svelteAnimationTransitions'

    import { Button } from "$lib/registry/new-york/ui/button/index.ts";
	import * as DropdownMenu from "$lib/registry/new-york/ui/dropdown-menu/index.ts";
    import { DropdownMenuPrimitive } from "$lib/registry/new-york/ui/dropdown-menu/index.ts";
    import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
    import SquarePlusIcon from "@lucide/svelte/icons/square-plus";
    import FilePlus2Icon from "@lucide/svelte/icons/file-plus-2";
    import FilePlusIcon from "@lucide/svelte/icons/file-plus";
    // import { Separator } from "$lib/registry/new-york/ui/separator/index.js";

	// import { mailStore } from "$src/components/store.js";
	// import type { Mail } from "$src/components/data.js";
	// import { formatTimeAgo } from "$src/components/utils.js";
	import { cn } from "$lib/utils.ts";
	import { Badge } from "$lib/registry/new-york/ui/badge/index.ts";
	import { ScrollArea } from "$lib/registry/new-york/ui/scroll-area/index.ts";

	// export let items: Mail[];

    let scrollAreaRef: HTMLElement | null = null;

    // Create a ref for our portal target
    let portalTargetRef: HTMLElement;

    // You can keep the scrollAreaRef if needed for other purposes
    // let scrollAreaRef = $bindable(null);

    console.log('DropdownMenuPrimitive', DropdownMenu)

	function get_badge_variant_from_label(label: string) {
		if (["work"].includes(label.toLowerCase())) {
			return "default";
		}

		if (["personal"].includes(label.toLowerCase())) {
			return "outline";
		}

		return "secondary";
	}

    let currentWorkspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId)

    const onWorkspaceDeleteHandler = async (e, workspaceId) => {
        e.stopPropagation()

        const workspaceService = new WorkspaceService()
        const deleteWorkspaceRes = await workspaceService.deleteWorkspace({ workspaceId })

    }


    const labels = [
        {
            value: "bug",
            label: "Bug",
        },
        {
            value: "feature",
            label: "Feature",
        },
        {
            value: "documentation",
            label: "Documentation",
        },
    ];




    // TODO: this is just a temp solution. I'm not sure how I want to approach setting default AI model, especially when there will be a multi-thread support in the documents.
    // I definitely don't want to bother to set it here
    let defaultAiModel = $derived($aiModelsStore.data.find(model => model.sortingPosition === 103))


    const handleWorkspaceClick = workspaceId => {
        console.log('workspaceId', workspaceId)
        workspaceStore.setMetaValues({
            loadingStatus: LoadingStatus.idle,
        })

        routerService.navigateTo('/workspace/:workspaceId', {
            params: { workspaceId },
            shouldFetchData: true
        });
	}

    const handleCreateNewWorkspaceClick = async () => {

        const workspaceService = new WorkspaceService()

        await workspaceService.createWorkspace({
            name: 'New Workspace',
        })
    }
</script>


<aside class="bg-sidebar">

    <div class="top-nav w-full flex justify-end items-center">
        <div class="create-new-wrapper pt-5">
            <Button
                variant="ghost"
                size="icon"
                class="[&_svg]:size-6 mr-3"
                onclick={handleCreateNewWorkspaceClick}
            >
                <!-- {@html createNewFileIcon} -->
                <FilePlus2Icon />
            </Button>
        </div>
    </div>

    <!-- <Separator /> -->

<ScrollArea

    class="h-screen projects"
    type="scroll" scrollHideDelay={500}
>
    <!-- <div bind:this={scrollAreaRef} class="relative z-50" ></div> -->


	<div class="flex flex-col gap-2 p-3 pt-0 mt-6 select-none">
        {#each $workspacesStore.data as workspace, index (workspace.workspaceId)}
			<button
				class={cn(`
                    hover:bg-zinc-200
                    dark:hover:bg-sidebar-foreground
                    dark:text-sidebar-primary-foreground
                    dark:hover:text-sidebar-accent
                    flex
                    flex-col
                    items-start
                    gap-0
                    rounded-lg
                    pl-3
                    pr-1
                    py-1
                    text-left
                    text-sm
                    transition-all
                    ease-hover
                    duration-75`,
					currentWorkspaceId === workspace.workspaceId && `
                        bg-zinc-200
                        dark:bg-sidebar-foreground
                        dark:text-sidebar-accent
                    `
				)}
                in:popOutTransition={{duration: 400}}
                out:popOutTransition={{duration: $authStore.meta.isAuthenticated ? 200 : 0}}
				onclick={() => handleWorkspaceClick(workspace.workspaceId)}
			>
				<div class="flex w-full flex-col">
					<div class="flex items-center">
						<div class="flex items-center gap-2">
							<div class="font-medium">{workspace.name}</div>
						</div>
						<div
							class={cn(
								"ml-auto text-xs",
								currentWorkspaceId === workspace.workspaceId
									? "text-foreground"
									: "text-muted-foreground"
							)}
						>

                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger>
                                    {#snippet child({ props })}
                                        <Button {...props} variant="muted" class="data-[state=open]:bg-ghost flex h-8 w-8 p-0">
                                            <EllipsisIcon class="h-4 w-4 "/>
                                            <span class="sr-only">Open Menu</span>
                                        </Button>
                                    {/snippet}
                                </DropdownMenu.Trigger>
                                <DropdownMenu.DropdownMenuPrimitive.Portal to={scrollAreaRef}>
                                    <div style="position: fixed; top: 0; left: 0; background: red; padding: 5px; z-index: 9999;">
                                        Portal content should be visible
                                    </div>
                                    <DropdownMenu.Content class="w-[160px]" align="end">
                                        <DropdownMenu.Item>Edit</DropdownMenu.Item>
                                        <DropdownMenu.Item>Make a copy</DropdownMenu.Item>
                                        <DropdownMenu.Item>Favorite</DropdownMenu.Item>
                                        <DropdownMenu.Separator />
                                        <DropdownMenu.Sub>
                                            <DropdownMenu.SubTrigger>Labels</DropdownMenu.SubTrigger>
                                            <DropdownMenu.SubContent>
                                                <DropdownMenu.RadioGroup value={workspace.name}>
                                                    {#each labels as label (label.value)}
                                                        <DropdownMenu.RadioItem value={label.value}>
                                                            {label.label}
                                                        </DropdownMenu.RadioItem>
                                                    {/each}
                                                </DropdownMenu.RadioGroup>
                                            </DropdownMenu.SubContent>
                                        </DropdownMenu.Sub>
                                        <DropdownMenu.Separator />
                                        <DropdownMenu.Item
                                            onclick={(e) => {
                                                console.log('delete', workspace.workspaceId)
                                                onWorkspaceDeleteHandler(e, workspace.workspaceId)
                                            }}
                                        >
                                            Delete
                                            <DropdownMenu.Shortcut>⌘⌫</DropdownMenu.Shortcut>
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.DropdownMenuPrimitive.Portal>
                            </DropdownMenu.Root>
						</div>
					</div>
					{#if workspace.tags?.length}
						<div class="flex items-center gap-2 mb-2 ">
							{#each workspace.tags as tag}
								<span class="bg-orange-500 text-white text-xs font-normal me-1 px-1.5 py-0.3 rounded-[9px]">
									{tag}
								</span>
							{/each}
						</div>
					{/if}
				</div>
			</button>
		{/each}
	</div>
</ScrollArea>
</aside>


<style lang="scss">
    //NOTE Shared SASS variables available globally

    @import "$src/sass/_helpers";

    aside {
        // background: $sidbarBackgroundColor;
        // height: 100vh;
        :global(.projects) {
            max-height: calc(100vh - 60px) !important;
            // height: calc(100vh - 173px) !important;
            // padding: 0;
            // border-top-right-radius: $sidebarProjectsScrollContainerBorderTopRightRadius;
            // background: $sidebarProjectsScrollContainerBackgroundColor;
            // :global(.project-row-wrapper.is-active + .project-row-wrapper .project-row:before) {    // Hide the project row separator for the project after the active project
            //     background: transparent;
            // }
            // :global(.project-row-wrapper:first-of-type .project-row:before) {    // Hide the project row separator for the first project
            //     background: transparent;
            // }
        }
    }
</style>
