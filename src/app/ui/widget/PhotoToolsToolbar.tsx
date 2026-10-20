import React from 'react'
import classNames from 'classnames'
import { Button } from '@blueprintjs/core'
import { FiInfo, FiSliders } from 'react-icons/fi'

import { msg } from 'app/i18n/i18n'
import './PhotoToolsToolbar.less'
import './PhotoControl.less'

interface Props {
    className?: string
    showInfo: boolean
    showGrading: boolean
    canGrade: boolean
    disabled?: boolean
    toggleShowInfo(): void
    toggleShowGrading(): void
}

export default function PhotoToolsToolbar(props: Props) {
    const gradingLabel = msg('PhotoActionButtons_colorGrading')
    const infoLabel = msg('PhotoActionButtons_photoInfo')
    return (
        <div className={classNames('PhotoToolsToolbar', props.className)} role='toolbar' aria-orientation='vertical' aria-label={`${gradingLabel} / ${infoLabel}`}>
            <Button className='PhotoControl' minimal icon={<FiSliders aria-hidden='true'/>} active={props.showGrading}
                disabled={props.disabled || !props.canGrade}
                title={`${gradingLabel} (G)`} aria-label={gradingLabel} aria-pressed={props.showGrading}
                onClick={props.toggleShowGrading}/>
            <div className='PhotoToolsToolbar-spacer'/>
            <Button className='PhotoControl' minimal icon={<FiInfo aria-hidden='true'/>} active={props.showInfo} disabled={props.disabled}
                title={`${infoLabel} (I)`} aria-label={infoLabel} aria-pressed={props.showInfo}
                onClick={props.toggleShowInfo}/>
        </div>
    )
}
