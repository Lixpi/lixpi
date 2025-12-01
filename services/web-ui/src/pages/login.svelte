<script>
	import { onMount } from 'svelte'
    import { fade, fly } from 'svelte/transition'
    import { elasticOut } from 'svelte/easing'

	import { lixpiLogo } from '../svgIcons/index.ts'

	import AuthService from '../services/auth-service.ts'

	// export let currentRoute

	// const API_URL = import.meta.env.VITE_API_URL
	const ERROR_MESSAGES = {
		user_not_found: "You don't have permissions"
	}

	// Todo read and handle auth errors
	// const errorMessage = currentRoute?.queryParams?.authError
	const errorMessage = false

	let isPageOnRenderAnimationActive = $state(false)

	onMount(() => {
		setTimeout(() => { // Make sure that animation is triggered after page is rendered
			isPageOnRenderAnimationActive = true;
		}, 0)
	})
</script>

<svelte:head>
	<title>Lixpi login</title>
</svelte:head>


<div class="full-height" id="login-page-container">
	<div class="row full-height" id="logo-container">
		<div class="col align-self-center d-flex flex-column">
			<div id="strip" in:fade|global="{{ duration: 800 }}"></div>
			<div class="row logo-wrapper">
				<div class="col left-offset">
					<span class="logo-container" class:animating="{isPageOnRenderAnimationActive}">
						{@html lixpiLogo}
					</span>
				</div>
				<div class="col">
					<span class="brand-name inverted-color" class:animating="{isPageOnRenderAnimationActive}">Lixpi</span>
				</div>
			</div>
		</div>
	</div>
	<div class="row full-height ml-1" id="login-form-container" in:fade|global="{{ duration: 900 }}">
		<div class="row">
			<div class="col left-offset"></div>
			<div class="col">
				<div class="store-selector d-inline-flex flex-column">
					<h3>Please authenticate</h3>
					{#if errorMessage}
						<span class="error-message">Error: {ERROR_MESSAGES[errorMessage]}</span>
					{/if}
					<div class="d-flex justify-content-center mt-3 mb-5">

						<button class="p-3" onclick={AuthService.login}>Login</button>

					</div>
					<div class="d-flex">
						<a class="auth-errors-popup" href="#">Having issues with logging in?</a>
					</div>
				</div>
			</div>
		</div>

	</div>
</div>


<style lang="scss">
	.route-enter-active {
	    display: none;
	}
	#login-page-container {
	    position: fixed;
	    top: 0;
	    right: 0;
	    bottom: 0;
	    left: 0;
	    overflow: hidden;

	    #strip {
	    	position: absolute;
	    	background: orange;
	    	background: #92b56f;
	    	width: 100%;
	    	height: 52px;
			bottom: 0;
			z-index: 1;
	    }

	    // &.route-exit-active {
	    //     #logo-container {
	    //         background: #fff;
	    //         img {
	    //             transform: translateY(-600%);
	    //         }
	    //     }
	    //     #login-form-container {
	    //         form {
	    //             transform: translateY(206%);
	    //         }
	    //     }
	    // }
	    .col.left-offset {
	    	max-width: 43.1%;
	    }
	    .logo-wrapper {
	    	position: absolute;
	    	bottom: 0;
	    	width: 100%;
	    	> div {
	    		position: relative;
	    	}
	    }
	    #logo-container {
	        height: 30%;
	        transition: all 1s cubic-bezier(0.585,-.6,.43,1.65);
			.logo-container {
				position: absolute;
	        	bottom: -2rem;
			    z-index: 2;
	            right: 100%;
				display: block;
				transition: all .500s cubic-bezier(0.585,-.6,.143,1.13);
				&.animating {
	            	right: 1rem;
	            }
				:global(svg) {
					width: 200px;
					height: 200px;
					z-index: 999;
					fill: $nightBlue;
				}
			}
	        .brand-name {
				font-family: 'Herculanum LT Pro', sans-serif;
	        	position: absolute;
				font-size: 4.5rem;
				bottom: -28px;
				color: black;
				z-index: 2;
				left: 100%;
				white-space: nowrap;
				user-select: none;
				-webkit-transition: all .500s cubic-bezier(0.185,-5,.143,1.2);
	            -moz-transition: all .500s cubic-bezier(0.185,-5,.143,1.2);
	            -ms-transition: all .500s cubic-bezier(0.185,-5,.143,1.2);
	            -o-transition: all .500s cubic-bezier(0.185,-5,.143,1.2);
	            transition: all .500s cubic-bezier(0.185,-5,.143,1.2);
	            &.inverted-color {
					position: absolute;
					left: 43.9%;
					color: $nightBlue;
					height: 76px;
					-webkit-transition: all .900s cubic-bezier(0.185,-1,-.143,-1.2);
		            -moz-transition: all .900s cubic-bezier(0.185,-1,-.143,-1.2);
		            -ms-transition: all .900s cubic-bezier(0.185,-1,-.143,-1.2);
		            -o-transition: all .900s cubic-bezier(0.185,-1,-.143,-1.2);
		            transition: all .900s cubic-bezier(0.185,-1,-.143,-1.2);
				}

	            &.inverted-color.animating {
        			text-shadow: -6px 7px 25px rgba(0, 0, 0, 0.2), 2px -3px 26px rgba(0, 0, 0, 0.3);
    				left: 1rem;
    				bottom: -32px;
        		}
	        }
	    }
	    #login-form-container {
	        height: 50%;
	        > div {
	            -webkit-transition: all .450s cubic-bezier(0.585,-.6,.43,1.65);
	            -moz-transition: all .450s cubic-bezier(0.585,-.6,.43,1.65);
	            -ms-transition: all .450s cubic-bezier(0.585,-.6,.43,1.65);
	            -o-transition: all .450s cubic-bezier(0.585,-.6,.43,1.65);
	            transition: all .450s cubic-bezier(0.585,-.6,.43,1.65);
	            box-sizing: border-box;
	            // max-width: 635px;
	            width: 100%;;
	            height: 100%;
	            margin: 9rem auto 0;
	            h3 {
	                margin-bottom: 1rem;
	            }
	            input {
	                margin: .5em 0;
	                font-size: 1em;
	                padding: .3em;
	                border-radius: 2px;
	                border: 1px solid #e1e1e1;
	            }
	            .auth-errors-popup {
	                color: #7FA950;
	                padding: .5em .5em;
	                font-size: 1em;
					text-decoration: none;
	                cursor: pointer;
	            }
	        }
	    }
	}

	.error-message {
		margin: 1rem 0 1.5rem;
		color: $red;
	}
</style>
