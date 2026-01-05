import {
    gptAvatarIcon,
    microphoneIcon,
    trashBinIcon,
    checkMarkIcon
} from '$src/svgIcons/index.ts'

export const aiUserMessageNodeType = 'aiUserMessage'

export const aiUserMessageNodeSpec = {
    attrs: {
        id: { default: '' },
        style: { default: '' },
    },
    content: 'block+',
    // content: 'paragraph+',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div',
            getAttrs(dom) {
                return {
                    id: dom.getAttribute('id'),
                    style: dom.getAttribute('style'),
                }
            },
        },
    ],
    toDOM(node) {
        return ['div', {
            id: node.attrs.id,
            style: node.attrs.style,
            class: 'ai-user-message'
        }, 0]
    },
}

export const aiUserMessageNodeView = (node, view, getPos, user) => {
    // Create root div
    const parentWrapper = document.createElement('div');
    parentWrapper.className = 'ai-user-message-decorator';

    // Create child div, necessery for tail styling
    const childDiv = document.createElement('div');
    childDiv.className = 'ai-user-message';
    parentWrapper.appendChild(childDiv);


    const userAvatarContainer = document.createElement('div');
    const userAvatar = new Image();   // Create new img element
    userAvatarContainer.className = 'user-avatar';
    userAvatar.src = user?.picture
    userAvatarContainer.appendChild(userAvatar); // Append the img to body
    childDiv.appendChild(userAvatarContainer);

    // Create a ProseMirror view for the node's content
    const contentDOM = document.createElement('div');
    contentDOM.className = 'ai-user-message-content';
    childDiv.appendChild(contentDOM);

    // Add buttons or other elements to the child div
    const acceptButton = document.createElement('button');
    acceptButton.className = 'accept-button';
    acceptButton.innerHTML = checkMarkIcon;
    childDiv.appendChild(acceptButton);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    // deleteButton.innerHTML = 'x';
    deleteButton.innerHTML = trashBinIcon;
    childDiv.appendChild(deleteButton);

    // Return the node view
    return {
        dom: parentWrapper,
        contentDOM,
    };
}

