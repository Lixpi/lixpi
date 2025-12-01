<script lang="ts">
    import { run } from 'svelte/legacy';

    import { onMount, onDestroy, tick } from 'svelte'


    import { ProseMirrorEditor } from './components/editor.js'
    import { isUUID } from '$src/helpers/is-uuid.js'

    import DocumentService from '$src/services/document-service.ts'
    import AiChatService from '$src/services/ai-chat-service.ts'
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
    let aiChatInstance = $state(null)
    let editorInstance = null

    const documentService = new DocumentService()


    const onAiChatSubmit = ({ messages, aiModel, threadId }: AiChatSendMessagePayload) => {
        // console.log('onAiChatSubmit', {messages, aiModel, threadId, aiChatInstance})

        if (!aiChatInstance) {
            console.log('call->onAiChatSubmit', {aiChatInstance, projectKey: $routerStore.data.currentRoute?.routeParams.key})
            alert('🚫 call->onAiChatSubmit :: aiChatInstance is not initialized... \n\nPlease call 📞 Shallbee 🐝 immediatelly!');

            return false
        }

        aiChatInstance.sendMessage({ messages, aiModel, threadId })
    }

    const onAiChatStop = ({ threadId }: AiChatStopMessagePayload) => {
        console.log('onAiChatStop', { threadId, aiChatInstance })

        if (!aiChatInstance) {
            console.log('call->onAiChatStop', { aiChatInstance, threadId })
            alert('🚫 call->onAiChatStop :: aiChatInstance is not initialized... \n\nPlease call 📞 Shallbee 🐝 immediatelly!');
            return false
        }

        aiChatInstance.stopMessage({ threadId })
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

            if (aiChatInstance) {
                aiChatInstance.disconnect()
                aiChatInstance = null
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
            aiChatInstance = new AiChatService(RouterService.getRouteParams().documentId as string)
            documentStore.setMetaValues({ isRendered: true })
        }
    });


    onMount(() => {})

    onDestroy(() => {
        if (aiChatInstance) {
            aiChatInstance.disconnect()
            editorInstance.destroy()
            aiChatInstance = null
            editorInstance = null
        }
    })

</script>

<div class="editor-wrapper {isDisabled && 'disabled'} {isFocused && 'is-editor-focused'}"></div>

<style lang="scss">
    //NOTE Shared SASS variables available globally

    //TODO move to prosemirror styles file
    .prosemirror-menu {
        position: sticky;
        width: 100%;
        box-shadow: 0px 0px 8px 0 rgba(0, 0, 0, 0.2);
        top: 0;
        z-index: 99999;

    }

    .editor-wrapper {
      // height: auto;
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
      //TODO refactor, move to prosemirror styles file
      // &.disabled :global()
      &.disabled :global(.ProseMirror-menubar) {
        padding: 0;
        // border-color: red;
        border-color: #e4e4e4;
        box-shadow: none;
      }
      &.disabled :global(.ProseMirror) {
        // padding-top: 1.3rem !important;

      }
      &.disabled :global(.ProseMirror-menubar .ProseMirror-menuitem) {
        display: none;
      }
    }



</style>
