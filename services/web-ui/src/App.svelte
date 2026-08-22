<script lang="ts">
    import { onMount } from 'svelte'

    import Layout from '$src/views/layouts/layout.svelte'
    import Login from '$src/pages/login.svelte'

    // import AuthService from '$src/services/auth0-service.js'
    // import { authStore } from '$src/stores/authStore.ts'

    // let authToken: boolean = $state(false)

    onMount(async () => {
        // authToken = await AuthService.getTokenSilently()

        // const userId = $authStore.data.user.sub
    })
</script>

<!-- {#if authToken} -->
    <Layout />
<!-- {:else}
    <Login /> -->
<!-- {/if} -->
