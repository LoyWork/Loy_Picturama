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
const savingEdits = new Map<string, Promise<boolean>>()

function photoKey(photo: Photo) { return `${photo.masterDir}/${photo.masterFilename}` }

/** Merge both kinds of live edit into one sidecar write per photo and gesture. */
function queueEdit(photo: Photo, change: Pick<PendingEdit, 'colorGrading' | 'develop'>) {
    const photoPath = photoKey(photo)
    const pending: PendingEdit = pendingEdits.get(photoPath) || { photo }
    Object.assign(pending, change)
    if ('develop' in change && change.develop?.grading) {
        pending.colorGrading = change.develop.grading
    } else if ('colorGrading' in change && pending.develop) {
        pending.develop = { ...pending.develop, grading: change.colorGrading || undefined }
    }
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => { void commitEdit(photoPath, pending) }, 300)
    pendingEdits.set(photoPath, pending)
}

function commitEdit(photoPath: string, pending: PendingEdit): Promise<boolean> {
    clearTimeout(pending.timer)
    pendingEdits.delete(photoPath)
    const previous = savingEdits.get(photoPath)
    const write = () => updatePhotoWork(pending.photo, photoWork => {
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
    const saving = (previous ? previous.then(write) : Promise.resolve(write()))
        .then(result => result !== false).catch(() => false)
    savingEdits.set(photoPath, saving)
    void saving.then(saved => {
        if (!saved && !pendingEdits.has(photoPath)) pendingEdits.set(photoPath, pending)
        if (savingEdits.get(photoPath) === saving) savingEdits.delete(photoPath)
    })
    return saving
}

/** Flush the latest gesture and wait for its sidecar and thumbnail writes to finish. */
export function savePhotoGrading(photo: Photo): Promise<boolean> {
    const key = photoKey(photo)
    const pending = pendingEdits.get(key)
    return pending ? commitEdit(key, pending) : (savingEdits.get(key) || Promise.resolve(true))
}

export function updatePhotoWorkColorGrading(photo: Photo, colorGrading: ColorGrading | null) {
    queueEdit(photo, { colorGrading })
}

export function updatePhotoWorkDevelop(photo: Photo, develop: DevelopSettings | null) {
    queueEdit(photo, { develop })
}
