import { Photo, PhotoWork } from 'app/CommonTypes'
import { updatePhotoWork } from 'app/controller/PhotoController'
import { updatePhotoWorkColorGrading, updatePhotoWorkDevelop, savePhotoGrading } from 'app/controller/PhotoGradingController'

jest.mock('app/controller/PhotoController', () => ({ updatePhotoWork: jest.fn() }))
const save = jest.mocked(updatePhotoWork)
const photo = { masterDir: 'photos', masterFilename: 'first.jpg' } as Photo
const grading = { shadows: { hue: 30, sat: 20 } }

beforeEach(() => { jest.useFakeTimers(); save.mockClear(); save.mockResolvedValue(true) })
afterEach(async () => { jest.runOnlyPendingTimers(); await savePhotoGrading(photo); jest.useRealTimers() })

function savedWork(initial: PhotoWork = {}): PhotoWork {
    expect(save).toHaveBeenCalledTimes(1)
    save.mock.calls[0][1](initial)
    return initial
}

test('a wheel edit and slider edit in one gesture both survive the debounce', () => {
    updatePhotoWorkColorGrading(photo, grading)
    updatePhotoWorkDevelop(photo, { light: { exposure: 1 } })
    expect(save).not.toHaveBeenCalled()
    jest.advanceTimersByTime(300)
    expect(savedWork()).toEqual({ colorGrading: grading, develop: { light: { exposure: 1 }, grading } })
})

test('wheel changes replace stale develop grading without dropping exposure', () => {
    updatePhotoWorkDevelop(photo, { light: { exposure: 2 }, grading: { shadows: { sat: 5 } } })
    updatePhotoWorkColorGrading(photo, grading)
    jest.advanceTimersByTime(300)
    expect(savedWork()).toEqual({ colorGrading: grading, develop: { light: { exposure: 2 }, grading } })
})

test('reset clears both fields even when an edit was waiting to save', () => {
    updatePhotoWorkColorGrading(photo, grading)
    updatePhotoWorkColorGrading(photo, null)
    updatePhotoWorkDevelop(photo, null)
    jest.advanceTimersByTime(300)
    expect(savedWork({ colorGrading: grading, develop: { grading }, rotationTurns: 1 })).toEqual({ rotationTurns: 1 })
})

test('grading-only develop settings are persisted', () => {
    updatePhotoWorkDevelop(photo, { grading })
    jest.advanceTimersByTime(300)
    expect(savedWork()).toEqual({ colorGrading: grading, develop: { grading } })
})

test('Save flushes a pending gesture immediately and waits for persistence', async () => {
    let finish!: (saved: boolean) => void
    save.mockReturnValueOnce(new Promise<boolean>(resolve => { finish = resolve }))
    updatePhotoWorkDevelop(photo, { light: { exposure: 2 } })
    let confirmed = false
    const completion = savePhotoGrading(photo).then(saved => { confirmed = saved })
    expect(savedWork()).toEqual({ develop: { light: { exposure: 2 } } })
    await Promise.resolve()
    expect(confirmed).toBe(false)
    finish(true)
    await completion
    expect(confirmed).toBe(true)
    jest.advanceTimersByTime(300)
    expect(save).toHaveBeenCalledTimes(1)
})

test('a failed Save can retry the same edit', async () => {
    save.mockResolvedValueOnce(false)
    updatePhotoWorkDevelop(photo, { light: { exposure: 1 } })
    expect(await savePhotoGrading(photo)).toBe(false)
    expect(await savePhotoGrading(photo)).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
})

test('edits to different photos save independently and use the last slider value', () => {
    updatePhotoWorkDevelop(photo, { light: { exposure: 1 } })
    jest.advanceTimersByTime(200)
    updatePhotoWorkDevelop(photo, { light: { exposure: 2 } })
    updatePhotoWorkColorGrading({ ...photo, masterFilename: 'second.jpg' }, grading)
    jest.advanceTimersByTime(300)
    expect(save).toHaveBeenCalledTimes(2)
    const results = save.mock.calls.map(([p, apply]) => {
        const work: PhotoWork = {}; apply(work); return { name: p.masterFilename, work }
    })
    expect(results).toContainEqual({ name: 'first.jpg', work: { develop: { light: { exposure: 2 } } } })
    expect(results).toContainEqual({ name: 'second.jpg', work: { colorGrading: grading } })
})
