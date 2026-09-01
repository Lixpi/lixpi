import type {
    Asset,
    SubjectIdentityClassification,
} from '@lixpi/constants'

import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'

type SubjectIdentityDropdownOption = {
    title: string
    value: SubjectIdentityClassification
    ariaLabel: string
}

export const SUBJECT_IDENTITY_OPTIONS: SubjectIdentityDropdownOption[] = [
    { title: 'Unknown', value: 'unknown', ariaLabel: 'Unknown subject identity' },
    { title: 'No person', value: 'no-person', ariaLabel: 'No person depicted' },
    { title: 'Fictional', value: 'fictional', ariaLabel: 'Fictional subject' },
    { title: 'Me', value: 'self', ariaLabel: 'I am the depicted person' },
    { title: 'Authorized', value: 'authorized-real-person', ariaLabel: 'Authorized real person' },
]

export type AssetSubjectIdentityControlInstance = {
    setAsset: (asset: Asset) => void
    destroy: () => void
}

export type AssetSubjectIdentityControlOptions = {
    host: HTMLElement
    asset: Asset
    attestSubjectIdentity: (
        assetId: string,
        assetRevision: number,
        classification: SubjectIdentityClassification,
    ) => Promise<Asset | { error: string }>
    onUpdated?: (asset: Asset) => void
    onError?: (message: string) => void
}

class AssetSubjectIdentityControl implements AssetSubjectIdentityControlInstance {
    private readonly dropdown: ReturnType<typeof createPureDropdown>
    private currentAsset: Asset
    private mutationInFlight = false
    private destroyed = false

    constructor(private readonly options: AssetSubjectIdentityControlOptions) {
        this.currentAsset = options.asset
        this.dropdown = createPureDropdown({
            id: `asset-subject-identity-${options.asset.assetId}-${crypto.randomUUID()}`,
            selectedValue: this.optionForClassification(options.asset.subjectIdentity.classification),
            options: SUBJECT_IDENTITY_OPTIONS,
            theme: 'dark',
            ignoreColorValuesForOptions: true,
            ignoreColorValuesForSelectedValue: true,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: false,
            disableAutoPositioning: true,
            onSelect: option => {
                void this.selectClassification(option.value as SubjectIdentityClassification)
            },
        })
        this.dropdown.dom.classList.add('asset-subject-identity-dropdown')
        this.updateAriaLabel()
        options.host.appendChild(this.dropdown.dom)
    }

    setAsset(asset: Asset): void {
        if (this.destroyed) return
        if (this.currentAsset.assetId === asset.assetId && this.currentAsset.revision > asset.revision) return
        this.currentAsset = asset
        this.syncSelectedClassification(asset.subjectIdentity.classification)
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        try {
            this.dropdown.destroy()
        } finally {
            this.dropdown.dom.remove()
        }
    }

    private optionForClassification(classification: SubjectIdentityClassification): SubjectIdentityDropdownOption {
        return SUBJECT_IDENTITY_OPTIONS.find(option => option.value === classification) ?? SUBJECT_IDENTITY_OPTIONS[0]!
    }

    private syncSelectedClassification(classification: SubjectIdentityClassification): void {
        this.dropdown.update(this.optionForClassification(classification))
        this.updateAriaLabel()
    }

    private updateAriaLabel(): void {
        const button = this.dropdown.dom.querySelector('button')
        if (!(button instanceof HTMLButtonElement)) return
        button.ariaLabel = `Subject identity: ${this.optionForClassification(this.currentAsset.subjectIdentity.classification).ariaLabel}`
    }

    private async selectClassification(nextClassification: SubjectIdentityClassification): Promise<void> {
        if (this.destroyed) return
        const previousClassification = this.currentAsset.subjectIdentity.classification
        if (this.mutationInFlight || nextClassification === previousClassification) {
            this.syncSelectedClassification(previousClassification)
            return
        }

        const requestedAssetId = this.currentAsset.assetId
        this.mutationInFlight = true
        try {
            const result = await this.options.attestSubjectIdentity(
                requestedAssetId,
                this.currentAsset.revision,
                nextClassification,
            )
            if (this.destroyed || this.currentAsset.assetId !== requestedAssetId) return
            if ('error' in result) {
                this.syncSelectedClassification(this.currentAsset.subjectIdentity.classification)
                this.options.onError?.(result.error)
                return
            }
            if (result.assetId !== requestedAssetId || result.revision < this.currentAsset.revision) return
            this.currentAsset = result
            this.syncSelectedClassification(result.subjectIdentity.classification)
            this.options.onUpdated?.(result)
        } catch (error) {
            if (this.destroyed || this.currentAsset.assetId !== requestedAssetId) return
            this.syncSelectedClassification(this.currentAsset.subjectIdentity.classification)
            this.options.onError?.(error instanceof Error ? error.message : String(error))
        } finally {
            this.mutationInFlight = false
        }
    }
}

export function mountAssetSubjectIdentityControl(
    options: AssetSubjectIdentityControlOptions,
): AssetSubjectIdentityControlInstance {
    return new AssetSubjectIdentityControl(options)
}
