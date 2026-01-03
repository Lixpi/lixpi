
export const defaultAttrs = {
    taskKey: 'LIX-1',
    status: 'New Task Status',
    title: 'New Task Title',
    description: 'New Task Description',
}

export const taskRowNodeType = 'taskRow'

export const taskRowNodeSpec = {
	inline: false,
	group: 'block',
	draggable: false,
	attrs: defaultAttrs,

    // TODO do we still need it? Previously it was imported from subtaskRowService, look at the commented code at the end of the file

	// toDOM: (node) => DOMManager.create(node),
	// destroy: (node) => DOMManager.destroy(node),

}


// TODO for reference. Now we have an improved version of this code, but I'm not sure if we need to specify toDOM and destroy methods for this spec...
// import { DOMManager } from '$src/components/proseMirror/plugins/subtasks/subtaskRowService.ts'
// export class DOMManager {
// 	static create(node) {
// 		const element = document.createElement('div')
// 		// const component = new TaskRow({ target: element, props: { node } })
// 		const component = new TaskRow({ target: element, props: node.attrs })
// 		node._svelteComponent = component
// 		return element
// 	}

// 	static destroy(node) {
// 		const component = node._svelteComponent
// 		if (component) {
// 			component.$destroy()
// 			delete node._svelteComponent
// 		}
// 	}
// }
