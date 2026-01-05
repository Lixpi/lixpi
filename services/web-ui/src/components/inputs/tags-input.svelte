<script>
    import { run, stopPropagation } from 'svelte/legacy';

    import { onMount, } from 'svelte';

    import {
        tagIcon,
        plusIcon,
        xIcon
    } from '$src/svgIcons'

    import { popOutTransition, fadeTransition } from '$src/constants/svelteAnimationTransitions'

    import OrganizationService from '$src/services/organization-service.js'
    import DocumentService from '$src/services/document-service.ts'

    import { userStore } from '$src/stores/userStore.js'

    let {
        selectedTags = $bindable([]),
        availableTags = $bindable([]),
        recentTags = [],
        submenuState = $bindable({}),
        id,
        organizationId,
        documentId
    } = $props();

    let submenuRef = $state()
    let tagsInputRef = $state();
    let tagsSuggestionRef = $state();

    let isEditing = $state(false)
    let inputRef = $state()
    let inputText = $state('')

    let hasAssignedTags = $derived(selectedTags.length > 0)

    let filteredTags;
    run(() => {
        filteredTags = [...recentTags];
    });

    const closeDropdown = () => {
        submenuState[id] = false
        isEditing = false
    }

    const handleTagInputClick = e => {
        e.stopPropagation()
        isEditing = true

        $: if (isEditing) {
            setTimeout(() => inputRef.focus(), 0)
        }
    }

    const handleWindowClick = e => {
        if (!e.composedPath().includes(submenuRef)) {
            closeDropdown()
        }
    }

    const handleKeydown = e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            addTagFromInput()
        } else if (e.key === 'Escape') {
            closeDropdown()
        }
    }

    const addTagFromInput = async () => {
        const newTag = inputRef.textContent.trim();

        if (newTag && !selectedTags.some(tag => tag.name === newTag)) {
            // Create the new tag
            const organizationService = OrganizationService.getInstance($userStore.data.organizations[0]);
            const createdOrganizationTag = await organizationService.createOrganizationTag({ organizationId, name: newTag, color: '#a76117' });

            // Add the new tag to the project
            addTag({ tagId: Object.keys(createdOrganizationTag)[0], ...Object.values(createdOrganizationTag)[0]})
        }
    }

    const addTag = async (tag) => {
        if (!selectedTags.includes(tag)) {
            // Add the existing tag to the project
            const projectService = DocumentService.getInstance(documentId)
            await projectService.addTagToDocument({ documentId, tagId: tag.tagId, organizationId })

            selectedTags = [...selectedTags, tag]
        }

        inputRef.textContent = ''
        inputText = ''
        filteredTags = filteredTags.filter(t => t.tagId !== tag.tagId)
        isEditing = false
    }

    const removeTag = async (index) => {
        const tag = selectedTags[index];
        const projectService = DocumentService.getInstance(documentId);
        await projectService.removeTagFromDocument({ documentId, tagId: tag.tagId });

        // Remove the tag from selectedTags
        selectedTags = selectedTags.filter((_, i) => i !== index);

        // Add the tag back to availableTags if it's not already there
        if (!availableTags.some(t => t.tagId === tag.tagId)) {
            availableTags = [...availableTags, tag];
        }

        // Update the filteredTags to reflect the change
        filterTags();
    };

    const filterTags = () => {
        const query = inputRef.textContent.trim().toLowerCase();
        inputText = query;
        filteredTags = inputText
            ? availableTags.filter(tag => tag.name.toLowerCase().includes(query))
            : [...recentTags];
    };

    // Function to update the position of the tags-suggestion element
    const updateSuggestionPosition = () => {
        if (tagsInputRef && tagsSuggestionRef) {
            const { height } = tagsInputRef.getBoundingClientRect();
            tagsSuggestionRef.style.top = `${height + 15}px`;
        }
    };

    // Ensure the position is updated on mount and after DOM updates
    onMount(updateSuggestionPosition);
    // afterUpdate(updateSuggestionPosition);    // TODO: IMPORTANT: this couldn't be updated by svelte 5 migrate tool automatically

</script>

<svelte:window onclick={handleWindowClick}/>

<div class="tags-input-wrapper d-inline-flex" class:is-editing={isEditing} onclick={stopPropagation(handleTagInputClick)} bind:this={submenuRef}>
    <div class="tags-input d-flex flex-nowrap align-items-start" contenteditable="false" bind:this={tagsInputRef}>
        <!-- <span class="tags-icon d-flex align-items-center">{@html tagIcon}</span> -->
        {#if !hasAssignedTags}
            <span class="tags-empty-input-placehoder d-flex align-items-center">Tags</span>
        {/if}
        <div class="tags-container d-flex flex-wrap align-items-center justify-content-start">
            {#each selectedTags as tag, index}
                <div class="tag" contenteditable="false">
                    {tag.name}
                    {#if isEditing}
                        <span class="remove-tag" onclick={() => removeTag(index)}>{@html xIcon}</span>
                    {/if}
                </div>
            {/each}
            <!-- {#if !isEditing}
                <span class="add-icon d-flex align-items-center justify-content-center">{@html plusIcon}</span>
            {/if} -->
        </div>
    </div>

    {#if isEditing}
        <div class="tags-suggestion" bind:this={tagsSuggestionRef} in:fadeTransition={{duration: 200}} out:popOutTransition={{duration: 150}}>
            <div class="add-tags-text-input" contenteditable="true" bind:this={inputRef} onkeydown={handleKeydown} oninput={filterTags} data-placeholder="Tag name..."></div>
            <div class="dropdown">
                {#if inputText && !availableTags.includes(inputText)}
                    <div class="new-tag-suggestion-wrapper d-flex align-items-center justify-content-start">
                        <div class="new-tag-suggestion d-inline-flex align-items-center justify-content-start" onclick={stopPropagation(addTagFromInput)}>
                            <div class="tag">{inputText}</div>
                            <span class="add-icon d-flex align-items-center justify-content-center">{@html plusIcon}</span>
                        </div>
                    </div>
                {/if}
                <div class="existing-tags  d-flex flex-wrap">
                    {#each filteredTags as tag}
                        <div class="tag" onclick={stopPropagation(() => addTag(tag))}>{tag.name}</div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
.tags-input-wrapper {
    position: relative;
    // .add-icon {
    //     padding: 2px;
    //     line-height: 0;
    //     display: block;
    //     width: 12px;
    //     height: 12px;
    //     border-radius: 99px;
    //     box-sizing: content-box;
    //     box-sizing: border-box;
    //     transition: hoverTransition(all, 70ms);
    //     // margin-left: .1rem;
    //     margin-top: 2px;
    //     margin-bottom: 2px;
    //     :global(svg) {
    //         width: 100%;
    //         height: 100%;
    //         fill: darken($offWhite, 10%);
    //         transition: fill 150ms cubic-bezier(0.19, 1, 0.22, 1);
    //     }
    // }
    &.is-editing {
        width: 100%;    // Setting wrapper width to 100% to make the dropdown full width (when in editing mode)
    }
}

.tags-input {
    // border-radius: 4px;
    padding: .1rem .5rem .1rem 0;
    // margin-left: .1rem;
    min-height: 1.1rem;
    transition: pupOutTransition(all, 210ms);
    user-select: none;
    flex-flow: wrap;
    cursor: pointer;
    // .tags-icon {
    //     margin-top: 2px;
    //     margin-bottom: 2px;
    //     :global(svg) {
    //         height: .8rem;
    //         width: .8rem;
    //         fill: darken($offWhite, 20%);
    //     }
    //     margin-right: .1rem;
    // }
    .tags-empty-input-placehoder {
        font-size: .7rem;
        color: $offWhiteMuted;
        margin-top: 2px;
        margin-bottom: 2px;
        transition: hoverTransition(all, 70ms);
    }
    &:hover {
        // box-shadow: 0 0 0 .03rem $offWhite;
        // .add-icon {
        //     background: $offWhite;
        //     background: $darkPastelGreen;
        //     :global(svg) {
        //         fill: $nightBlue;
        //         fill: $offWhite;
        //     }
        // }
        .tags-empty-input-placehoder {
            color: $tagsInputPlacehoderTextColorHover;
        }
    }
}

.is-editing {
    .tags-input {
        box-shadow: 0 0 0 .03rem $offWhite;
    }
}

.tag {
    color: #151515;
    padding: 0.15rem 0.2rem;
    border-radius: 3px;
    font-size: 0.6rem;
    background: #a76117;
    margin: 0 0.2rem 0 0.2rem;
    color: #fff;
    text-transform: capitalize;
    font-weight: 500;
    display: inline-flex;
    white-space: nowrap;
    // margin: 1px 2px;
    margin: 1px 2px 1px 0;
    &:hover {
        filter: brightness(109%);
    }
    .remove-tag {
        margin-left: 0.4rem;
        cursor: pointer;
        :global(svg) {
            width: 0.4rem;
            height: 0.4rem;
            fill: #fff;
        }
        &:hover {
            :global(svg) {
                fill: #000;
            }
        }
    }
}

.tags-suggestion {
    position: absolute;
    background: $offWhite;
    // top: 170%;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 99999;
    white-space: nowrap;
    border-radius: 4px;
    margin: 0;
    box-shadow: .05rem .05rem 7px 0px rgba(0,0,0,.5);
    user-select: none;
    &:before, &:after {
        content: '';
        position: absolute;
        left: 14px;
        transform: translateX(-50%);
        top: -.52rem;
        z-index: 99;
    }
    &:before {
        border-width: 0 8px 11px;
        border-style: solid;
        margin-top: -2px;
        left: 14px;
        border-color: transparent transparent darken($offWhite, 10%);
    }
    &:after {
        border-width: 0 6px 9px;
        border-style: solid;
        border-color: transparent transparent $offWhite;
    }

    .add-tags-text-input {
        margin-top: 0.2rem;
        padding: 0.2rem 0 0.2rem 0.2rem;
        font-size: 0.8rem;
        color: $mainTextColor;
        border-bottom: 1px solid #ccc;
        cursor: text;

        &[contenteditable=true]:empty:before {    // Placeholder for contenteditable based on data-placeholder attribute
            content:attr(data-placeholder);
            color:grey;
            font-style:italic;
        }
    }

    .dropdown {
        left: 0;
        width: 100%;
        z-index: 9;
        padding: .1rem 0 .2rem 0;
        cursor: default;
        .new-tag-suggestion-wrapper {
            margin-top: .15rem;
            .new-tag-suggestion {
                cursor: pointer;
                display: inline-flex;
            }
            // .add-icon {
            //     background: $offWhite;
            //     background: $darkPastelGreen;
            //     :global(svg) {
            //         fill: $nightBlue;
            //         fill: $offWhite;
            //     }
            // }
            &:hover {
                .tag {
                    filter: brightness(110%);
                }
            }
        }
        .tag {
            margin: 1px 2px;
            cursor: pointer;
            &:hover {
                filter: brightness(110%);
            }
        }
    }
}
</style>
