// Gentelella marketing blocks: landing navigation, hero, feature grid and
// call to action.

import {
    createGentelellaCallToAction,
    createGentelellaFeatureGrid,
    createGentelellaHero,
    createGentelellaLandingNavigation,
} from '@lixpi/ui-kit-gentelella/components/marketing'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { GENTELELLA_PRODUCT_MOCKUPS } from '@lixpi/ui-kit-gentelella/components/commerce'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { DemoMedia } from '$src/fixtures/demoMedia.ts'
import { ShowcasePage } from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/gentelella-pages.scss'

export const createGentelellaMarketingPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/marketing',
        title: 'Marketing',
        description: 'Landing-page sections that compose with the rest of the kit.',
    })
    const media = page.own(
        new DemoMedia(),
    )
    const button = (
        label: string,
        variant: 'ghost' | 'outline' | 'primary',
    ): HTMLElement =>
        page.own(
            createGentelellaButton({
                label,
                variant,
            }),
        ).el

    page.addSection({
        title: 'Landing navigation',
        content: page.own(
            createGentelellaLandingNavigation({
                actions: [button('Sign in', 'ghost'), button('Start free', 'primary')],
                brand: html`<strong>Lixpi</strong>`,
                links: ['Product', 'Pricing', 'Docs'].map(label => html`<a href="#">${label}</a>`),
            }),
        ).el,
    })

    page.addSection({
        title: 'Hero',
        content: page.own(
            createGentelellaHero({
                actions: [button('Start free', 'primary'), button('Watch the demo', 'outline')],
                description: 'Plan, generate and review images and video on one canvas.',
                eyebrow: 'Creative workspace',
                media: html`
                    <img
                        className="design-system-commerce-artwork"
                        src=${media.svgUrl(GENTELELLA_PRODUCT_MOCKUPS.overview)}
                        alt="Product overview"
                    />
                `,
                title: 'Your ideas. Room to grow.',
            }),
        ).el,
    })

    page.addSection({
        title: 'Feature grid',
        content: page.own(
            createGentelellaFeatureGrid({
                features: [
                    {
                        description: 'Arrange documents, references and outputs freely.',
                        icon: html`<span innerHTML=${GENTELELLA_ICONS.layout}></span>`,
                        title: 'Canvas',
                    },
                    {
                        description: 'Run several image and video models side by side.',
                        icon: html`<span innerHTML=${GENTELELLA_ICONS.media}></span>`,
                        title: 'Generation',
                    },
                    {
                        description: 'Accept, reject and regenerate candidates.',
                        icon: html`<span innerHTML=${GENTELELLA_ICONS.projects}></span>`,
                        title: 'Review',
                    },
                    {
                        description: 'Share Assets across your organization.',
                        icon: html`<span innerHTML=${GENTELELLA_ICONS.users}></span>`,
                        title: 'Teams',
                    },
                ],
            }),
        ).el,
    })

    page.addSection({
        title: 'Call to action',
        content: page.own(
            createGentelellaCallToAction({
                action: button('Create a workspace', 'primary'),
                description: 'It takes less than a minute.',
                title: 'Start your first canvas',
            }),
        ).el,
    })

    return page
}
