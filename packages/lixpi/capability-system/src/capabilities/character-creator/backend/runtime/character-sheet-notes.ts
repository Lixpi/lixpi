import {
    type CharacterEvidenceProfile,
    type CharacterTargetAngle,
} from './character-evidence.ts'

const ANGLE_LABELS: Readonly<Record<CharacterTargetAngle, string>> = {
    front: 'front',
    'three-quarter-front': 'three-quarter',
    profile: 'profile',
    'three-quarter-back': 'three-quarter back',
    back: 'back',
    unspecified: 'unspecified-angle',
}

export const buildCharacterSourceCoverageNote = (evidence: CharacterEvidenceProfile): string => {
    if (evidence.sourceCoverage.length === 0)
        return 'Source coverage: no source images supplied; identity, views, clothing, and hidden details inferred.'

    const suppliedAngles = [...new Set(
        evidence.sourceCoverage.flatMap(coverage => coverage.angles),
    )].filter(angle => angle !== 'unspecified').map(angle => ANGLE_LABELS[angle])
    const suppliedRegions = [...new Set(
        evidence.sourceCoverage.flatMap(coverage => coverage.regions),
    )]
    const supplied = suppliedAngles.length > 0
        ? `${suppliedAngles.join(', ')} views`
        : `${suppliedRegions.join(', ')} reference coverage`
    const requiredAngles: CharacterTargetAngle[] = ['front', 'three-quarter-front', 'profile', 'three-quarter-back', 'back']
    const missingAngles = requiredAngles.filter(angle => !suppliedAngles.includes(ANGLE_LABELS[angle]))
    const inferred = [
        ...(missingAngles.length > 0 ? [`${missingAngles.map(angle => ANGLE_LABELS[angle]).join(', ')} views`] : []),
        ...(!suppliedRegions.includes('feet') ? ['footwear'] : []),
        ...(!suppliedRegions.includes('prop') ? ['unobserved props'] : []),
        'hidden garment details',
    ]

    return `Source coverage: supplied ${supplied}; ${[...new Set(inferred)].join(', ')} inferred.`
}
