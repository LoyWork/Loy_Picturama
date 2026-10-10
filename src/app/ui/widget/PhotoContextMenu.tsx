import { ContextMenu, Menu, MenuDivider, MenuItem } from '@blueprintjs/core'
import classNames from 'classnames'
import React from 'react'
import { FaFolderOpen, FaRegCopy, FaTrashAlt } from 'react-icons/fa'

import { Photo, PhotoRenderOptions } from 'app/CommonTypes'
import { PhotoActionController } from 'app/controller/PhotoActionController'
import BackgroundClient from 'app/BackgroundClient'
import { showError } from 'app/ErrorPresenter'
import { msg } from 'app/i18n/i18n'
import store from 'app/state/store'
import { copyImageToClipboard, getMasterPath } from 'app/util/DataUtil'
import { renderPhoto } from 'app/renderer/PhotoRenderer'


/** The options for a clipboard copy: PNG at full detail, capped so huge photos stay manageable. */
const copyRenderOptions: PhotoRenderOptions = { format: 'png', quality: 1 }
const copyMaxSize = { width: 2048, height: 2048 }

async function copyPhotoToClipboard(photo: Photo) {
    try {
        const photoWork = await BackgroundClient.fetchPhotoWorkOfPhoto(photo)
        const binary = await renderPhoto(photo, photoWork, copyMaxSize, copyRenderOptions)
        await copyImageToClipboard(binary)
    } catch (error) {
        showError('Copying photo to clipboard failed', error)
    }
}


/**
 * The context menu shown when the user right-clicks a photo thumbnail. Rendered imperatively via
 * Blueprint's ContextMenu.show — Picture does not need to become a ContextMenuTarget component for
 * this.
 *
 * @param isShowingTrash whether the trash filter is active: there the "delete from library" entry is
 *     hidden (the photos are already out of the library view) and "delete from disk" is the primary
 *     action.
 */
export function showPhotoContextMenu(photo: Photo, isShowingTrash: boolean,
    photoActionController: PhotoActionController, event: MouseEvent)
{
    event.preventDefault()
    event.stopPropagation()

    const menu = (
        <Menu className={classNames('PhotoContextMenu', 'bp3-dark')}>
            <MenuItem
                icon={<FaRegCopy/>}
                text={msg('PictureMenu_copyImage')}
                onClick={() => copyPhotoToClipboard(photo)}
            />
            {!isShowingTrash &&
                <>
                    <MenuDivider/>
                    <MenuItem
                        icon={<FaTrashAlt/>}
                        text={msg('PictureMenu_moveToTrash')}
                        onClick={() => photoActionController.movePhotosToTrash(photo)}
                    />
                </>
            }
            <MenuItem
                icon={<FaTrashAlt/>}
                text={msg('PictureMenu_deleteFromDisk')}
                intent='danger'
                onClick={() => photoActionController.requestDeleteFromDisk(photo)}
            />
            <MenuDivider/>
            <MenuItem
                icon={<FaFolderOpen/>}
                text={msg('PictureMenu_showInFolder')}
                onClick={() => {
                    BackgroundClient.showItemInFolder(getMasterPath(photo))
                        .catch(error => showError('Opening the folder failed', error))
                }}
            />
        </Menu>
    )

    ContextMenu.show(menu, { left: event.clientX, top: event.clientY }, () => {
        // onClose — nothing to clean up
    }, store.getState().data.uiConfig.platform !== undefined)
}
