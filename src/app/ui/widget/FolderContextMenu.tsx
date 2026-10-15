import React from 'react'
import { ContextMenu, Menu, MenuItem } from '@blueprintjs/core'
import BackgroundClient from 'app/BackgroundClient'
import { showError } from 'app/ErrorPresenter'
import { msg } from 'app/i18n/i18n'

export function showFolderContextMenu(directory: string, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    ContextMenu.show(
        <Menu className='bp3-dark'>
            <MenuItem icon='folder-open' text={msg('FolderSidebar_openInExplorer')}
                onClick={() => BackgroundClient.openPhotoDirectory(directory)
                    .catch(error => showError('Opening the folder failed', error))}/>
        </Menu>,
        { left: event.clientX, top: event.clientY }, undefined, true,
    )
}
