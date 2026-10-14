import classNames from 'classnames'
import React from 'react'
import { Button, Icon, IconName, NonIdealState } from '@blueprintjs/core'

import { ColorGrading, ColorGradingWheel as Wheel, DevelopSettings, MixerBand, MIXER_BANDS, MIXER_BAND_COLORS, Photo } from 'app/CommonTypes'
import { msg } from 'app/i18n/i18n'
import { clampWheel, isNeutral, neutralGrading, withDefaults } from 'app/util/ColorGradingUtil'
import { CONTROLS, SectionId, findControl } from 'app/util/DevelopUtil'
import { bindMany } from 'app/util/LangUtil'
import Toolbar from 'app/ui/widget/Toolbar'

import ColorGradingWheel from './ColorGradingWheel'
import DevelopSlider from './DevelopSlider'
import Histogram from './Histogram'
import { HistogramData } from 'app/util/DevelopUtil'

import './PhotoColorGrading.less'


/** Debounce time before a finished edit is saved to the PhotoWork sidecar */
const saveDebounceMs = 300

type WheelMode = 'shadows' | 'midtones' | 'highlights' | 'global'

type GradingMode = '3way' | 'shadows' | 'midtones' | 'highlights' | 'global'

const gradingModes: GradingMode[] = [ '3way', 'shadows', 'midtones', 'highlights', 'global' ]

const tonalModes: ('shadows' | 'midtones' | 'highlights')[] = [ 'shadows', 'midtones', 'highlights' ]

/** The mode row's icon tabs (like LightCraft's grading tabs) */
const modeIcons: { [mode in GradingMode]: IconName } = {
    '3way': 'style',
    shadows: 'moon',
    midtones: 'circle',
    highlights: 'flash',
    global: 'globe-network',
}

/** The develop panel's sections, in panel order (like LightCraft's `section()` calls) */
const SECTIONS: { id: SectionId, title: string, icon: IconName }[] = [
    { id: 'light', title: 'Light', icon: 'contrast' },
    { id: 'color', title: 'Color', icon: 'tint' },
    { id: 'mixer', title: 'Color Mixer', icon: 'filter' },
    { id: 'grading', title: 'Color Grading', icon: 'style' },
    { id: 'effects', title: 'Effects', icon: 'clean' },
    { id: 'detail', title: 'Detail', icon: 'locate' },
    { id: 'calibration', title: 'Calibration', icon: 'settings' },
]

/** The mixer's flyout groups: each band opens its own hue/sat/lum sliders */
const WB_MODES: { id: string, label: string, temp: number, tint: number }[] = [
    { id: 'asShot', label: 'As Shot', temp: 6500, tint: 0 },
    { id: 'auto', label: 'Auto', temp: 5500, tint: 5 },
    { id: 'daylight', label: 'Daylight', temp: 5500, tint: 10 },
    { id: 'cloudy', label: 'Cloudy', temp: 6500, tint: 10 },
    { id: 'shade', label: 'Shade', temp: 7500, tint: 10 },
    { id: 'tungsten', label: 'Tungsten', temp: 2850, tint: 0 },
    { id: 'fluorescent', label: 'Fluorescent', temp: 3800, tint: 21 },
    { id: 'flash', label: 'Flash', temp: 5500, tint: 0 },
]

export interface Props {
    style?: any
    className?: any
    isActive: boolean
    photo?: Photo
    /** The develop settings as stored in the photo's PhotoWork (lags behind while dragging) */
    develop: DevelopSettings | null
    /** The color grading (legacy field, may exist without `develop`) */
    colorGrading: ColorGrading | null
    /** The live histogram of the rendered photo */
    histogram?: HistogramData | null
    closeGrading: () => void
    /**
     * Called for every change (also during drags): the parent shows it live and saves it
     * (debounced on its side for wheel gestures — sliders only commit on release).
     */
    onDevelopChange(develop: DevelopSettings | null): void
    /** Legacy grading-only callback (kept for the panel's grading mode, see `colorGrading`) */
    onColorGradingChange(colorGrading: ColorGrading | null): void
}

interface State {
    mode: GradingMode
    /** Which sections are open (LightCraft's `section_open`) */
    openSections: { [id in SectionId]?: boolean }
    /** Sections switched off with the header eye (their effect is skipped in the render) */
    disabledSections: { [id in SectionId]?: boolean }
    /** Wheels whose effect is temporarily hidden on the photo (for viewing the difference) */
    hiddenWheels: Record<WheelMode, boolean>
    /** The active colour-mixer band */
    mixerBand: MixerBand
    /** The white balance mode dropdown */
    wbMenuOpen: boolean
}

function emptyDevelop(): DevelopSettings {
    return {}
}

/**
 * The develop panel (like the info panel, a right sidebar for the current photo), following
 * LightCraft's edit panel: an RGB histogram, an Edit header (Auto / B&W / Reset), and the Light,
 * Color, Color Mixer, Color Grading, Effects, Detail and Calibration sections as collapsible
 * groups of Lightroom-style sliders.
 */
export default class PhotoColorGrading extends React.Component<Props, State> {

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onClose', 'onReset', 'onAuto', 'onBw', 'toggleSection', 'toggleSectionEnabled',
            'onWbModeSelect', 'onWbMenuToggle')
        this.state = {
            mode: '3way',
            openSections: { light: true, color: true },
            disabledSections: {},
            hiddenWheels: { shadows: false, midtones: false, highlights: false, global: false },
            mixerBand: 'red',
            wbMenuOpen: false,
        }
    }

    // --- the develop state being edited -------------------------------------------------------

    /** The develop settings as they are now (the stored ones, or empty) */
    private get develop(): DevelopSettings {
        return { ...(this.props.develop || emptyDevelop()), grading: this.props.colorGrading || this.props.develop?.grading }
    }

    private get grading(): ColorGrading {
        return this.props.colorGrading || this.develop.grading || neutralGrading()
    }

    /** Reads a control value by id from the develop state (defaults from the spec) */
    private controlValue(id: string): number {
        const spec = findControl(id)
        if (!spec) {
            return 0
        }
        const d = this.develop
        const parts = id.split('.')
        let obj: any = d
        for (const p of parts.slice(0, -1)) {
            obj = obj?.[p]
        }
        const v = obj?.[parts[parts.length - 1]]
        return v === undefined ? spec.default : v
    }

    /** Writes a control value by id into the develop state and reports the change */
    private setControlValue(id: string, value: number, committed: boolean) {
        const spec = findControl(id)
        if (!spec) {
            return
        }
        const develop: DevelopSettings = { ...this.develop }
        const parts = id.split('.')
        let obj: any = develop
        for (const p of parts.slice(0, -1)) {
            obj[p] = { ...(obj[p] || {}) }
            obj = obj[p]
        }
        obj[parts[parts.length - 1]] = value
        // wb.temp has no neutral value (6500 K *is* neutral) — drop the wb object at 6500/0
        if (id === 'wb.temp' && value === spec.default) {
            if ((develop.wb?.tint ?? 0) === 0) {
                delete develop.wb
            }
        }
        if (id === 'wb.tint' && value === spec.default) {
            if ((develop.wb?.temp ?? 6500) === 6500) {
                delete develop.wb
            }
        }
        this.reportDevelop(develop, committed)
    }

    /**
     * Reports a develop change: the grading lives both in the legacy `colorGrading` prop (which
     * the render path already wires) and in `develop.grading`.
     */
    private reportDevelop(develop: DevelopSettings, committed: boolean) {
        if (develop.grading) {
            this.props.onColorGradingChange(develop.grading)
        }
        this.props.onDevelopChange(develop)
        void committed
    }

    // --- header actions ------------------------------------------------------------------------

    private onClose() {
        this.props.closeGrading()
    }

    private onReset() {
        this.props.onColorGradingChange(null)
        this.props.onDevelopChange(null)
        this.setState({ hiddenWheels: { shadows: false, midtones: false, highlights: false, global: false } })
    }

    private onAuto() {
        // A simple auto: a slight contrast and vibrance lift (LightCraft analyses the histogram;
        // this is the neutral fallback until the render pipeline exposes one)
        const develop: DevelopSettings = {
            ...this.develop,
            light: { ...this.develop.light, contrast: 10 },
            color: { ...this.develop.color, vibrance: 10 },
        }
        this.reportDevelop(develop, true)
    }

    private onBw() {
        const treatment = this.develop.treatment === 'bw' ? undefined : 'bw'
        const develop: DevelopSettings = { ...this.develop, treatment }
        if (treatment === undefined) {
            delete develop.treatment
        }
        this.reportDevelop(develop, true)
    }

    private toggleSection(id: SectionId) {
        this.setState(state => ({ openSections: { ...state.openSections, [id]: !state.openSections[id] } }))
    }

    private toggleSectionEnabled(id: SectionId) {
        this.setState(state => ({ disabledSections: { ...state.disabledSections, [id]: !state.disabledSections[id] } }))
    }

    // --- white balance ---------------------------------------------------------------------------

    private onWbMenuToggle() {
        this.setState(state => ({ wbMenuOpen: !state.wbMenuOpen }))
    }

    private onWbModeSelect(mode: { temp: number, tint: number }) {
        this.setState({ wbMenuOpen: false })
        const develop: DevelopSettings = { ...this.develop }
        if (mode.temp === 6500 && mode.tint === 0) {
            delete develop.wb
        } else {
            develop.wb = { temp: mode.temp, tint: mode.tint }
        }
        this.reportDevelop(develop, true)
    }

    // --- render -----------------------------------------------------------------------------------

    render() {
        const { props } = this

        let body: JSX.Element | null
        if (!props.isActive) {
            body = null
        } else if (!props.photo) {
            body = (
                <NonIdealState
                    icon="insert"
                    title={msg('PhotoInfo_noSelection_title')}
                    description={msg('PhotoInfo_noSelection_message')}
                />
            )
        } else {
            body = this.renderDevelop()
        }

        return (
            <div className={classNames(props.className, 'PhotoColorGrading bp3-dark')} style={props.style}>
                <Toolbar className="PhotoColorGrading-topBar" isTopBar isRight>
                    <span className="PhotoColorGrading-title">{msg('PhotoColorGrading_title')}</span>
                    <Toolbar.Spacer isTopBar/>
                    <Button icon="cross" minimal={true} onClick={this.onClose} />
                </Toolbar>
                <div className='PhotoColorGrading-body'>
                    {body}
                </div>
            </div>
        )
    }

    /** The whole develop panel: histogram, Edit header, then every section in panel order */
    private renderDevelop(): JSX.Element {
        const isBw = this.develop.treatment === 'bw'
        return (
            <div className='PhotoColorGrading-content'>
                <Histogram className='PhotoColorGrading-histogram' photo={this.props.photo} histogram={this.props.histogram} />

                <div className='PhotoColorGrading-editHeader'>
                    <span className='PhotoColorGrading-editTitle'>Edit</span>
                    <div className='PhotoColorGrading-editButtons'>
                        <button type='button' className='PhotoColorGrading-textButton' onClick={this.onAuto}>Auto</button>
                        <button
                            type='button'
                            className={classNames('PhotoColorGrading-textButton', { isActive: isBw })}
                            onClick={this.onBw}
                        >
                            B&W
                        </button>
                        <button
                            type='button'
                            className='PhotoColorGrading-textButton'
                            onClick={this.onReset}
                            disabled={!this.hasEdits()}
                        >
                            {msg('PhotoColorGrading_reset')}
                        </button>
                    </div>
                </div>

                {SECTIONS.map(section => this.renderSection(section.id, section.title, section.icon))}
            </div>
        )
    }

    private hasEdits(): boolean {
        const d = this.develop
        return !!this.props.colorGrading && !isNeutral(this.props.colorGrading) || Object.keys(d).length > 0
    }

    /** A collapsible section with a header (chevron, title, eye), like LightCraft's `section()` */
    private renderSection(id: SectionId, title: string, icon: IconName): JSX.Element {
        const open = !!this.state.openSections[id]
        const disabled = !!this.state.disabledSections[id]
        return (
            <div key={id} className={classNames('PhotoColorGrading-section', { isDisabled: disabled })}>
                <div className='PhotoColorGrading-sectionHeader' onClick={() => this.toggleSection(id)}>
                    <Icon icon={open ? 'chevron-down' : 'chevron-right'} iconSize={12} className='PhotoColorGrading-sectionChevron' />
                    <Icon icon={icon} iconSize={13} />
                    <span className='PhotoColorGrading-sectionTitle'>{title}</span>
                    <button
                        type='button'
                        className='PhotoColorGrading-eye'
                        title={disabled ? 'Enable this section' : 'Disable this section'}
                        onClick={e => {
                            e.stopPropagation()
                            this.toggleSectionEnabled(id)
                        }}
                    >
                        <Icon icon={disabled ? 'eye-off' : 'eye-open'} iconSize={12} />
                    </button>
                </div>
                {open && !disabled &&
                    <div className='PhotoColorGrading-sectionBody'>
                        {this.renderSectionBody(id)}
                    </div>
                }
            </div>
        )
    }

    private renderSectionBody(id: SectionId): JSX.Element | null {
        switch (id) {
            case 'light': return this.renderLight()
            case 'color': return this.renderColor()
            case 'mixer': return this.renderMixer()
            case 'grading': return this.renderGradingSection()
            case 'effects': return this.renderEffects()
            case 'detail': return this.renderDetail()
            case 'calibration': return this.renderCalibration()
        }
    }

    private slider(id: string): JSX.Element {
        const spec = findControl(id)
        if (!spec) {
            return null as any
        }
        const value = this.controlValue(id)
        const isNeutralValue = value === spec.default
        return (
            <DevelopSlider
                key={id}
                control={spec}
                value={value}
                // The dependency sliders (vignette.midpoint etc.) enable when their head value moves
                enabled={!isDependentNeutral(id, this.develop)}
                onChange={v => this.setControlValue(id, v, false)}
                onChangeCommitted={v => this.setControlValue(id, v, true)}
            />
        )
        function isDependentNeutral(controlId: string, develop: DevelopSettings): boolean {
            if (controlId.startsWith('vignette.') && controlId !== 'vignette.amount') {
                return (develop.vignette?.amount ?? 0) === 0
            }
            if (controlId.startsWith('grain.') && controlId !== 'grain.amount') {
                return (develop.grain?.amount ?? 0) === 0
            }
            if (controlId.startsWith('detail.sharpen') && controlId !== 'detail.sharpenAmount') {
                return (develop.detail?.sharpenAmount ?? 0) === 0
            }
            return false
        }
    }

    /** The Light section: exposure, contrast, highlights, shadows, whites, blacks */
    private renderLight(): JSX.Element {
        return (
            <>
                {this.slider('light.exposure')}
                {this.slider('light.contrast')}
                {this.slider('light.highlights')}
                {this.slider('light.shadows')}
                {this.slider('light.whites')}
                {this.slider('light.blacks')}
            </>
        )
    }

    /** The Color section: the white balance row (mode dropdown + temp/tint), then vibrance/saturation */
    private renderColor(): JSX.Element {
        const wb = this.develop.wb
        const currentMode = !wb ? WB_MODES[0] : WB_MODES.find(m => m.temp === wb.temp && m.tint === wb.tint)
        return (
            <>
                <div className='PhotoColorGrading-wbRow'>
                    <span className='PhotoColorGrading-wbLabel'>White Balance</span>
                    <div className='PhotoColorGrading-wbDropdown'>
                        <button type='button' className='PhotoColorGrading-textButton' onClick={this.onWbMenuToggle}>
                            {currentMode ? currentMode.label : 'Custom'} <Icon icon='chevron-down' iconSize={10} />
                        </button>
                        {this.state.wbMenuOpen &&
                            <div className='PhotoColorGrading-wbMenu'>
                                {WB_MODES.map(m =>
                                    <button
                                        key={m.id}
                                        type='button'
                                        className={classNames('PhotoColorGrading-wbMenuItem', { isActive: currentMode === m })}
                                        onClick={() => this.onWbModeSelect(m)}
                                    >
                                        {m.label}
                                    </button>
                                )}
                            </div>
                        }
                    </div>
                </div>
                {this.slider('wb.temp')}
                {this.slider('wb.tint')}
                {this.slider('color.vibrance')}
                {this.slider('color.saturation')}
            </>
        )
    }

    /** The Color Mixer: one colour dot per band, the active band's hue/sat/lum sliders */
    private renderMixer(): JSX.Element {
        const band = this.state.mixerBand
        const isBw = this.develop.treatment === 'bw'
        return (
            <>
                <div className='PhotoColorGrading-bandRow'>
                    {MIXER_BANDS.map((b, i) =>
                        <button
                            key={b}
                            type='button'
                            className={classNames('PhotoColorGrading-bandDot', { isActive: b === band })}
                            style={{ background: MIXER_BAND_COLORS[i] }}
                            title={b}
                            onClick={() => this.setState({ mixerBand: b })}
                        />
                    )}
                </div>
                {isBw
                    ? this.slider(`bwMix.${band}`)
                    : <>
                        {this.slider(`mixer.${band}.hue`)}
                        {this.slider(`mixer.${band}.sat`)}
                        {this.slider(`mixer.${band}.lum`)}
                    </>
                }
            </>
        )
    }

    private updateWheel(mode: WheelMode, hue: number, sat: number) {
        const grading: ColorGrading = { ...this.grading }
        const lum = withDefaults(grading[mode]).lum
        grading[mode] = clampWheel({ hue, sat, lum })
        this.props.onColorGradingChange(grading)
    }

    private updateWheelLum(mode: WheelMode, lum: number) {
        const grading: ColorGrading = { ...this.grading }
        const wheel = withDefaults(grading[mode])
        grading[mode] = clampWheel({ ...wheel, lum })
        this.props.onColorGradingChange(grading)
    }

    private updateWheelHue(mode: WheelMode, hue: number) {
        const grading: ColorGrading = { ...this.grading }
        const wheel = withDefaults(grading[mode])
        grading[mode] = clampWheel({ ...wheel, hue })
        this.props.onColorGradingChange(grading)
    }

    private setHidden(mode: WheelMode, hidden: boolean) {
        this.setState(state => ({ hiddenWheels: { ...state.hiddenWheels, [mode]: hidden } }))
    }

    /** The Color Grading section: the mode tabs, the wheels, blending/balance */
    private renderGradingSection(): JSX.Element {
        const grading = this.grading
        return (
            <>
                <div className='PhotoColorGrading-modeRow'>
                    {gradingModes.map(mode =>
                        <Button
                            key={mode}
                            className={classNames('PhotoColorGrading-modeButton', { isActive: this.state.mode === mode })}
                            minimal={true}
                            title={msg(`PhotoColorGrading_mode_${mode}`)}
                            active={this.state.mode === mode}
                            onClick={() => this.setState({ mode })}
                        >
                            <Icon icon={modeIcons[mode]} iconSize={15} />
                        </Button>
                    )}
                </div>

                {this.state.mode === '3way'
                    ? this.render3Way(grading)
                    : this.renderSingle(grading, this.state.mode)
                }

                {this.state.mode === '3way' &&
                    <>
                        {this.slider('grading.blending')}
                        {this.slider('grading.balance')}
                    </>
                }
            </>
        )
    }

    /** The 3-way layout (like LightCraft): three equal wheels, midtones on top, shadows and highlights below */
    private render3Way(grading: ColorGrading): JSX.Element {
        return (
            <div className='PhotoColorGrading-wheels3way'>
                <div className='PhotoColorGrading-wheelSlotRow isMidtones'>
                    <div className='PhotoColorGrading-wheelSlot'>
                        {this.renderWheel('midtones', grading.midtones, 92)}
                    </div>
                </div>
                <div className='PhotoColorGrading-wheelSlotRow'>
                    <div className='PhotoColorGrading-wheelSlot'>
                        {this.renderWheel('shadows', grading.shadows, 92)}
                    </div>
                    <div className='PhotoColorGrading-wheelSlot'>
                        {this.renderWheel('highlights', grading.highlights, 92)}
                    </div>
                </div>
                {tonalModes.map(mode =>
                    <React.Fragment key={mode}>
                        {this.slider(`grading.${mode}.lum`)}
                    </React.Fragment>
                )}
            </div>
        )
    }

    /** One big wheel for a single tonal range, with hue/sat/lum sliders (like LightCraft's tabs) */
    private renderSingle(grading: ColorGrading, mode: WheelMode): JSX.Element {
        const wheel = withDefaults(grading[mode])
        return (
            <div className='PhotoColorGrading-single'>
                <div className='PhotoColorGrading-wheelSlotRow isLarge'>
                    <div className='PhotoColorGrading-wheelSlot'>
                        {this.renderWheel(mode, grading[mode], 140)}
                    </div>
                </div>
                {this.slider(`grading.${mode}.hue`)}
                {this.slider(`grading.${mode}.sat`)}
                {this.slider(`grading.${mode}.lum`)}
            </div>
        )
    }

    private renderWheel(mode: WheelMode, wheel: Wheel | undefined, size: number): JSX.Element {
        const w = withDefaults(wheel)
        return (
            <div className='PhotoColorGrading-wheel'>
                <ColorGradingWheel
                    id={`grading-wheel-${mode}`}
                    size={size}
                    hue={w.hue}
                    sat={w.sat}
                    hidden={this.state.hiddenWheels[mode]}
                    onChangeHueSat={(hue, sat) => this.updateWheel(mode, hue, sat)}
                    onChangeHidden={hidden => this.setHidden(mode, hidden)}
                />
                <div className='PhotoColorGrading-wheelLabel'>{msg(`PhotoColorGrading_mode_${mode}`)}</div>
            </div>
        )
    }

    /** The Effects section: texture/clarity/dehaze, then the Vignette and Grain groups */
    private renderEffects(): JSX.Element {
        return (
            <>
                {this.slider('effects.texture')}
                {this.slider('effects.clarity')}
                {this.slider('effects.dehaze')}
                <div className='PhotoColorGrading-subTitle'>Vignette</div>
                {this.slider('vignette.amount')}
                {this.slider('vignette.midpoint')}
                {this.slider('vignette.roundness')}
                {this.slider('vignette.feather')}
                {this.slider('vignette.highlights')}
                <div className='PhotoColorGrading-subTitle'>Grain</div>
                {this.slider('grain.amount')}
                {this.slider('grain.size')}
                {this.slider('grain.roughness')}
            </>
        )
    }

    /** The Detail section: sharpening and noise reduction */
    private renderDetail(): JSX.Element {
        return (
            <>
                {this.slider('detail.sharpenAmount')}
                {this.slider('detail.sharpenRadius')}
                {this.slider('detail.sharpenDetail')}
                {this.slider('detail.sharpenMasking')}
                <div className='PhotoColorGrading-subTitle'>Noise Reduction</div>
                {this.slider('detail.nrLuminance')}
                {this.slider('detail.nrDetail')}
                {this.slider('detail.nrContrast')}
                {this.slider('detail.nrColor')}
                {this.slider('detail.nrColorDetail')}
                {this.slider('detail.nrColorSmoothness')}
            </>
        )
    }

    /** The Calibration section: shadows tint and the primary hue/saturation controls */
    private renderCalibration(): JSX.Element {
        return (
            <>
                {this.slider('calibration.shadowsTint')}
                {this.slider('calibration.redHue')}
                {this.slider('calibration.redSat')}
                {this.slider('calibration.greenHue')}
                {this.slider('calibration.greenSat')}
                {this.slider('calibration.blueHue')}
                {this.slider('calibration.blueSat')}
            </>
        )
    }

}

export { isDevelopNeutral } from 'app/util/DevelopUtil'
