import React from 'react'
import { Button, Classes } from '@blueprintjs/core'
import { FiInfo, FiSliders } from 'react-icons/fi'


import { addCommandGroup, Command, CommandGroupId, formatCommandLabel, getCommandButtonProps, removeCommandGroup, setCommandGroupEnabled } from 'app/controller/HotkeyController'
import { PhotoActionController } from 'app/controller/PhotoActionController'
import { msg } from 'app/i18n/i18n'
import { PhotoCollection } from 'app/state/StateTypes'
import toaster from 'app/Toaster'
import MdRestoreFromTrash from 'app/ui/widget/icon/MdRestoreFromTrash'
import { bindMany } from 'app/util/LangUtil'
import { getCollectionSize } from 'app/util/PhotoCollectionResolver'
import { formatNumber } from 'app/util/TextUtil'

import RotateButtonGroup from './RotateButtonGroup'
import './PhotoControl.less'


type CommandKeys = 'toggleFlagged' | 'moveToTrash' | 'toggleInfo' | 'toggleGrading'


interface Props {
    /** Whether the surrounding UI part is active (and so the hotkeys should work). */
    isActive: boolean
    selectedPhotos: PhotoCollection | null
    isShowingTrash: boolean
    isShowingInfo: boolean
    isShowingColorGrading: boolean
    /**
     * Whether the color grading button is shown at all. It lives in the library top bar and
     * the detail view top bar; passing `false` hides it (e.g. where grading makes no sense).
     */
    showGradingButton?: boolean
    showPanelButtons?: boolean
    showRotation?: boolean
    rotationsOnly?: boolean
    photoActionController: PhotoActionController
    toggleShowInfo: () => void
    toggleShowGrading: () => void
}

export default class PhotoActionButtons extends React.Component<Props> {

    private commands: { [K in CommandKeys]: Command }
    private commandGroupId: CommandGroupId = -1

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onRotate', 'toggleFlagged', 'moveToTrash', 'restoreFromTrash', 'toggleShowInfo', 'toggleShowGrading')

        const hasSelection = () => getCollectionSize(this.props.selectedPhotos) > 0
        this.commands = {
            toggleFlagged: { combo: 'f', enabled: hasSelection, onAction: this.toggleFlagged },
            moveToTrash: {
                combo: 'backspace',
                enabled: () => hasSelection() && !this.props.isShowingTrash,
                label: msg('PhotoActionButtons_trash'),
                onAction: this.moveToTrash
            },
            toggleInfo: {
                combo: 'i',
                enabled: () => hasSelection() || this.props.isShowingInfo,
                label: msg('PhotoActionButtons_photoInfo'),
                onAction: this.toggleShowInfo
            },
            toggleGrading: {
                combo: 'g',
                enabled: () => hasSelection() || this.props.isShowingColorGrading,
                label: msg('PhotoActionButtons_colorGrading'),
                onAction: this.toggleShowGrading
            },
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

    private onRotate(turns: number) {
        const { props } = this
        if (props.selectedPhotos) {
            props.photoActionController.rotatePhotos(props.selectedPhotos, turns)
        }
    }

    private toggleFlagged() {
        const { props } = this
        if (props.selectedPhotos) {
            const newFlagged = !this.getSelectedAreFlagged()
            props.photoActionController.setPhotosFlagged(props.selectedPhotos, newFlagged)
        }
    }

    private getSelectedAreFlagged() {
        const { props } = this
        return props.photoActionController.getPhotosAreFlagged(props.selectedPhotos)
    }

    private moveToTrash() {
        const { props } = this
        if (props.selectedPhotos) {
            const photosCount = getCollectionSize(props.selectedPhotos)
            props.photoActionController.movePhotosToTrash(props.selectedPhotos)
            toaster.show({
                icon: 'tick',
                message: photosCount === 1 ? msg('PhotoActionButtons_movedToTrash_one') : msg('PhotoActionButtons_movedToTrash_more', formatNumber(photosCount)),
                intent: 'success'
            })
        }
    }

    private restoreFromTrash() {
        const { props } = this
        if (props.selectedPhotos) {
            const photosCount = getCollectionSize(props.selectedPhotos)
            props.photoActionController.restorePhotosFromTrash(props.selectedPhotos)
            toaster.show({
                icon: 'tick',
                message: photosCount === 1 ? msg('PhotoActionButtons_restoredFromTrash_one') : msg('PhotoActionButtons_restoredFromTrash_more', formatNumber(photosCount)),
                intent: 'success'
            })
        }
    }

    private toggleShowInfo() {
        this.props.toggleShowInfo()
    }

    private toggleShowGrading() {
        this.props.toggleShowGrading()
    }

    render() {
        const { props, commands } = this
        const hasSelection = getCollectionSize(props.selectedPhotos) > 0
        const selectedAreFlagged = this.getSelectedAreFlagged()

        // TODO: Revive Legacy code of 'version' feature
        //const availableEditors = new AvailableEditors();
        //availableEditors.editors.forEach(editor =>
        //  this.menu.append(new MenuItem({
        //      label: `Open with ${editor.name}`,
        //      click: () => {
        //          createVersionAndOpenWith(
        //              this.props.photo,
        //              editor.format,
        //              editor.cmd
        //          );
        //      }
        //  }));
        //)

        return (
            <>
                {props.showRotation !== false &&
                    <RotateButtonGroup isActive={props.isActive} disabled={!hasSelection} onRotate={this.onRotate}/>
                }
                {!props.rotationsOnly && <>
                    <Button
                        icon={selectedAreFlagged ? 'star' : 'star-empty'}
                        minimal
                        active={selectedAreFlagged}
                        aria-pressed={selectedAreFlagged}
                        aria-label={msg(selectedAreFlagged ? 'PhotoActionButtons_removeFavorite' : 'PhotoActionButtons_addFavorite')}
                        disabled={!hasSelection}
                        onClick={this.toggleFlagged}
                        title={formatCommandLabel(msg(selectedAreFlagged ? 'PhotoActionButtons_removeFavorite' : 'PhotoActionButtons_addFavorite'), commands.toggleFlagged.combo)}
                    />
                    {!props.isShowingTrash &&
                        <Button minimal icon="trash" {...getCommandButtonProps(commands.moveToTrash)}/>
                    }
                    {props.isShowingTrash &&
                        <Button
                            disabled={!hasSelection}
                            intent={hasSelection ? 'success' : undefined}
                            title={msg('PhotoActionButtons_restoreFromTrash')}
                            onClick={this.restoreFromTrash}
                        >
                            <MdRestoreFromTrash/>
                            <span className={Classes.BUTTON_TEXT}>{msg('PhotoActionButtons_restore')}</span>
                        </Button>
                    }
                    {props.showPanelButtons !== false && props.showGradingButton !== false &&
                        <Button
                            className='PhotoControl'
                            minimal
                            icon={<FiSliders aria-hidden='true'/>}
                            active={props.isShowingColorGrading}
                            aria-pressed={props.isShowingColorGrading}
                            aria-label={commands.toggleGrading.label}
                            {...getCommandButtonProps(commands.toggleGrading)}
                        />
                    }
                    {props.showPanelButtons !== false && <Button
                        className='PhotoControl'
                        minimal
                        icon={<FiInfo aria-hidden='true'/>}
                        active={props.isShowingInfo}
                        aria-pressed={props.isShowingInfo}
                        aria-label={commands.toggleInfo.label}
                        {...getCommandButtonProps(commands.toggleInfo)}
                    />}
                </>}
            </>
        )    
    }
}
