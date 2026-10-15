import React, { useLayoutEffect, useRef, useState } from 'react'
import { msg } from 'app/i18n/i18n'

const storageKey = 'picturama.folderSidebarWidth'
const defaultWidth = 200
const minWidth = 160
const maxWidth = 520

function savedWidth(): number {
    try {
        const value = Number(window.localStorage.getItem(storageKey))
        return Number.isFinite(value) && value >= minWidth ? Math.min(maxWidth, value) : defaultWidth
    } catch { return defaultWidth }
}

/** A captured pointer keeps resizing even when the mouse leaves the narrow divider. */
export default function FolderSidebarResizer({ showInfo }: { showInfo: boolean }) {
    const handle = useRef<HTMLDivElement>(null)
    const preferredWidth = useRef(savedWidth())
    const dragPointer = useRef<number | null>(null)
    const [size, setSize] = useState({ width: preferredWidth.current, max: maxWidth })

    function applyWidth(width: number, persist = false) {
        const library = handle.current?.parentElement
        if (!library || !library.clientWidth) return
        // Preserve room for the photo grid and any information sidebar.
        const available = Math.max(minWidth, Math.min(maxWidth, library.clientWidth - (showInfo ? 344 : 44) - 320))
        const clamped = Math.round(Math.max(minWidth, Math.min(available, width)))
        library.style.setProperty('--folder-sidebar-width', `${clamped}px`)
        setSize(previous => previous.width === clamped && previous.max === available ? previous : { width: clamped, max: available })
        if (persist) {
            preferredWidth.current = clamped
            try { window.localStorage.setItem(storageKey, String(clamped)) } catch { /* Layout still works without storage. */ }
        }
    }

    useLayoutEffect(() => {
        const library = handle.current?.parentElement
        if (!library) return
        applyWidth(preferredWidth.current)
        const observer = new ResizeObserver(() => applyWidth(preferredWidth.current))
        observer.observe(library)
        return () => {
            observer.disconnect()
            library.classList.remove('isResizingSidebar')
        }
    }, [showInfo])

    function finishResize(event: React.PointerEvent<HTMLDivElement>) {
        if (dragPointer.current !== event.pointerId) return
        dragPointer.current = null
        handle.current?.parentElement?.classList.remove('isResizingSidebar')
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        const width = Number.parseFloat(handle.current?.parentElement?.style.getPropertyValue('--folder-sidebar-width') || '')
        if (Number.isFinite(width)) applyWidth(width, true)
    }

    return <div ref={handle} className='Library-sidebarResize' role='separator' tabIndex={0}
        aria-label={msg('FolderSidebar_resize')} title={msg('FolderSidebar_resize')}
        aria-orientation='vertical' aria-valuemin={minWidth} aria-valuemax={size.max} aria-valuenow={size.width}
        onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            dragPointer.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.parentElement?.classList.add('isResizingSidebar')
        }}
        onPointerMove={event => {
            if (dragPointer.current !== event.pointerId) return
            const library = event.currentTarget.parentElement!
            applyWidth(event.clientX - library.getBoundingClientRect().left)
        }}
        onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
        onDoubleClick={() => applyWidth(defaultWidth, true)}
        onKeyDown={event => {
            const width = event.key === 'ArrowLeft' ? size.width - 10 : event.key === 'ArrowRight' ? size.width + 10 :
                event.key === 'Home' ? minWidth : event.key === 'End' ? size.max : null
            if (width === null) return
            event.preventDefault()
            event.stopPropagation()
            applyWidth(width, true)
        }}/>
}
