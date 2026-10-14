import { Photo, PhotoId, PhotoSectionId } from 'app/CommonTypes'
import { PhotoCollection } from 'app/state/StateTypes'
import { getFirstPhotoOfCollection } from 'app/util/PhotoCollectionResolver'

jest.mock('app/controller/LibraryController', () => ({ fetchSectionPhotos: jest.fn() }))
jest.mock('app/state/selectors', () => ({ getSectionSelections: jest.fn() }))
jest.mock('app/state/store', () => ({ __esModule: true, default: { getState: () => mockState } }))

const first = { id: 1 as PhotoId, masterDir: 'photos', masterFilename: 'first.jpg' } as Photo
const second = { ...first, id: 2 as PhotoId, masterFilename: 'second.jpg' }
const sectionId = 'first-section' as PhotoSectionId
const mockState = { data: { sections: {
    ids: [sectionId],
    byId: { [sectionId]: { photoIds: [first.id, second.id], photoData: { [first.id]: first, [second.id]: second } } }
} } }

test('a copied photo can still resolve the library section for the grading entry', () => {
    expect(getFirstPhotoOfCollection({ ...first })).toEqual({ photo: first, sectionId })
})

test('multiple selected photos open the first in library order', () => {
    const selection = { totalSelectedCount: 2, sectionSelectionById: {
        [sectionId]: { sectionId, selectedCount: 2, selectedPhotosById: { [second.id]: true, [first.id]: true } }
    } } as PhotoCollection
    expect(getFirstPhotoOfCollection(selection)).toEqual({ photo: first, sectionId })
})

test('select all resolves the first photo and an empty selection cannot open grading', () => {
    expect(getFirstPhotoOfCollection({ totalSelectedCount: 2, sectionSelectionById: {
        [sectionId]: { sectionId, selectedCount: 2, selectedPhotosById: 'all' }
    } })).toEqual({ photo: first, sectionId })
    expect(getFirstPhotoOfCollection(null)).toBeNull()
    expect(getFirstPhotoOfCollection([])).toBeNull()
})
