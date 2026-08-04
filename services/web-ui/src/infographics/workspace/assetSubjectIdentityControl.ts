import type { Asset, SubjectIdentityClassification } from '@lixpi/constants'

import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import AssetService from '$src/services/asset-service.ts'

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

type AssetSubjectIdentityControlOptions = {
    host: HTMLElement
    asset: Asset
    onUpdated?: (asset: Asset) => void
    onError?: (message: string) => void
}

class AssetSubjectIdentityControl implements AssetSubjectIdentityControlInstance {
    private readonly assetService = new AssetService()
    private readonly dropdown: ReturnType<typeof createPureDropdown>
    private currentAsset: Asset
    private mutationInFlight = false
    private destroyed = false

    constructor(private readonly options: AssetSubjectIdentityControlOptions) {
        this.currentAsset = options.asset
        this.dropdown = createPureDropdown({
            id: `asset-subject-identity-${options.asset.assetId}`,
            selectedValue: this.optionForClassification(options.asset.subjectIdentity.classification),
            options: SUBJECT_IDENTITY_OPTIONS,
            theme: 'dark',
            ignoreColorValuesForOptions: true,
            ignoreColorValuesForSelectedValue: true,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: false,
            disableAutoPositioning: true,
            onSelect: option => { void this.selectClassification(option.value as SubjectIdentityClassification) },
        })
        this.dropdown.dom.classList.add('asset-subject-identity-dropdown')
        this.updateAriaLabel()
        options.host.appendChild(this.dropdown.dom)
    }

    setAsset(asset: Asset): void {
        this.currentAsset = asset
        this.syncSelectedClassification(asset.subjectIdentity.classification)
    }

    destroy(): void {
        this.destroyed = true
        this.dropdown.destroy()
        this.dropdown.dom.remove()
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
        const previousClassification = this.currentAsset.subjectIdentity.classification
        if (this.mutationInFlight || nextClassification === previousClassification) {
            this.syncSelectedClassification(previousClassification)
            return
        }

        const requestedAssetId = this.currentAsset.assetId
        this.mutationInFlight = true
        try {
            const result = await this.assetService.attestSubjectIdentity(
                requestedAssetId,
                this.currentAsset.revision,
                nextClassification,
            )
            if (this.destroyed || this.currentAsset.assetId !== requestedAssetId) return
            if ('error' in result) {
                this.syncSelectedClassification(previousClassification)
                this.options.onError?.(result.error)
                return
            }
            this.currentAsset = result
            this.syncSelectedClassification(result.subjectIdentity.classification)
            this.options.onUpdated?.(result)
        } catch (error) {
            if (this.destroyed || this.currentAsset.assetId !== requestedAssetId) return
            this.syncSelectedClassification(previousClassification)
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
