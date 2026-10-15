import React from 'react'
import { ContextMenu } from '@blueprintjs/core'
import BackgroundClient from 'app/BackgroundClient'
import { showFolderContextMenu } from 'app/ui/widget/FolderContextMenu'

jest.mock('@blueprintjs/core', () => ({ ContextMenu: { show: jest.fn() }, Menu: 'menu', MenuItem: 'menuitem' }))
jest.mock('app/BackgroundClient', () => ({ __esModule: true, default: { openPhotoDirectory: jest.fn(() => Promise.resolve()) } }))
jest.mock('app/ErrorPresenter', () => ({ showError: jest.fn() }))
jest.mock('app/i18n/i18n', () => ({ msg: (key: string) => key }))

test('folder right-click blocks the webview menu and offers only opening the exact folder', () => {
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn(), clientX: 30, clientY: 60 } as unknown as React.MouseEvent
    const directory = 'D:/photos/旅行/Texture2D'
    showFolderContextMenu(directory, event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    const menu = jest.mocked(ContextMenu.show).mock.calls[0][0] as React.ReactElement
    const entries = React.Children.toArray(menu.props.children) as React.ReactElement[]
    expect(entries).toHaveLength(1)
    expect(entries[0].props.text).toBe('FolderSidebar_openInExplorer')
    entries[0].props.onClick()
    expect(BackgroundClient.openPhotoDirectory).toHaveBeenCalledWith(directory)
})
