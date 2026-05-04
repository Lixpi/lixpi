<script lang="ts">
    import { LoadingStatus } from '@lixpi/constants'
    import routerService from '$src/services/router-service'
    import WorkspaceService from '$src/services/workspace-service.ts'
    import AuthService from '$src/services/auth-service.ts'
    import { routerStore } from '$src/stores/routerStore'
    import { workspacesStore } from '$src/stores/workspacesStore.ts'
    import { workspaceStore } from '$src/stores/workspaceStore.ts'
    import { servicesStore } from '$src/stores/servicesStore.ts'
    import { authStore } from '$src/stores/authStore'
    import { popOutTransition } from '$src/constants/svelteAnimationTransitions'
    import { Button } from '$lib/registry/ui/button/index.ts'
    import FilePlus2Icon from '@lucide/svelte/icons/file-plus-2'
    import { createPureDropdown } from '$src/components/dropdown/index.ts'
    import { cn } from '$lib/utils.ts'
    import { ScrollArea } from '$lib/registry/ui/scroll-area/index.ts'

    const ellipsisIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`

    let currentWorkspaceId = $derived($routerStore.data.currentRoute.routeParams.workspaceId)

    let importFileInput: HTMLInputElement
    let importTargetWorkspaceId: string | null = null

    const onWorkspaceDeleteHandler = async (workspaceId: string) => {
        const workspaceService = new WorkspaceService()
        await workspaceService.deleteWorkspace({ workspaceId })
    }

    const onWorkspaceExportHandler = async (workspaceId: string) => {
        const token = await AuthService.getTokenSilently()
        if (!token) return

        const apiUrl = import.meta.env.VITE_API_URL
        window.open(`${apiUrl}/api/workspaces/${workspaceId}/export?token=${token}`, '_blank')
    }

    const onWorkspaceImportHandler = (workspaceId: string) => {
        importTargetWorkspaceId = workspaceId
        importFileInput.value = ''
        importFileInput.click()
    }

    const onImportFileSelected = async (event: Event) => {
        const input = event.target as HTMLInputElement
        const file = input.files?.[0]
        if (!file || !importTargetWorkspaceId) return

        const workspaceId = importTargetWorkspaceId
        importTargetWorkspaceId = null

        const token = await AuthService.getTokenSilently()
        if (!token) return

        const apiUrl = import.meta.env.VITE_API_URL
        const formData = new FormData()
        formData.append('file', file)

        try {
            const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/import`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            })

            if (!response.ok) {
                const error = await response.json()
                console.error('Workspace import failed:', error)
                return
            }

            // Reload workspace data if the imported workspace is currently open
            if (currentWorkspaceId === workspaceId) {
                const workspaceService = new WorkspaceService()
                await workspaceService.getWorkspace({ workspaceId })
                await Promise.all([
                    servicesStore.getData('documentService').getWorkspaceDocuments({ workspaceId }),
                    servicesStore.getData('aiChatThreadService').getWorkspaceAiChatThreads({ workspaceId })
                ])
            }
        } catch (error) {
            console.error('Workspace import failed:', error)
        }
    }

    const handleWorkspaceClick = (workspaceId: string) => {
        workspaceStore.setMetaValues({
            loadingStatus: LoadingStatus.idle,
        })

        routerService.navigateTo('/workspace/:workspaceId', {
            params: { workspaceId },
            shouldFetchData: true
        })
    }

    const handleCreateNewWorkspaceClick = async () => {
        const workspaceService = new WorkspaceService()
        await workspaceService.createWorkspace({
            name: 'New Workspace',
        })
    }

    function mountWorkspaceDropdown(node: HTMLElement, workspaceId: string) {
        const dropdown = createPureDropdown({
            id: `workspace-menu-${workspaceId}`,
            selectedValue: { title: '' },
            options: [
                { title: 'Import' },
                { title: 'Export' },
                { title: 'Delete' },
            ],
            theme: 'dark',
            buttonIcon: ellipsisIcon,
            disableTriggerHover: true,
            renderTitleForSelectedValue: false,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: true,
            onSelect: (option) => {
                if (option.title === 'Import') {
                    onWorkspaceImportHandler(workspaceId)
                } else if (option.title === 'Export') {
                    onWorkspaceExportHandler(workspaceId)
                } else if (option.title === 'Delete') {
                    onWorkspaceDeleteHandler(workspaceId)
                }
            },
        })

        node.appendChild(dropdown.dom)

        // Stop click propagation so workspace row doesn't navigate
        dropdown.dom.addEventListener('click', (e: Event) => e.stopPropagation())

        return {
            destroy() {
                dropdown.destroy()
            }
        }
    }
</script>


<input
    type="file"
    accept=".zip"
    class="hidden"
    bind:this={importFileInput}
    onchange={onImportFileSelected}
/>

<aside class="workspace-list-sidebar bg-sidebar">

    <div class="top-nav w-full flex justify-end items-center">
        <div class="create-new-wrapper pt-5">
            <Button
                variant="ghost"
                size="icon"
                class="mr-3"
                onclick={handleCreateNewWorkspaceClick}
            >
                <!-- {@html createNewFileIcon} -->
                <FilePlus2Icon class="size-6" />
            </Button>
        </div>
    </div>

<ScrollArea class="h-screen projects" type="scroll" scrollHideDelay={500}>
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

                            <div use:mountWorkspaceDropdown={workspace.workspaceId}></div>
						</div>
					</div>
					{#if workspace.tags?.length}
						<div class="flex items-center gap-2 mb-2 ">
                            {#each workspace.tags as tag (tag)}
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
    @import "$src/sass/_helpers";

    aside {
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;

        :global(.projects) {
            height: auto !important;
            min-height: 0;
            flex: 1 1 auto;
            max-height: none !important;
        }
    }
</style>