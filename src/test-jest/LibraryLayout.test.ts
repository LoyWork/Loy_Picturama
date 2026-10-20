import { LoadedPhotoSection, Photo, PhotoId, PhotoSectionById, PhotoSectionId } from 'app/CommonTypes'
import { getGridLayoutWithoutStoreUpdate as layout, getGridLayoutAndUpdateStore } from 'app/controller/LibraryController'
import BackgroundClient from 'app/BackgroundClient'
import { GridLayout } from 'app/UITypes'

jest.mock('app/BackgroundClient', () => ({ __esModule: true, default: { fetchSectionPhotos: jest.fn() } }))
jest.mock('app/ErrorPresenter', () => ({ showError: jest.fn() }))
jest.mock('app/ui/library/GridSection', () => ({ sectionHeadHeight: 60 }))
jest.mock('app/controller/PhotoController', () => ({ getThumbnailSrc: jest.fn() }))
jest.mock('app/util/CancelablePromise', () => ({ __esModule: true, default: jest.fn(), isCancelError: jest.fn() }))
jest.mock('app/util/SerialJobQueue', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('app/util/Profiler', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('app/state/store', () => ({ __esModule: true, default: {
    dispatch: jest.fn(), getState: () => ({ library: { filter: {} }, info: {} }),
} }))

function library(count: number, photosPerSection = 10, loaded = false) {
    const ids = Array.from({ length: count }, (_, i) => `section-${i}` as PhotoSectionId)
    const sections: PhotoSectionById = {}
    ids.forEach((id, i) => {
        const section = { id, title: id, count: photosPerSection }
        if (loaded) {
            const photoIds = Array.from({ length: photosPerSection }, (_, n) => (i * photosPerSection + n + 1) as PhotoId)
            const photoData = Object.fromEntries(photoIds.map((photoId, n) => [photoId, {
                id: photoId, editedWidth: n % 3 === 0 ? 800 : 1200, editedHeight: 800,
            } as Photo]))
            sections[id] = { ...section, photoIds, photoData } as LoadedPhotoSection
        } else sections[id] = section
    })
    return { ids, sections }
}

function expectVisiblePhotosCovered(grid: GridLayout, top: number, height: number) {
    grid.sectionLayouts.forEach((section, i) => {
        section.boxes?.forEach((box, j) => {
            const boxTop = section.top + 60 + box.top
            if (boxTop <= top + height && boxTop + box.height >= top) {
                expect(i).toBeGreaterThanOrEqual(grid.fromSectionIndex)
                expect(i).toBeLessThan(grid.toSectionIndex)
                expect(j).toBeGreaterThanOrEqual(section.fromBoxIndex!)
                expect(j).toBeLessThan(section.toBoxIndex!)
            }
        })
    })
}

test('large libraries reuse geometry and only visit the window while scrolling', () => {
    const { ids, sections } = library(10000)
    const first = layout(ids, sections, 0, 1200, 800, 200, null)
    let sectionReads = 0
    const countedIds = new Proxy(ids, { get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) sectionReads++
        return Reflect.get(target, key, receiver)
    } })
    const initial = layout(countedIds, sections, 0, 1200, 800, 200, null)
    sectionReads = 0
    const scrolled = layout(countedIds, sections, 300000, 1200, 800, 200, null)
    expect(scrolled.sectionLayouts).toBe(initial.sectionLayouts)
    expect(scrolled.fromSectionIndex).toBeGreaterThan(100)
    expect(sectionReads).toBeLessThan(30)
    expect(scrolled.toSectionIndex - scrolled.fromSectionIndex).toBeLessThan(20)
    expect(first.sectionLayouts.length).toBe(10000)
})

test('a huge single day mounts about two screens and covers visible photos after jumps in both directions', () => {
    const { ids, sections } = library(1, 10000, true)
    let grid = layout(ids, sections, 0, 1200, 800, 200, null)
    const geometry = grid.sectionLayouts
    for (const top of [15000, 300000, 1000, 0]) {
        grid = layout(ids, sections, top, 1200, 800, 200, null)
        expect(grid.sectionLayouts).toBe(geometry)
        const section = grid.sectionLayouts[0]
        expect(section.toBoxIndex! - section.fromBoxIndex!).toBeLessThan(70)
        expectVisiblePhotosCovered(grid, top, 800)
    }
})

test('shared rows, resized geometry, photo edits and empty filters retain correct visible bounds', () => {
    const { ids, sections } = library(40, 1, true)
    let grid = layout(ids, sections, 1000, 1200, 800, 200, null)
    expectVisiblePhotosCovered(grid, 1000, 800)
    const previous = grid
    grid = layout(ids, sections, 1000, 750, 800, 200, { positions: [] })
    expect(grid.fromSectionIndex).toBe(previous.fromSectionIndex)
    expect(grid.toSectionIndex).toBe(previous.toSectionIndex)
    grid = layout(ids, sections, 1000, 750, 800, 200, null)
    expect(grid.sectionLayouts).not.toBe(previous.sectionLayouts)
    expectVisiblePhotosCovered(grid, 1000, 800)
    const edited = { ...sections }
    const section = sections[ids[0]] as LoadedPhotoSection
    const photoId = section.photoIds[0]
    edited[ids[0]] = { ...section, photoData: { ...section.photoData,
        [photoId]: { ...section.photoData[photoId], editedWidth: 4000 } } }
    const updated = layout(ids, edited, 0, 750, 1200, 260, null)
    expect(updated.sectionLayouts).not.toBe(grid.sectionLayouts)
    expectVisiblePhotosCovered(updated, 0, 1200)
    expect(layout([], {}, 0, 750, 800, 200, null)).toMatchObject({
        fromSectionIndex: 0, toSectionIndex: 0, sectionLayouts: [],
    })
})

test('short windows keep the next row mounted for keyboard navigation', () => {
    const { ids, sections } = library(1, 30, true)
    const grid = layout(ids, sections, 0, 1200, 150, 500, null)
    const section = grid.sectionLayouts[0]
    const firstTop = section.boxes![0].top
    const nextRow = section.boxes!.findIndex(box => box.top > firstTop)
    expect(nextRow).toBeGreaterThan(0)
    expect(section.toBoxIndex).toBeGreaterThan(nextRow)
})

test('data preloading extends beyond mounted photos and follows upward scrolling', async () => {
    const { ids, sections } = library(100)
    jest.mocked(BackgroundClient.fetchSectionPhotos).mockResolvedValue([])
    const first = getGridLayoutAndUpdateStore(ids, sections, 10000, 1200, 800, 200, null)
    const downIds = jest.mocked(BackgroundClient.fetchSectionPhotos).mock.calls.slice(-1)[0][0]
    expect(downIds.length).toBeGreaterThan(first.toSectionIndex - first.fromSectionIndex)
    await new Promise(resolve => setTimeout(resolve, 0))
    const next = getGridLayoutAndUpdateStore(ids, sections, 9000, 1200, 800, 200, null)
    const upIds = jest.mocked(BackgroundClient.fetchSectionPhotos).mock.calls.slice(-1)[0][0]
    expect(ids.indexOf(upIds[0])).toBeLessThan(next.fromSectionIndex)
    await new Promise(resolve => setTimeout(resolve, 0))
    getGridLayoutAndUpdateStore(ids, sections, 9000, 1200, 800, 200, null)
    expect(jest.mocked(BackgroundClient.fetchSectionPhotos).mock.calls.slice(-1)[0][0]).toEqual(upIds)
    await new Promise(resolve => setTimeout(resolve, 0))
})
