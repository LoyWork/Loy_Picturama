import classNames from 'classnames'
import React from 'react'
import { connect } from 'react-redux'
import { IconName } from '@blueprintjs/core'
import { FaStar, FaRegStar, FaTrashAlt, FaImages, FaTag } from 'react-icons/fa'

import { TagId, TagById } from 'app/CommonTypes'
import { msg } from 'app/i18n/i18n'
import { setLibraryFilter } from 'app/controller/PhotoController'
import { AppState } from 'app/state/StateTypes'

import './FolderSidebar.less'


type SimpleFilterType = 'all' | 'favorites' | 'trash'

const iconBySimpleFilter: { [K in SimpleFilterType]: JSX.Element } = {
    all: <FaImages/>,
    favorites: <FaRegStar/>,
    trash: <FaTrashAlt/>,
}

interface SidebarEntry {
    key: string
    icon: JSX.Element
    label: string
    count?: number
    isSelected: boolean
    onSelect(): void
}

interface OwnProps {
    className?: any
}

interface StateProps {
    folderIds: string[]
    folderById: { [name: string]: { name: string, count: number } }
    libraryFilter: AppState['library']['filter']
    tagIds: TagId[]
    tagById: TagById
}

interface DispatchProps {
    setLibraryFilter(newFilter: any): void
}

export interface Props extends OwnProps, StateProps, DispatchProps {
}

/**
 * The left sidebar: the single place to choose what the library shows - the photo view (all /
 * favorites / trash, formerly the filter button's menu), the tags and the top-level folders inside
 * the photo directories.
 */
export class FolderSidebar extends React.Component<Props> {

    private onSelectSimple(filterType: SimpleFilterType) {
        this.props.setLibraryFilter({ filterType })
    }

    private onSelectTag(tagId: TagId) {
        this.props.setLibraryFilter({ filterType: 'tag', tagId })
    }

    private onSelectFolder(folder: string) {
        this.props.setLibraryFilter({ filterType: 'folder', folder })
    }

    private renderSectionTitle(title: string): JSX.Element {
        return <div className='FolderSidebar-sectionTitle'>{title}</div>
    }

    private renderEntries(entries: SidebarEntry[]): JSX.Element[] {
        return entries.map(entry =>
            <div
                key={entry.key}
                className={classNames('FolderSidebar-item', { isSelected: entry.isSelected })}
                title={entry.label}
                onClick={entry.onSelect}
            >
                <span className='FolderSidebar-itemIcon'>{entry.icon}</span>
                <span className='FolderSidebar-itemName'>{entry.label}</span>
                {(entry.count !== undefined) &&
                    <span className='FolderSidebar-itemCount'>{entry.count}</span>
                }
            </div>
        )
    }

    render() {
        const { props } = this
        const { libraryFilter } = props

        const photoEntries: SidebarEntry[] = [
            {
                key: 'all',
                icon: iconBySimpleFilter.all,
                label: msg('LibraryFilterButton_filter_all'),
                isSelected: libraryFilter.filterType === 'all',
                onSelect: () => this.onSelectSimple('all'),
            },
            {
                key: 'favorites',
                icon: iconBySimpleFilter.favorites,
                label: msg('LibraryFilterButton_filter_favorites'),
                isSelected: libraryFilter.filterType === 'favorites',
                onSelect: () => this.onSelectSimple('favorites'),
            },
            {
                key: 'trash',
                icon: iconBySimpleFilter.trash,
                label: msg('LibraryFilterButton_filter_trash'),
                isSelected: libraryFilter.filterType === 'trash',
                onSelect: () => this.onSelectSimple('trash'),
            },
        ]

        return (
            <div className={classNames(props.className, 'FolderSidebar')}>
                <div className='FolderSidebar-body'>
                    {this.renderEntries(photoEntries)}
                    {!!props.tagIds.length &&
                        <>
                            {this.renderSectionTitle(msg('LibraryFilterButton_tag_title'))}
                            {this.renderEntries(props.tagIds.map(tagId => {
                                const tag = props.tagById[tagId]
                                return {
                                    key: `tag-${tagId}`,
                                    icon: <FaTag/>,
                                    label: tag.title,
                                    isSelected: libraryFilter.filterType === 'tag' && libraryFilter.tagId === tagId,
                                    onSelect: () => this.onSelectTag(tagId),
                                }
                            }))}
                        </>
                    }
                    {!!props.folderIds.length &&
                        <>
                            {this.renderSectionTitle(msg('FolderSidebar_title'))}
                            {this.renderEntries(props.folderIds.map(folder => {
                                const folderData = props.folderById[folder]
                                return {
                                    key: `folder-${folder}`,
                                    icon: <FaImages/>,
                                    label: folder,
                                    count: folderData ? folderData.count : undefined,
                                    isSelected: libraryFilter.filterType === 'folder' && libraryFilter.folder === folder,
                                    onSelect: () => this.onSelectFolder(folder),
                                }
                            }))}
                        </>
                    }
                </div>
            </div>
        )
    }

}


const Connected = connect<StateProps, DispatchProps, OwnProps, AppState>(
    (state: AppState, props: OwnProps) => {
        const { folders } = state.data
        return {
            ...props,
            folderIds: folders.ids,
            folderById: folders.byId,
            libraryFilter: state.library.filter,
            tagIds: state.data.tags.ids,
            tagById: state.data.tags.byId,
        }
    },
    dispatch => ({
        setLibraryFilter,
    })
)(FolderSidebar)

export default Connected
