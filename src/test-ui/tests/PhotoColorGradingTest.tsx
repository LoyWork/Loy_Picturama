import React from 'react'

import { ColorGrading, Photo } from 'app/CommonTypes'

import PhotoColorGrading, { Props } from 'app/ui/grading/PhotoColorGrading'

import { addSection, action, TestContext } from 'test-ui/core/UiTester'
import { testBigPhoto } from 'test-ui/util/MockData'


const baseUrl = 'dist'

let sharedGrading: ColorGrading | null = null

function createDefaultProps(context: TestContext): Props {
    return {
        style: { width: '300px', height: '100%' },

        isActive: true,
        photo: { ...testBigPhoto, masterDir: `${baseUrl}/${testBigPhoto.masterDir}` } as Photo,
        colorGrading: sharedGrading,
        develop: context.state.develop || null,
        onDevelopChange: develop => {
            context.state.develop = develop
            context.forceUpdate()
        },
        closeGrading: action('closeGrading'),
        onColorGradingChange: (colorGrading: ColorGrading | null) => {
            sharedGrading = colorGrading
            context.forceUpdate()
        },
    }
}


addSection('PhotoColorGrading')
    .add('normal', context => (
        <PhotoColorGrading
            {...createDefaultProps(context)}
        />
    ))
    .add('warm shadows and cool highlights', context => (
        <PhotoColorGrading
            {...createDefaultProps(context)}
            colorGrading={{
                shadows: { hue: 220, sat: 45, lum: -10 },
                midtones: { hue: 0, sat: 0, lum: 0 },
                highlights: { hue: 45, sat: 35, lum: 5 },
                blending: 50,
                balance: 0,
            }}
        />
    ))
    .add('teal and orange', context => (
        <PhotoColorGrading
            {...createDefaultProps(context)}
            colorGrading={{
                shadows: { hue: 195, sat: 60, lum: 0 },
                highlights: { hue: 30, sat: 55, lum: 0 },
            }}
        />
    ))
    .add('no photo', context => (
        <PhotoColorGrading
            {...createDefaultProps(context)}
            photo={undefined}
        />
    ))
    .add('not active', context => (
        <PhotoColorGrading
            {...createDefaultProps(context)}
            isActive={false}
        />
    ))
