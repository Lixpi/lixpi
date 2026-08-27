<script lang="ts">
    import { onMount } from 'svelte'
    import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
    import '@lixpi/ui-kit/styles/bubble-menu'
    import '@lixpi/ui-kit/styles/canvas-node-footer'
    import '@lixpi/ui-kit/styles/dropdown'
    import '@lixpi/ui-kit/styles/help-tooltip'
    import '@lixpi/ui-kit/styles/info-bubble'
    import '@lixpi/ui-kit/styles/media-model-badge'
    import '@lixpi/ui-kit/styles/progress-timeline'
    import '@lixpi/ui-kit/styles/side-panel'

    import Layout from '$src/views/layouts/layout.svelte'
    import Login from '$src/pages/login.svelte'

    // import AuthService from '$src/services/auth0-service.js'
    // import { authStore } from '$src/stores/authStore.ts'

    // let authToken: boolean = $state(false)

    onMount(() => {
        const helpTooltipProvider = createHelpTooltipProvider({
            root: document,
            shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
        })

        // authToken = await AuthService.getTokenSilently()

        // const userId = $authStore.data.user.sub

        return () => helpTooltipProvider.destroy()
    })
</script>

<!-- {#if authToken} -->
    <Layout />
<!-- {:else}
    <Login /> -->
<!-- {/if} -->
