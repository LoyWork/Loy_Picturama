import classNames from 'classnames'
import React from 'react'
import { connect } from 'react-redux'

import { Photo, PhotoWork, PhotoSectionId, ColorGrading, DevelopSettings } from 'app/CommonTypes'
import PhotoInfo from 'app/ui/info/PhotoInfo'
import PhotoColorGrading from 'app/ui/grading/PhotoColorGrading'
import PhotoToolsToolbar from 'app/ui/widget/PhotoToolsToolbar'
import { HistogramData } from 'app/util/DevelopUtil'
import { setDetailPhotoByIndex, setPreviousDetailPhoto, setNextDetailPhoto } from 'app/controller/DetailController'
import { defaultLibrarySelectionController, LibrarySelectionController } from 'app/controller/LibrarySelectionController'
import { defaultPhotoActionController, PhotoActionController } from 'app/controller/PhotoActionController'
import { setPhotoTags } from 'app/controller/PhotoTagController'
import { updatePhotoWorkColorGrading, updatePhotoWorkDevelop, savePhotoGrading } from 'app/controller/PhotoGradingController'
import { setShowGradingAction, setShowInfoAction } from 'app/state/actions'
import { getPhotoById, getPhotoByIndex, getLoadedSectionById, getTagTitles, getInfoPhoto } from 'app/state/selectors'
import { AppState, InfoPhotoData, SelectionState } from 'app/state/StateTypes'
import { getMasterPath } from 'app/util/DataUtil'
import { bindMany } from 'app/util/LangUtil'

import { DetailMode } from './DetailTypes'
import PhotoDetailBody from './PhotoDetailBody'

import './PhotoDetailPane.less'


interface OwnProps {
    style?: any
    className?: any
    isActive: boolean
}

interface StateProps {
    devicePixelRatio: number
    sectionId: PhotoSectionId
    photo: Photo
    photoPrev: Photo | null
    photoNext: Photo | null
    photoWork: PhotoWork | null
    selection: SelectionState | null
    tags: string[]
    isFirst: boolean
    isLast: boolean
    showInfo: boolean
    showGrading: boolean
    infoPhoto?: Photo
    infoPhotoData?: InfoPhotoData
    photoActionController: PhotoActionController
    librarySelectionController: LibrarySelectionController
}

interface DispatchProps {
    setPreviousDetailPhoto: () => void
    setNextDetailPhoto: () => void
    setPhotoTags: (photo: Photo, tags: string[]) => void
    setShowInfo(showInfo: boolean): void
    setShowGrading(showGrading: boolean): void
    closeDetail: () => void
}

export interface Props extends OwnProps, StateProps, DispatchProps {
}

interface State {
    mode: DetailMode
    /**
     * The color grading shown while the grading panel is open — updated live (every wheel/slider
     * change), while the saved PhotoWork only follows debounced. `null` also while the panel is
     * closed (then the graded PhotoWork is shown).
     */
    previewGrading: ColorGrading | null
    /** Whether previewGrading holds a live edit (vs. just mirroring the saved grading) */
    isPreviewing: boolean
    /**
     * The develop settings shown live while the panel edits (the saved PhotoWork follows
     * debounced). `null` while the panel is closed.
     */
    previewDevelop: DevelopSettings | null
    isPreviewingDevelop: boolean
    /** The RGB histogram of the currently rendered photo (from the render pipeline) */
    histogram: HistogramData | null
}

export class PhotoDetailPane extends React.Component<Props, State> {

    constructor(props: Props) {
        super(props);
        bindMany(this, 'toggleShowInfo', 'toggleShowGrading', 'setMode', 'onColorGradingChange', 'onDevelopChange', 'onHistogramChange')
        this.state = {
            mode: 'view',
            previewGrading: null,
            isPreviewing: false,
            previewDevelop: null,
            isPreviewingDevelop: false,
            histogram: null,
        }
    }

    private toggleShowInfo() {
        const { props } = this
        props.setShowInfo(!props.showInfo)
    }

    private toggleShowGrading() {
        const { props } = this
        props.setShowGrading(!props.showGrading)
        // Closing the panel drops the live preview; the saved grading (same values) takes over
        if (props.showGrading) {
            this.setState({ previewGrading: null, isPreviewing: false, previewDevelop: null, isPreviewingDevelop: false })
        }
    }

    private setMode(mode: DetailMode) {
        const { props } = this
        if (mode === 'crop' && props.showInfo) {
            props.setShowInfo(false)
        }
        if (mode === 'crop' && props.showGrading) {
            props.setShowGrading(false)
            this.setState({ previewGrading: null, isPreviewing: false, previewDevelop: null, isPreviewingDevelop: false })
        }
        this.setState({ mode })
    }

    componentDidUpdate(prevProps: Props) {
        // A different photo starts with a clean preview (its own saved grading is shown)
        if (prevProps.photo?.id !== this.props.photo?.id) {
            const { state } = this
            if (state.isPreviewing || state.previewGrading || state.isPreviewingDevelop || state.previewDevelop) {
                this.setState({ previewGrading: null, isPreviewing: false, previewDevelop: null, isPreviewingDevelop: false })
            }
            if (state.histogram) {
                // The render pipeline reports the new photo's histogram once it has drawn it
                this.setState({ histogram: null })
            }
        }
    }

    /**
     * Shows a color grading change right away and persists it (PhotoGradingController debounces
     * the PhotoWork sidecar writes). `null` resets the grading.
     */
    private onColorGradingChange(colorGrading: ColorGrading | null) {
        this.setState({ previewGrading: colorGrading, isPreviewing: true })
        updatePhotoWorkColorGrading(this.props.photo, colorGrading)
    }

    /**
     * Shows a develop change right away and persists it (debounced on the controller's side).
     * `null` resets all develop settings.
     */
    private onDevelopChange(develop: DevelopSettings | null) {
        this.setState({ previewDevelop: develop, isPreviewingDevelop: true })
        updatePhotoWorkDevelop(this.props.photo, develop)
    }

    /** The render pipeline reports the histogram of the photo it just drew */
    private onHistogramChange(histogram: HistogramData | null) {
        this.setState({ histogram })
    }

    render() {
        const { props, state } = this
        // The live preview while the grading panel edits, else the saved grading
        const colorGrading = state.isPreviewing
            ? state.previewGrading
            : props.photoWork?.colorGrading || null
        const develop = state.isPreviewingDevelop
            ? state.previewDevelop
            : props.photoWork?.develop || null

        return (
            <div
                className={classNames(props.className, 'PhotoDetailPane',
                    { hasRightSidebar: props.showInfo, hasGradingSidebar: props.showGrading })}
                style={props.style}
            >
                <PhotoDetailBody
                    topBarClassName='PhotoDetailPane-topBar'
                    bodyClassName='PhotoDetailPane-body'
                    devicePixelRatio={props.devicePixelRatio}
                    selection={props.selection}
                    isActive={props.isActive}
                    mode={state.mode}
                    isShowingInfo={props.showInfo}
                    isShowingColorGrading={props.showGrading}
                    sectionId={props.sectionId}
                    photo={props.photo}
                    isFirst={props.isFirst}
                    isLast={props.isLast}
                    imagePath={getMasterPath(props.photo)}
                    imagePathPrev={props.photoPrev && getMasterPath(props.photoPrev)}
                    imagePathNext={props.photoNext && getMasterPath(props.photoNext)}
                    photoWork={props.photoWork}
                    colorGrading={colorGrading}
                    develop={develop}
                    onHistogramChange={this.onHistogramChange}
                    photoActionController={props.photoActionController}
                    librarySelectionController={props.librarySelectionController}
                    setMode={this.setMode}
                    setPreviousDetailPhoto={props.setPreviousDetailPhoto}
                    setNextDetailPhoto={props.setNextDetailPhoto}
                    toggleShowInfo={this.toggleShowInfo}
                    toggleShowGrading={this.toggleShowGrading}
                    closeDetail={props.closeDetail}
                />

                <PhotoInfo
                    className="PhotoDetailPane-rightSidebar"
                    isActive={props.showInfo}
                    photo={props.infoPhoto}
                    photoData={props.infoPhotoData}
                    tags={props.tags}
                    closeInfo={this.toggleShowInfo}
                    setPhotoTags={props.setPhotoTags}
                />

                <PhotoColorGrading
                    className="PhotoDetailPane-leftSidebar"
                    isActive={props.showGrading}
                    photo={props.photo}
                    // Show the live preview so sliders/wheels track the pointer while dragging;
                    // the saved photoWork only follows after the debounced save
                    develop={state.isPreviewingDevelop
                        ? state.previewDevelop
                        : props.photoWork?.develop || null}
                    colorGrading={state.isPreviewing
                        ? state.previewGrading
                        : props.photoWork?.colorGrading || null}
                    histogram={state.histogram}
                    closeGrading={this.toggleShowGrading}
                    onColorGradingChange={this.onColorGradingChange}
                    onDevelopChange={this.onDevelopChange}
                    onSave={() => savePhotoGrading(props.photo)}
                />
                <PhotoToolsToolbar
                    showInfo={props.showInfo}
                    showGrading={props.showGrading}
                    canGrade={!!props.photo}
                    disabled={!props.isActive || state.mode !== 'view'}
                    toggleShowInfo={this.toggleShowInfo}
                    toggleShowGrading={this.toggleShowGrading}
                />
            </div>
        );
    }

}


const Connected = connect<StateProps, DispatchProps, OwnProps, AppState>(
    (state: AppState, props) => {
        const currentPhoto = state.detail!.currentPhoto
        const sectionId = currentPhoto.sectionId
        const section = getLoadedSectionById(state, sectionId)
        // Paging continues into the adjacent section, so it only ends at the very first and very last photo
        const sectionIds = state.data.sections.ids
        const sectionIndex = sectionIds.indexOf(sectionId)
        const isFirstSection = sectionIndex <= 0
        const isLastSection = sectionIndex === -1 || sectionIndex === sectionIds.length - 1
        return {
            ...props,
            devicePixelRatio: state.navigation.devicePixelRatio,
            sectionId: currentPhoto.sectionId,
            photo: getPhotoById(state, sectionId, currentPhoto.photoId)!,
            photoPrev: getPhotoByIndex(state, sectionId, currentPhoto.photoIndex - 1),
            photoNext: getPhotoByIndex(state, sectionId, currentPhoto.photoIndex + 1),
            photoWork: currentPhoto.photoWork,
            selection: state.library.selection,
            tags: getTagTitles(state),
            isFirst: isFirstSection && currentPhoto.photoIndex === 0,
            isLast: isLastSection && (!section || currentPhoto.photoIndex === section.photoIds.length - 1),
            showInfo: state.info.showInDetail,
            showGrading: state.info.showGradingInDetail,
            infoPhoto: getInfoPhoto(state),
            infoPhotoData: state.info.photoData,
            photoActionController: defaultPhotoActionController,
            librarySelectionController: defaultLibrarySelectionController,
        }
    },
    dispatch => ({
        setPreviousDetailPhoto,
        setNextDetailPhoto,
        setPhotoTags,
        setShowInfo(showInfo: boolean) {
            dispatch(setShowInfoAction('detail', showInfo))
        },
        setShowGrading(showGrading: boolean) {
            dispatch(setShowGradingAction(showGrading))
        },
        closeDetail: () => setDetailPhotoByIndex(null, null)
    })
)(PhotoDetailPane)

export default Connected
