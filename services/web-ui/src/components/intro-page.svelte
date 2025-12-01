<script lang="ts">
	import { fade } from 'svelte/transition'
	import { aiRobotFaceIcon } from '$src/svgIcons/index.ts'
</script>

<div class="intro-page flex justify-center items-center" in:fade|global="{{ duration: 250 }}">
	<div class="intro-message-container flex justify-center items-center">
		<div class="intro-message">
			<h1>I am <span class="accent">AI</span><span class="masked">...</span></h1>
			<!-- <p>Here at your service</p> -->
		</div>
		<div class="intro-icon">
			{@html aiRobotFaceIcon}
		</div>
	</div>
</div>

<style lang="scss">
	//NOTE Shared SASS variables available globally

	.intro-page {
		height: 100%;
		h1 {
			font-size: 3rem;
			font-weight: 400;
			user-select: none;
			.accent {
				// color: $lixpiColor;
				// color: $aiGreen;
				// color: $darkPastelGreen;
				font-weight: 500;
			}
			.masked {
				font-weight: 300;
			}
		}
		.intro-icon {
			max-width: 100px;
			margin-left:3rem;
			:global(svg) {
				width: 100%;
				height: auto;
				fill: $aiGreen;
			}
		}
	}

</style>
