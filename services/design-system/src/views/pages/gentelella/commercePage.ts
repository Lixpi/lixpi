// Gentelella commerce: product cards, gallery, options and quantity, product
// artwork, pricing tiers, invoices, order details and reviews.

import {
    GENTELELLA_PRODUCT_IMAGES,
    GENTELELLA_PRODUCT_MOCKUPS,
    GENTELELLA_RELATED_MOCKUPS,
    createGentelellaInvoiceHeader,
    createGentelellaInvoiceLines,
    createGentelellaInvoiceTotals,
    createGentelellaOrderInfo,
    createGentelellaPricingTier,
    createGentelellaProductAction,
    createGentelellaProductCard,
    createGentelellaProductGallery,
    createGentelellaProductOptions,
    createGentelellaQuantity,
    createGentelellaReview,
} from '@lixpi/ui-kit-gentelella/components/commerce'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaStatus } from '@lixpi/ui-kit-gentelella/components/status'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { DemoMedia } from '$src/fixtures/demoMedia.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/gentelella/gentelella-pages.scss'

export const createGentelellaCommercePage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/commerce',
        title: 'Commerce',
        description: 'The product artwork and mockups ship with Gentelella as SVG markup. The page encodes them as image sources.',
    })
    const media = page.own(
        new DemoMedia(),
    )
    const productImages = Object.entries(GENTELELLA_PRODUCT_IMAGES)

    page.addSection({
        title: 'Product cards',
        columns: 3,
        content: productImages.slice(0, 6).map(
            ([name, svg], index) => page.own(
                createGentelellaProductCard({
                    badge: index === 0
                        ? 'New'
                        : index === 3
                            ? 'Sale'
                            : undefined,
                    imageAlt: name,
                    imageSrc: media.svgUrl(svg),
                    metadata: `${index + 2} colors`,
                    price: `$${(index + 1) * 24}.00`,
                    title: `${name[0].toUpperCase()}${name.slice(1)}`,
                    onSelect: () => announce(`Open ${name}`),
                }),
            ).el,
        ),
    })

    const gallery = page.own(
        createGentelellaProductGallery({
            images: productImages.slice(0, 4).map(
                ([name, svg]) => ({
                    alt: name,
                    src: media.svgUrl(svg),
                }),
            ),
            initialIndex: 1,
        }),
    )
    const options = page.own(
        createGentelellaProductOptions({
            label: 'Size',
            options: ['S', 'M', 'L', 'XL'].map(
                size => ({
                    disabled: size === 'XL',
                    label: size,
                    value: size,
                }),
            ),
            value: 'M',
            onChange: value => announce(`Size ${value}`),
        }),
    )
    const quantity = page.own(
        createGentelellaQuantity({
            label: 'Quantity',
            max: 5,
            min: 1,
            value: 2,
            onChange: value => announce(`Quantity ${value}`),
        }),
    )
    page.addSection({
        title: 'Product detail parts',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    gallery.el,
                    page.own(
                        createGentelellaButton({
                            label: 'setActiveIndex(0)',
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => gallery.setActiveIndex(0),
                        }),
                    ).el,
                ],
                label: 'createGentelellaProductGallery',
            }),
            createShowcaseSpecimen({
                content: [
                    options.el,
                    quantity.el,
                    createShowcaseRow([
                        page.own(
                            createGentelellaProductAction({
                                label: 'Add to cart',
                                onClick: () => announce(`Added ${quantity.getValue()}`),
                            }),
                        ).el,
                        page.own(
                            createGentelellaProductAction({
                                label: 'Save for later',
                                onClick: () => announce('Saved'),
                            }),
                        ).el,
                    ]),
                ],
                label: 'Options, quantity and product actions',
            }),
        ],
    })

    page.addSection({
        title: 'Product artwork and mockups',
        description: 'GENTELELLA_PRODUCT_IMAGES, GENTELELLA_PRODUCT_MOCKUPS and GENTELELLA_RELATED_MOCKUPS.',
        columns: 4,
        content: [...productImages, ...Object.entries(GENTELELLA_PRODUCT_MOCKUPS), ...Object.entries(GENTELELLA_RELATED_MOCKUPS)].map(
            ([name, svg]) => createShowcaseSpecimen({
                content: page.own(
                    createGentelellaCard({
                        content: html`
                            <img
                                className="design-system-commerce-artwork"
                                src=${media.svgUrl(svg)}
                                alt=${name}
                            />
                        `,
                    }),
                ).el,
                label: name,
            }),
        ),
    })

    page.addSection({
        title: 'Pricing tiers',
        columns: 3,
        content: [
            page.own(
                createGentelellaPricingTier({
                    action: page.own(
                        createGentelellaButton({
                            label: 'Start free',
                            variant: 'outline',
                        }),
                    ).el,
                    description: 'For trying things out',
                    features: ['1 workspace', '5 GB storage', 'Community support'],
                    name: 'Starter',
                    price: '$0',
                    priceSuffix: '/month',
                }),
            ).el,
            page.own(
                createGentelellaPricingTier({
                    action: page.own(
                        createGentelellaButton({
                            label: 'Upgrade',
                            variant: 'primary',
                        }),
                    ).el,
                    description: 'For small studios',
                    features: ['Unlimited workspaces', '100 GB storage', 'Priority generation'],
                    name: 'Studio',
                    popular: true,
                    price: '$24',
                    priceSuffix: '/seat/month',
                }),
            ).el,
            page.own(
                createGentelellaPricingTier({
                    action: page.own(
                        createGentelellaButton({
                            label: 'Contact sales',
                            variant: 'outline',
                        }),
                    ).el,
                    features: ['SSO', 'Audit logs', 'Dedicated support'],
                    name: 'Enterprise',
                    price: 'Custom',
                }),
            ).el,
        ],
    })

    page.addSection({
        title: 'Invoice',
        content: page.own(
            createGentelellaCard({
                content: [
                    page.own(
                        createGentelellaInvoiceHeader({
                            invoiceNumber: 'INV-2026-0142',
                            metadata: 'Issued 23 October 2026',
                            status: page.own(
                                createGentelellaStatus({
                                    label: 'Paid',
                                    tone: 'green',
                                }),
                            ).el,
                            title: 'Invoice',
                        }),
                    ).el,
                    page.own(
                        createGentelellaInvoiceLines({
                            lines: [
                                {
                                    amount: '$72.00',
                                    description: 'Studio seats',
                                    quantity: 3,
                                    rate: '$24.00',
                                },
                                {
                                    amount: '$18.00',
                                    description: 'Extra storage',
                                    quantity: '1',
                                    rate: '$18.00',
                                },
                                {
                                    amount: '$0.00',
                                    description: 'Onboarding',
                                },
                            ],
                        }),
                    ).el,
                    page.own(
                        createGentelellaInvoiceTotals({
                            totals: [
                                {
                                    label: 'Subtotal',
                                    value: '$90.00',
                                },
                                {
                                    label: 'Tax',
                                    value: '$18.00',
                                },
                                {
                                    label: 'Total',
                                    value: '$108.00',
                                },
                            ],
                        }),
                    ).el,
                ],
            }),
        ).el,
    })

    page.addSection({
        title: 'Order information and reviews',
        columns: 2,
        content: [
            page.own(
                createGentelellaCard({
                    content: [
                        ['Order', '#10421'],
                        ['Placed', '21 October 2026'],
                        ['Payment', 'Visa ending 4242'],
                        ['Shipping', 'Express'],
                    ].map(
                        ([label, value]) => page.own(
                            createGentelellaOrderInfo({
                                label,
                                value,
                            }),
                        ).el,
                    ),
                    title: 'Order information',
                }),
            ).el,
            page.own(
                createGentelellaCard({
                    content: [
                        page.own(
                            createGentelellaReview({
                                author: 'Ada',
                                body: 'Fits well and the color matches the photos.',
                                date: '12 October 2026',
                                rating: 5,
                            }),
                        ).el,
                        page.own(
                            createGentelellaReview({
                                author: 'Lin',
                                body: 'Good quality, shipping took a week.',
                                rating: 3,
                            }),
                        ).el,
                    ],
                    title: 'Reviews',
                }),
            ).el,
        ],
    })

    return page
}
