import { setShowInfoAction } from 'app/state/actions'
import { info } from 'app/state/reducers/info'
import { InfoState, LibraryState } from 'app/state/StateTypes'

const initial: InfoState = { showInLibrary: false, showInDetail: false, showGradingInDetail: true }
const library = {} as LibraryState

test('opening information in the library carries the same open panel into detail', () => {
    expect(info(initial, library, setShowInfoAction('library', true))).toEqual({
        ...initial, showInLibrary: true, showInDetail: true
    })
})

test('closing information in detail also closes it on return to the library', () => {
    const opened = { ...initial, showInLibrary: true, showInDetail: true }
    expect(info(opened, library, setShowInfoAction('detail', false))).toEqual(initial)
})
