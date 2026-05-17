'use client'

import React, { useCallback, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ResizableImage } from './ResizableImageExtension'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import SmartText from './SmartText'
import './RichTextEditor.css'

interface RichTextEditorProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    textDirection?: 'ltr' | 'rtl'
}

export default function RichTextEditor({
    value,
    onChange,
    placeholder = 'Tulis di sini...',
    disabled = false,
    textDirection = 'ltr'
}: RichTextEditorProps) {
    const [isUploading, setIsUploading] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                code: false,
                horizontalRule: false,
                dropcursor: { color: '#3b82f6' }
            }),
            Underline,
            ResizableImage.configure({
                HTMLAttributes: {
                    class: 'rounded-lg max-w-full',
                },
                allowBase64: true,
                inline: true,
            }),
            Placeholder.configure({
                placeholder,
                emptyEditorClass: 'is-editor-empty',
            }),
        ],
        content: value,
        editable: !disabled,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML())
        },
        editorProps: {
            attributes: {
                dir: textDirection,
            },
            handleDrop: (view, event, slice, moved) => {
                if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
                    const file = event.dataTransfer.files[0]
                    if (file.type.startsWith('image/')) {
                        event.preventDefault()
                        handleImageUpload(file)
                        return true
                    }
                }
                return false
            },
            handlePaste: (view, event, slice) => {
                if (event.clipboardData && event.clipboardData.files && event.clipboardData.files[0]) {
                    const file = event.clipboardData.files[0]
                    if (file.type.startsWith('image/')) {
                        event.preventDefault()
                        handleImageUpload(file)
                        return true
                    }
                }
                return false
            }
        },
    })

    // Update editor content if external value changes (and not currently focused)
    React.useEffect(() => {
        if (editor && value !== editor.getHTML() && !editor.isFocused) {
            editor.commands.setContent(value)
        }
    }, [value, editor])

    // Update editable state
    React.useEffect(() => {
        if (editor) {
            editor.setEditable(!disabled)
        }
    }, [disabled, editor])

    // Update direction
    React.useEffect(() => {
        if (editor) {
            const dom = editor.view.dom
            if (dom) {
                dom.setAttribute('dir', textDirection)
            }
        }
    }, [textDirection, editor])

    const handleImageUpload = async (file: File) => {
        if (!editor || !file) return

        setIsUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch('/api/questions/upload-image', {
                method: 'POST',
                body: formData
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Upload gagal')
            }

            const data = await res.json()
            if (data.url) {
                editor.chain().focus().setImage({ src: data.url }).run()
            }
        } catch (error: any) {
            alert(error.message || 'Gagal upload gambar')
        } finally {
            setIsUploading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleImageUpload(e.target.files[0])
        }
    }

    const insertMath = useCallback((latex: string) => {
        if (!editor) return

        // Get text content around cursor to detect math context
        const { from } = editor.state.selection
        const textBefore = editor.state.doc.textBetween(0, from, '')
        const textAfter = editor.state.doc.textBetween(from, editor.state.doc.content.size, '')

        // Count unescaped $ signs before cursor to determine if we're inside a math block
        const dollarCount = (textBefore.match(/(?<!\\)\$/g) || []).length
        const isInsideMath = dollarCount % 2 === 1

        let insertText: string

        if (isInsideMath) {
            // Already inside $...$, just insert raw latex (with space separator if needed)
            const needsSpaceBefore = textBefore.length > 0 && !/[\s{(]$/.test(textBefore)
            insertText = (needsSpaceBefore ? ' ' : '') + latex
        } else {
            // Outside math — check for adjacent $ to avoid $$
            const charBefore = textBefore.slice(-1)
            const charAfter = textAfter.charAt(0)

            if (charBefore === '$') {
                // Cursor is right after a closing $, add space separator
                insertText = ' $' + latex + '$'
            } else if (charAfter === '$') {
                // Cursor is right before an opening $, add space separator
                insertText = '$' + latex + '$ '
            } else {
                // Normal case — wrap with delimiters
                insertText = '$' + latex + '$'
            }
        }

        editor.chain().focus().insertContent(insertText).run()
    }, [editor])

    if (!editor) {
        return null
    }

    return (
        <div className={`rich-text-editor ${disabled ? 'opacity-70 pointer-events-none' : ''}`}>
            {/* Toolbar */}
            <div className="rte-toolbar">
                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={`rte-toolbar-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
                    title="Bold (Ctrl+B)"
                >
                    <span className="font-bold">B</span>
                </button>
                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={`rte-toolbar-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
                    title="Italic (Ctrl+I)"
                >
                    <span className="italic font-serif">I</span>
                </button>
                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    className={`rte-toolbar-btn ${editor.isActive('underline') ? 'is-active' : ''}`}
                    title="Underline (Ctrl+U)"
                >
                    <span className="underline">U</span>
                </button>
                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    className={`rte-toolbar-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
                    title="Strikethrough"
                >
                    <span className="line-through">S</span>
                </button>

                <div className="rte-toolbar-divider" />

                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={`rte-toolbar-btn ${editor.isActive('bulletList') ? 'is-active' : ''}`}
                    title="Bullet List"
                >
                    •≡
                </button>
                <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={`rte-toolbar-btn ${editor.isActive('orderedList') ? 'is-active' : ''}`}
                    title="Numbered List"
                >
                    1≡
                </button>

                <div className="rte-toolbar-divider" />

                {/* Math Shortcuts */}
                <button type="button" onClick={() => insertMath('\\frac{a}{b}')} className="rte-toolbar-btn" title="Pecahan">½</button>
                <button type="button" onClick={() => insertMath('x^{2}')} className="rte-toolbar-btn" title="Pangkat">x²</button>
                <button type="button" onClick={() => insertMath('\\sqrt{x}')} className="rte-toolbar-btn" title="Akar">√</button>
                <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className={`rte-toolbar-btn rte-toolbar-btn--text ${showPreview ? 'is-preview-active' : ''}`}
                    title="Toggle Preview Rumus"
                >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>Preview</span>
                </button>

                <div className="rte-toolbar-divider" />

                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rte-toolbar-btn rte-toolbar-btn--image"
                    title="Insert Image"
                    disabled={isUploading}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Gambar</span>
                </button>
                
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={onFileInputChange}
                />

                {isUploading && (
                    <div className="rte-uploading ml-auto">
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Uploading...</span>
                    </div>
                )}
            </div>

            {/* Editor Content Area */}
            <div className="rte-content" dir={textDirection}>
                <EditorContent editor={editor} />
            </div>

            {showPreview && (
                <div className="rte-preview">
                    <div className="rte-preview-label">
                        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Preview Rendering
                    </div>
                    <SmartText text={editor.getHTML()} className="rte-preview-content" as="div" />
                </div>
            )}
        </div>
    )
}
