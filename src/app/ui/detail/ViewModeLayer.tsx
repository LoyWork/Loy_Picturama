import classnames from 'classnames'
import React from 'react'
import { Button, ButtonGroup, MaybeElement } from '@blueprintjs/core'
import { FaArrowLeft, FaArrowRight, FaChevronLeft, FaCrop } from 'react-icons/fa'

import { Command, getCommandButtonProps, CommandGroupId, addCommandGroup, setCommandGroupEnabled, removeCommandGroup } from 'app/controller/HotkeyController'
import { msg } from 'app/i18n/i18n'
import Toolbar from 'app/ui/widget/Toolbar'
import { CameraMetrics, RequestedPhotoPosition } from 'app/util/CameraMetrics'
import { canZoomPhoto, getZoomSliderValue, getSliderPhotoPosition } from 'app/util/PhotoZoomUtil'
import { bindMany } from 'app/util/LangUtil'

import ViewModeOverlay from './ViewModeOverlay'


export interface Props {
    topBarClassName: string
    bodyClassName: string
    isTopBarRight: boolean
    topBarRightItem?: MaybeElement
    bottomBarActions?: MaybeElement
    isActive: boolean
    isFirst: boolean
    isLast: boolean
    cameraMetrics: CameraMetrics | null
    setPreviousDetailPhoto: () => void
    setNextDetailPhoto: () => void
    setPhotoPosition(photoPosition: RequestedPhotoPosition): void
    enterCropMode(): void
    closeDetail(): void
}

type CommandKeys = 'close' | 'prevPhoto' | 'nextPhoto' | 'edit'

export default class ViewModeLayer extends React.Component<Props> {

    private commands: { [K in CommandKeys]: Command }
    private commandGroupId: CommandGroupId = -1

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onZoomSliderChange')

        this.commands = {
            close: { combo: 'esc', label: msg('common_backToLibrary'), onAction: props.closeDetail },
            prevPhoto: { combo: 'left', enabled: () => !this.props.isFirst, label: msg('PhotoDetailPane_prevPhoto'), onAction: props.setPreviousDetailPhoto },
            nextPhoto: { combo: 'right', enabled: () => !this.props.isLast, label: msg('PhotoDetailPane_nextPhoto'), onAction: props.setNextDetailPhoto },
            edit: { combo: 'enter', enabled: () => !!this.props.cameraMetrics, label: msg('PhotoDetailPane_edit'), onAction: props.enterCropMode },
        }
    }

    componentDidMount() {
        this.commandGroupId = addCommandGroup(this.commands, this.props.isActive)
    }

    componentDidUpdate(prevProps: Props) {
        const { props } = this
        if (props.isActive !== prevProps.isActive) {
            setCommandGroupEnabled(this.commandGroupId, props.isActive)
        }
    }

    componentWillUnmount() {
        removeCommandGroup(this.commandGroupId)
    }

    private onZoomSliderChange(sliderScale: number) {
        const { cameraMetrics } = this.props
        if (!cameraMetrics) {
            return
        }

        this.props.setPhotoPosition(getSliderPhotoPosition(cameraMetrics, sliderScale))
    }

    render() {
        const { props, commands } = this
        const { cameraMetrics } = props

        const zoomSliderValue = getZoomSliderValue(cameraMetrics)
        const canZoom = canZoomPhoto(cameraMetrics)
        let zoomSliderLabel = '—'
        if (cameraMetrics) {
            const zoom = cameraMetrics.photoPosition.zoom
            zoomSliderLabel = `${Math.round(zoom / cameraMetrics.minZoom * 100)}%`
        }

        return (
            <>
                <Toolbar
                    className={classnames(props.topBarClassName, 'ViewModeLayer-toolbar')}
                    isTopBar={true}
                    isLeft={true}
                    isRight={props.isTopBarRight}
                >
                    <Button {...getCommandButtonProps(commands.close)}>
                        <FaChevronLeft/>
                        <span>{commands.close.label}</span>
                    </Button>
                    <ButtonGroup>
                        <Button minimal={true} {...getCommandButtonProps(commands.prevPhoto)}>
                            <FaArrowLeft/>
                        </Button>
                        <Button minimal={true} {...getCommandButtonProps(commands.nextPhoto)}>
                            <FaArrowRight/>
                        </Button>
                    </ButtonGroup>
                    <Toolbar.Spacer isTopBar/>
                    {props.topBarRightItem}
                </Toolbar>
                <Toolbar className='PhotoDetailPane-bottomBar' isTopBar={false}>
                    <div className='PhotoDetailPane-zoomPane'>
                        <Button minimal icon='zoom-out' aria-label='−' disabled={!canZoom || zoomSliderValue === 0}
                            onClick={() => this.onZoomSliderChange(Math.max(0, zoomSliderValue - 0.1))}/>
                        <input type='range' className='PhotoDetailPane-zoomSlider'
                            aria-label={msg('PhotoDetailPane_zoom')}
                            disabled={!canZoom}
                            value={Math.round(zoomSliderValue * 100)}
                            min={0}
                            max={100}
                            step={1}
                            onChange={event => this.onZoomSliderChange(Number(event.currentTarget.value) / 100)}
                        />
                        <Button minimal icon='zoom-in' aria-label='+' disabled={!canZoom || zoomSliderValue === 1}
                            onClick={() => this.onZoomSliderChange(Math.min(1, zoomSliderValue + 0.1))}/>
                        <Button minimal className='PhotoDetailPane-zoomValue' disabled={!cameraMetrics}
                            title={msg('PhotoDetailPane_fit')} aria-label={msg('PhotoDetailPane_fit')}
                            onClick={() => props.setPhotoPosition('contain')}>{zoomSliderLabel}</Button>
                    </div>
                    <div className='PhotoDetailPane-photoActions'>
                        <Button minimal={true} aria-label={commands.edit.label} {...getCommandButtonProps(commands.edit)}>
                            <FaCrop/>
                            <span className='PhotoDetailPane-editLabel'>{msg('PhotoDetailPane_edit')}</span>
                        </Button>
                        {props.bottomBarActions}
                    </div>
                </Toolbar>
                <ViewModeOverlay
                    className={classnames(props.bodyClassName, 'ViewModeLayer-body')}
                    cameraMetrics={props.cameraMetrics}
                    setPhotoPosition={props.setPhotoPosition}
                />
            </>
        )
    }

}
