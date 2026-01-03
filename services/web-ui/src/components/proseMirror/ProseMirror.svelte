<script lang="ts">
    import { run } from 'svelte/legacy';

    import { onMount, onDestroy, tick } from 'svelte'


    import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.js'
    import { isUUID } from '$src/helpers/is-uuid.js'

    import DocumentService from '$src/services/document-service.ts'
    import AiInteractionService from '$src/services/ai-interaction-service.ts'
    import RouterService from '$src/services/router-service.ts'

    import { routerStore } from '$src/stores/routerStore.ts'
    import { documentsStore } from '$src/stores/documentsStore.ts'
    import { documentStore } from '$src/stores/documentStore.ts'

    import {
        LoadingStatus,
        type AiChatSendMessagePayload,
        type AiChatStopMessagePayload
    } from '@lixpi/constants'

    import Spinner from `$src/components/spinner.svelte`

    /**
     * @typedef {Object} Props
     * @property {boolean} [isDisabled]
     */

    /** @type {Props} */
    let { isDisabled = false } = $props();

    let isFocused = false
    let aiInteractionInstance: AiInteractionService | null = null
    let editorInstance = null

    const documentService = new DocumentService()


    const onAiChatSubmit = ({ messages, aiModel, threadId }: AiChatSendMessagePayload) => {
        // console.log('onAiChatSubmit', {messages, aiModel, threadId, aiInteractionInstance})

        if (!aiInteractionInstance) {
            console.log('call->onAiChatSubmit', {aiInteractionInstance, projectKey: $routerStore.data.currentRoute?.routeParams.key})
            alert('🚫 call->onAiChatSubmit :: aiInteractionInstance is not initialized...');

            return false
        }

        aiInteractionInstance.sendChatMessage({ messages, aiModel, threadId })
    }

    const onAiChatStop = ({ threadId }: AiChatStopMessagePayload) => {
        console.log('onAiChatStop', { threadId, aiInteractionInstance })

        if (!aiInteractionInstance) {
            console.log('call->onAiChatStop', { aiInteractionInstance, threadId })
            alert('🚫 call->onAiChatStop :: aiInteractionInstance is not initialized...');
            return false
        }

        aiInteractionInstance.stopChatMessage({ threadId })
    }

    const onProjectTitleChange = inputValue => {
        // console.log('onProjectTitleChange', inputValue)
        $documentStore.data.title = inputValue

        // Trigger save to db by setting the requiresSave flag
        documentStore.setMetaValues({
            requiresSave: true
        })

        // Sync the project title with the documentsStore store
        documentsStore.updateDocument($documentStore.data.documentId, {
            title: inputValue
        })
        // const projectService = DocumentService.getInstance($documentStore.data.documentId)
        documentService.updateDocument({
            documentId: $documentStore.data.documentId,
            title: $documentStore.data.title,
            // prevRevision: $documentStore.data.prevRevision,
            // content: value,
            // aiModel: $documentStore.data.aiModel,
        })
    }

    let timerId;
    const onEditorChange = value => {
        // console.log('onEditorChange', value)
        $documentStore.data.content = value;

        // Clear the previous timer if it exists
        if (timerId) {
            clearTimeout(timerId);
        }

        // Set a new timer
        timerId = setTimeout(() => {
            documentStore.setMetaValues({
                requiresSave: true
            })

            documentService.updateDocument({
                documentId: $documentStore.data.documentId,
                title: $documentStore.data.title,
                prevRevision: $documentStore.data.prevRevision,
                content: value,
                aiModel: $documentStore.data.aiModel,
            })
        }, 300);

    };

    $effect(() => {
        if (
            $documentStore.meta.loadingStatus === LoadingStatus.success &&
            !$documentStore.meta.isRendered
        ) {
            const initialContent = $documentStore.data.content;
            const parentContainer = document.querySelector(".editor-wrapper");
            const existingEditor = document.querySelector("#editor");
            const existingContent = document.querySelector("#content");

            // Remove existing 'editor' and 'content' elements if they exist
            if (existingEditor) parentContainer.removeChild(existingEditor);
            if (existingContent) parentContainer.removeChild(existingContent);

            // Create new 'editor' and 'content' elements
            const newEditor = document.createElement("div");
            newEditor.id = "editor";
            const newContent = document.createElement("div");
            newContent.id = "content";

            // Append the new elements to the parent container
            parentContainer.appendChild(newEditor);
            parentContainer.appendChild(newContent);

            if (editorInstance) {
                editorInstance.destroy()
                editorInstance = null
            }

            if (aiInteractionInstance) {
                aiInteractionInstance.disconnect()
                aiInteractionInstance = null
            }

            editorInstance = new ProseMirrorEditor({
                editorMountElement: newEditor,
                content: newContent,
                initialVal: initialContent,
                isDisabled,
                onEditorChange,
                onProjectTitleChange,
                onAiChatSubmit,
                onAiChatStop
            });
            aiInteractionInstance = new AiInteractionService(RouterService.getRouteParams().documentId as string)
            documentStore.setMetaValues({ isRendered: true })
        }
    });


    onMount(() => {})

    onDestroy(() => {
        if (aiInteractionInstance) {
            aiInteractionInstance.disconnect()
            editorInstance.destroy()
            aiInteractionInstance = null
            editorInstance = null
        }
    })

</script>

<div class="editor-wrapper {isDisabled && 'disabled'} {isFocused && 'is-editor-focused'}"></div>

<style lang="scss">
    .editor-wrapper {
      height: 100%;
      width: 100%;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      #editor {
        height: 100%;
        height: auto;
        width: auto;
        flex: 1;
      }
    }
</style>
