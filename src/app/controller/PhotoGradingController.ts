import { ColorGrading, DevelopSettings, Photo } from 'app/CommonTypes'
import { updatePhotoWork } from 'app/controller/PhotoController'
import { isDevelopNeutral } from 'app/util/DevelopUtil'

interface PendingEdit {
    photo: Photo
    colorGrading?: ColorGrading | null
    develop?: DevelopSettings | null
    timer?: ReturnType<typeof setTimeout>
}

const pendingEdits = new Map<string, PendingEdit>()

/** Merge both kinds of live edit into one sidecar write per photo and gesture. */
function queueEdit(photo: Photo, change: Pick<PendingEdit, 'colorGrading' | 'develop'>) {
    const photoPath = `${photo.masterDir}/${photo.masterFilename}`
    const pending: PendingEdit = pendingEdits.get(photoPath) || { photo }
    Object.assign(pending, change)
    if ('develop' in change && change.develop?.grading) {
        pending.colorGrading = change.develop.grading
    } else if ('colorGrading' in change && pending.develop) {
        pending.develop = { ...pending.develop, grading: change.colorGrading || undefined }
    }
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
        pendingEdits.delete(photoPath)
        updatePhotoWork(pending.photo, photoWork => {
            if ('develop' in pending) {
                if (pending.develop && !isDevelopNeutral(pending.develop)) {
                    photoWork.develop = pending.develop
                } else {
                    delete photoWork.develop
                }
            }
            if ('colorGrading' in pending) {
                if (pending.colorGrading) {
                    photoWork.colorGrading = pending.colorGrading
                } else {
                    delete photoWork.colorGrading
                }
                if (photoWork.develop) {
                    const develop = { ...photoWork.develop }
                    if (pending.colorGrading) {
                        develop.grading = pending.colorGrading
                    } else {
                        delete develop.grading
                    }
                    if (isDevelopNeutral(develop)) {
                        delete photoWork.develop
                    } else {
                        photoWork.develop = develop
                    }
                }
            }
        }, true)
    }, 300)
    pendingEdits.set(photoPath, pending)
}

export function updatePhotoWorkColorGrading(photo: Photo, colorGrading: ColorGrading | null) {
    queueEdit(photo, { colorGrading })
}

export function updatePhotoWorkDevelop(photo: Photo, develop: DevelopSettings | null) {
    queueEdit(photo, { develop })
}
