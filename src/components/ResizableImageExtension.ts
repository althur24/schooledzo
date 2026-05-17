import Image from '@tiptap/extension-image'

/**
 * ResizableImage — extends TipTap Image with manual drag-to-resize.
 * 
 * Uses a simple DOM-based approach that works reliably with Next.js SSR.
 * When an image is clicked, a wrapper with resize handles appears.
 * Dragging the handles resizes the image and commits width/height to the node attrs.
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width') || el.style.width?.replace('px', '') || null,
        renderHTML: (attrs) => {
          if (!attrs.width) return {}
          return { width: attrs.width }
        },
      },
      height: {
        default: null,
        parseHTML: (el) => el.getAttribute('height') || el.style.height?.replace('px', '') || null,
        renderHTML: (attrs) => {
          if (!attrs.height) return {}
          return { height: attrs.height }
        },
      },
    }
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      // Create wrapper
      const wrapper = document.createElement('div')
      wrapper.classList.add('resizable-image-wrapper')
      wrapper.style.display = 'inline-block'
      wrapper.style.position = 'relative'
      wrapper.style.lineHeight = '0'

      // Create image
      const img = document.createElement('img')
      img.src = node.attrs.src
      if (node.attrs.alt) img.alt = node.attrs.alt
      if (node.attrs.title) img.title = node.attrs.title
      img.classList.add('rounded-lg')
      img.style.maxWidth = '100%'
      img.style.display = 'block'
      img.style.cursor = 'pointer'
      img.draggable = false

      // Apply saved dimensions
      if (node.attrs.width) {
        img.style.width = `${node.attrs.width}px`
      }
      if (node.attrs.height) {
        img.style.height = `${node.attrs.height}px`
      }

      wrapper.appendChild(img)

      // Resize handle (bottom-right corner)
      const handle = document.createElement('div')
      handle.classList.add('resizable-image-handle')
      handle.style.cssText = `
        position: absolute;
        bottom: 4px;
        right: 4px;
        width: 14px;
        height: 14px;
        background: #3b82f6;
        border: 2px solid white;
        border-radius: 3px;
        cursor: nwse-resize;
        opacity: 0;
        transition: opacity 0.15s;
        z-index: 10;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      `

      wrapper.appendChild(handle)

      // Show/hide handle on hover
      wrapper.addEventListener('mouseenter', () => {
        if (editor.isEditable) handle.style.opacity = '1'
      })
      wrapper.addEventListener('mouseleave', () => {
        if (!isResizing) handle.style.opacity = '0'
      })

      // Resize logic
      let isResizing = false
      let startX = 0
      let startWidth = 0
      let aspectRatio = 1

      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        isResizing = true

        startX = e.clientX
        startWidth = img.offsetWidth
        aspectRatio = img.offsetHeight / img.offsetWidth

        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
        wrapper.classList.add('is-resizing')
      }

      const onMouseMove = (e: MouseEvent) => {
        if (!isResizing) return

        const dx = e.clientX - startX
        const newWidth = Math.max(50, startWidth + dx)
        const newHeight = Math.round(newWidth * aspectRatio)

        img.style.width = `${newWidth}px`
        img.style.height = `${newHeight}px`
      }

      const onMouseUp = () => {
        if (!isResizing) return
        isResizing = false

        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        wrapper.classList.remove('is-resizing')

        // Commit dimensions to node attributes
        const finalWidth = img.offsetWidth
        const finalHeight = img.offsetHeight

        const pos = getPos()
        if (pos !== undefined) {
          editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes('image', {
              width: finalWidth,
              height: finalHeight,
            })
            .run()
        }

        handle.style.opacity = '0'
      }

      handle.addEventListener('mousedown', onMouseDown)

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false

          img.src = updatedNode.attrs.src
          if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt
          if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`
          if (updatedNode.attrs.height) img.style.height = `${updatedNode.attrs.height}px`

          return true
        },
        destroy: () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        },
      }
    }
  },
})

export default ResizableImage
