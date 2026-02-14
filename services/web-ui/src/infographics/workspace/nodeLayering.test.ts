'use strict'

import { describe, it, expect, beforeEach } from 'vitest'
import { createNodeLayerManager } from './nodeLayering.ts'

describe('nodeLayering — createNodeLayerManager', () => {
	let manager: ReturnType<typeof createNodeLayerManager>

	beforeEach(() => {
		manager = createNodeLayerManager()
	})

	it('starts with initial z-index of 10', () => {
		expect(manager.currentTopIndex()).toBe(10)
	})

	it('increments z-index when bringToFront is called', () => {
		const el = document.createElement('div')
		manager.bringToFront(el)
		expect(el.style.zIndex).toBe('11')
		expect(manager.currentTopIndex()).toBe(11)
	})

	it('sets progressively higher z-index on each call', () => {
		const el1 = document.createElement('div')
		const el2 = document.createElement('div')
		const el3 = document.createElement('div')

		manager.bringToFront(el1)
		manager.bringToFront(el2)
		manager.bringToFront(el3)

		expect(el1.style.zIndex).toBe('11')
		expect(el2.style.zIndex).toBe('12')
		expect(el3.style.zIndex).toBe('13')
	})

	it('re-selecting the same element gives it a new higher z-index', () => {
		const el = document.createElement('div')

		manager.bringToFront(el)
		expect(el.style.zIndex).toBe('11')

		manager.bringToFront(el)
		expect(el.style.zIndex).toBe('12')
	})

	it('last element brought to front always has the highest z-index', () => {
		const elA = document.createElement('div')
		const elB = document.createElement('div')

		manager.bringToFront(elA)
		manager.bringToFront(elB)
		manager.bringToFront(elA)

		expect(Number(elA.style.zIndex)).toBeGreaterThan(Number(elB.style.zIndex))
	})

	it('separate manager instances track independently', () => {
		const manager2 = createNodeLayerManager()
		const el1 = document.createElement('div')
		const el2 = document.createElement('div')

		manager.bringToFront(el1)
		manager.bringToFront(el1)
		manager2.bringToFront(el2)

		expect(manager.currentTopIndex()).toBe(12)
		expect(manager2.currentTopIndex()).toBe(11)
	})
})
