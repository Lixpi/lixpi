<script>
    import {
        verticalTrippleDots,
        atomIcon,
        projectIcon,
        tagIcon,
        plusIcon
    } from '$src/svgIcons'

    import { documentsStore } from '$src/stores/documentsStore.ts'
    import DocumentService from '$src/services/document-service.ts'
    import routerService from '$src/services/router-service';

    import { routerStore } from '$src/stores/routerStore.ts'
    import { authStore } from '$src/stores/authStore.ts'
    import { userStore } from '$src/stores/userStore.ts'
    import { organizationStore } from '$src/stores/organizationStore.ts'

    import { popOutTransition } from '$src/constants/svelteAnimationTransitions';

    import DropdownMenu from '../inputs/dropdown-menu.svelte'
    import TagsInput from '../inputs/tags-input.svelte';

    let { project, onClick, isActive } = $props();

    let documentsSubmenuState = $state({})
    let projectSubmenuRef

    // TODO this is most likely incorrect and should be refactored, it recalculates values over and over again
    let organizationTags = $derived(Object.entries($organizationStore.data?.tags).map(([key, value]) => ({
        ...value,
        tagId: key
    })))
    let recentTags = $derived($userStore.data?.recentTags.map(tagId => organizationTags.find(tag => tag.tagId === tagId)))
    let selectedTags = $derived(organizationTags.filter(tag => project.tags?.includes(tag.tagId)))
    let availableTags = $derived(organizationTags.filter(tag => !project.tags?.includes(tag.tagId)))

    const toggleProjectSubmenuHandler = (e, documentId) => {
        e.stopPropagation()
        documentsSubmenuState[documentId] = !documentsSubmenuState[documentId]
    }

    const onProjectDeleteHandler = async (e, documentId) => {
        e.stopPropagation()
        documentsSubmenuState = {}
        const projectService = DocumentService.getInstance(documentId)
        const deleteDocumentRes = await projectService.deleteDocument({ documentId })

        if (Boolean(deleteDocumentRes)) {
            documentsStore.deleteDocument(documentId)
            // Navigate to the `create new project page` if current route is the deleted project
            if ($routerStore.data.currentRoute.routeParams?.key === documentId) {
                routerService.navigateTo('project')
            }
        }
    }

    const dropdownOptions = [
        {
            title: 'Delete',
            onClick: (e, id) => onProjectDeleteHandler(e, id)
        },
        {
            title: 'Settings',
            onClick: (e, id) => {}
        }
    ]

</script>

<div
    class="project-row-wrapper"
    class:is-active={isActive}
    in:popOutTransition={{duration: 400}}
    out:popOutTransition={{duration: $authStore.meta.isAuthenticated ? 200 : 0}}
>
    <div
        class="project-row d-flex flex-column"
        class:is-active={isActive}
        class:has-assigned-tags={selectedTags.length > 0}
        class:has-dropdown-active={documentsSubmenuState[project.documentId]}
        onclick={() => onClick(project.documentId)}
    >
        <div class="d-flex">
            <div class="project-details">
                <div class="project-title-wrapper d-flex justify-content-between align-items-center">
                    <span class="project-name">{project.title || 'New document'}</span>

                    <DropdownMenu
                        theme="dark"
                        submenuState={documentsSubmenuState}
                        id={project.documentId}
                        toggleSubmenuHandler={toggleProjectSubmenuHandler}
                        dropdownOptions={dropdownOptions}
                    />
                </div>
                <div class="subtasks-section d-flex align-items-center mt-2">
                    <!-- <p>Project context info will be here.</p> -->
                    <!-- {#if isActive}
                        <ul class="mt-2">
                            <li>How about subtasks?</li>
                            <li>
                                Hello darkness my old friend...
                                <ul class="mt-1">
                                    <li>Do the shit!</li>
                                    <li>Get rich!</li>
                                </ul>
                            </li>
                            <li>I'd rather <span class="grim">die</span> in front of the screen than be a modern days <span class="warn">slave</span> for the rest of my life</li>
                        </ul>
                    {/if} -->
                </div>
            </div>
        </div>
        <div class="project-meta d-flex">
            <div class="tags-input-wrapper d-flex">
                <TagsInput
                    id={project.documentId}
                    documentId={project.documentId}
                    organizationId={$organizationStore.data.organizationId}
                    selectedTags={selectedTags}
                    availableTags={availableTags}
                    recentTags={recentTags}
                />
            </div>
        </div>
    </div>
</div>

<style lang="scss">
    //NOTE Shared SASS variables available globally

    @import "../../sass/_helpers";

    .project-row-wrapper {
        box-shadow: $projectRowWrapperBoxShadow;
        &.is-active {
        }
        .project-row {
            position: relative;
            width: 100%;
            padding: .7rem .9rem .7rem 1.08rem;
            background: $projectRowBackgroundColor;
            transition: background 50ms cubic-bezier(0.19, 1, 0.22, 1);
            cursor: pointer;
            // box-shadow: $projectRowBoxShadow;
            border-top-right-radius: 3px;
            border-bottom-right-radius: 3px;
            &:hover {
                background: $projectRowHoverBackgroundColor;
            }
            &:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 1px;
                // box-shadow: 0px 0px 0px 1px rgba(234, 234, 234, 1);
                // box-shadow: $projectRowBoxShadow;
                background: $projectRowSeparatorLineFallbackColor;    // Fallback color, in case if gradient is not supported
                background: $projectRowSeparatorLineGradientColor;    // Gradient color, supported by modern browsers
            }
            &.is-active {
                background: $projectRowActiveBackgroundColor;
                cursor: default;
                display: block;
                box-shadow: none;
                &:before {
                    background: transparent;    // Hide project row separator line for the active project. It's just a half of work, another half is hidden in the Sidebar.svelte   line : `:global(.project-row-wrapper.is-active + .project-row-wrapper .project-row:before) {`
                }
            }

            // Hide dropdown menu by default
            :global(.dots-dropdown-menu) {
                display: none;
            }

            .project-meta {
                width: 100%;
                // min-height: 30px;
                .tags-input-wrapper {
                    width: 100%;
                    opacity: 0;
                }
            }

            .project-details {
                width: 100%;
            }
            .project-title-wrapper {
                position: relative;
            }
            .project-name {
                font-weight: 400;
                font-size: .95rem;
                color: $projectTitleColor;
                user-select: none;
                padding-right: 1.3rem;
            }

            &.has-assigned-tags, &:hover, &.is-active {
                // background: wheat;
                .project-meta {
                    // display: block;
                    .tags-input-wrapper {
                        width: 100%;
                        opacity: 1;
                    }
                }
            }

            // Show dropdown menu on hover or when active
            &.is-active, &:hover {
                :global(.dots-dropdown-menu) {
                    display: block;
                }
            }

            &.is-active {
                .project-name {
                    color: $projectTitleActiveColor;
                    font-weight: 500;;
                }
            }

            .subtasks-section {     // For now is not used, but kept for reference of styling in case if I'll want to add something there
                font-size: .81rem;
                margin-right: .5rem;
                color: #cccccc;
                user-select: none;
                ul {
                    margin-left: 1rem;
                    li {
                        line-height: 1rem;
                        transition: color 30ms cubic-bezier(0.19, 1, 0.22, 1);
                        &:before {
                            content: '-';
                            margin-right: .2rem;
                        }
                        &:hover {
                            li {
                                color: #cccccc;
                                &:hover {
                                    color: orange;
                                }
                            }
                        }
                        span {
                            &.warn {
                                color: #cd2b2b;
                                font-weight: 500;
                            }
                            &.grim {
                                color: #d11f1f;
                            }
                        }
                    }
                }
            }

            p {
                margin-bottom: .4em;
                line-height: 1.2;
                &:last-of-type {
                    margin-bottom: 0;
                }
            }
        }
    }

</style>
