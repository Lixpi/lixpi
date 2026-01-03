// Type definitions for the shapes system
// Shape factories that generate NodeConfig objects for the connector system

import type { NodeConfig } from '$src/infographics/connectors/types.ts'

// Thread/Document shape configuration
export type ThreadShapeParams = {
    id: string
    x: number
    y: number
    width: number
    height: number
    lineCount?: number           // Number of content lines (default: 3)
    linePadding?: { x?: number; y?: number }  // Padding around lines
    lineSpacingScale?: number    // Multiplier for vertical line spacing
    label?: string               // Optional label text instead of lines
    labelClassName?: string      // Optional class for the label text element
    className?: string           // Additional CSS class
    disabled?: boolean           // Visual disabled state
}

// Icon shape configuration
export type IconShapeParams = {
    id: string
    x: number
    y: number
    size: number                 // Width and height of square container
    icon: string                 // SVG string
    className?: string
    disabled?: boolean
}

// Label shape configuration
export type LabelShapeParams = {
    id: string
    x: number
    y: number
    width: number
    height: number
    radius?: number              // Corner radius (default: 16)
    text: string
    className?: string
    disabled?: boolean
}

// Shape factory - creates a NodeConfig for the connector
export type ShapeFactory<T> = (params: T) => NodeConfig
