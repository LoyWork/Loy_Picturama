import React from 'react'

import {addSection, action} from 'test-ui/core/UiTester'

import { SettingsPane, Props } from 'app/ui/SettingsPane'


const defaultProps: Props = {
    style: { width: '100%', height: '100%' },
    settings: {
        photoDirs: [ '/Users/me/Documents/Photos', '/Users/me/ownCloud/Photos' ],
    },
    selectDirectories: () => Promise.resolve([ '/Users/me/Dropbox/Photos' ]),
    onSettingsChange: action('onSettingsChange'),
    onClose: action('onClose'),
}


addSection('Settings')
    .add('first start', context => (
        <SettingsPane
            {...defaultProps}
            settings={{ photoDirs: [] }}
        />
    ))
    .add('normal', context => (
        <SettingsPane
            {...defaultProps}
        />
    ))
    .add('many photo folders', context => (
        <SettingsPane
            {...defaultProps}
            settings={{
                photoDirs: Array.from({ length: 20 }, (_, index) =>
                    `/Users/me/Pictures/Photo collection ${index + 1}`),
            }}
        />
    ))
