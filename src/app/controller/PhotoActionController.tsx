import { Photo, PhotoWork } from 'app/CommonTypes'
import { rotatePhotos, setPhotosFlagged, movePhotosToTrash, restorePhotosFromTrash, updatePhotoWork, deletePhotosFromLibrary, deletePhotosFromDisk } from 'app/controller/PhotoController'
import { openExportAction } from 'app/state/actions'
import { PhotoCollection } from 'app/state/StateTypes'
import store from 'app/state/store'
import { walkLoadedPhotosOfCollection } from 'app/util/PhotoCollectionResolver'


export interface PhotoActionController {
    /**
     * Returns whether all photos of a collection are flagged.
     * This will only consider the first 1000 photos of loaded sections
     */
    getPhotosAreFlagged(photos: PhotoCollection | null | undefined): boolean
    openExport(photos: PhotoCollection): void
    updatePhotoWork(photo: Photo, update: (photoWork: PhotoWork) => void): void
    rotatePhotos(photos: PhotoCollection, turns: number): void
    setPhotosFlagged(photos: PhotoCollection, flag: boolean): void
    movePhotosToTrash(photos: PhotoCollection): void
    restorePhotosFromTrash(photos: PhotoCollection): void
    /** Asks the user for confirmation, then deletes the photos from disk (system trash) and library. */
    requestDeleteFromDisk(photos: PhotoCollection): void
}


const maxCheckedPhotoCount = 1000


export const defaultPhotoActionController: PhotoActionController = {
    getPhotosAreFlagged(photos: PhotoCollection | null | undefined): boolean {
        let result = true
        if (photos) {
            let checkedPhotoCount = 0
            walkLoadedPhotosOfCollection(photos,
                photo => {
                    if (!photo.flag) {
                        result = false
                        return false
                    } else {
                        checkedPhotoCount++
                        return checkedPhotoCount < maxCheckedPhotoCount
                    }
                })
        }

        return result
    },
    openExport(photos: PhotoCollection) {
        store.dispatch(openExportAction(photos))
    },
    updatePhotoWork,
    rotatePhotos,
    setPhotosFlagged,
    movePhotosToTrash,
    restorePhotosFromTrash,
    requestDeleteFromDisk(photos: PhotoCollection) {
        requestDeleteConfirmation(photos)
    },
}


// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

import React from 'react'
import ReactDOM from 'react-dom'
import { Alert } from '@blueprintjs/core'
import { msg } from 'app/i18n/i18n'
import { getPhotosOfCollection } from 'app/util/PhotoCollectionResolver'
import { deletePhotosFromDisk as doDeleteFromDisk } from 'app/controller/PhotoController'

/**
 * A singleton confirm dialog for the disk-delete action, rendered once below the app tree (like the
 * Toaster). The PhotoActionController methods are called from non-component code (the context menu),
 * so the Alert cannot live in the component tree of the caller.
 */
class DeleteConfirmationController {

    private container: HTMLDivElement | null = null
    private photos: Photo[] | null = null
    private listeners: Array<() => void> = []

    private ensureContainer() {
        if (!this.container) {
            this.container = document.createElement('div')
            document.body.appendChild(this.container)
            this.render()
        }
    }

    private request(photos: PhotoCollection) {
        this.ensureContainer()
        getPhotosOfCollection(photos)
            .then(resolved => {
                this.photos = resolved
                this.emitChange()
            })
            .catch(error => showErrorToast(error))
    }

    private onConfirm = () => {
        const { photos } = this
        this.photos = null
        this.emitChange()
        if (photos && photos.length > 0) {
            doDeleteFromDisk(photos)
        }
    }

    private onCancel = () => {
        this.photos = null
        this.emitChange()
    }

    private emitChange() {
        for (const listener of this.listeners) {
            listener()
        }
        this.render()
    }

    subscribe(listener: () => void): () => void {
        this.listeners.push(listener)
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener)
        }
    }

    private render() {
        if (!this.container) {
            return
        }
        const count = this.photos ? this.photos.length : 0
        const question = (count === 1)
            ? msg('PhotoDelete_confirmDisk_one')
            : msg('PhotoDelete_confirmDisk_more', count)
        const element = (
            <Alert
                className='bp3-dark'
                isOpen={count > 0}
                icon='trash'
                intent='danger'
                cancelButtonText={msg('common_cancel')}
                confirmButtonText={msg('PictureMenu_deleteFromDisk')}
                onCancel={this.onCancel}
                onConfirm={this.onConfirm}
            >
                {question}
            </Alert>
        )
        ReactDOM.render(element, this.container)
    }
}

function showErrorToast(error: any) {
    // Lazy import avoids a module-initialisation cycle with ErrorPresenter.
    import('app/ErrorPresenter').then(m => m.showError('Preparing delete failed', error))
}

const deleteConfirmationController = new DeleteConfirmationController()

function requestDeleteConfirmation(photos: PhotoCollection) {
    deleteConfirmationController.request(photos)
}
