import classNames from 'classnames'
import React from 'react'

import { ControlSpec, findControl, formatControlValue, trackStops } from 'app/util/DevelopUtil'
import { bindMany } from 'app/util/LangUtil'

import './DevelopSlider.less'


export interface Props {
    className?: string
    style?: any
    /** The control to edit (either a spec object or a control id like 'light.exposure') */
    control: ControlSpec | string
    value: number
    enabled?: boolean
    onChange(value: number): void
    /** A finished drag/click/typed edit (the debounced save) */
    onChangeCommitted?(value: number): void
}

interface State {
    /** While dragging, the locally shown value (the parent's state may lag) */
    dragValue: number | null
    /** The value the drag started from (origin of a Shift fine-adjust) */
    grabValue: number | null
    grabX: number | null
    /** Whether the value readout is being edited (an exact value can be typed) */
    typing: boolean
    typingText: string
}

/**
 * A Lightroom/LightCraft slider row: label and value above a track, hollow ring thumb. The track
 * carries the control's gradient (blue..yellow for temperature, the band colour for mixer
 * sliders, a plain grey bar otherwise). Double-click resets to the default, Shift-drag is a fine
 * adjustment (a tenth of the movement), and clicking the value lets you type an exact one
 * (Return or clicking away applies it, Esc keeps the old one).
 */
export default class DevelopSlider extends React.Component<Props, State> {

    private trackRef = React.createRef<HTMLDivElement>()

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onDoubleClick',
            'onValueClick', 'onValueKeyDown', 'onValueBlur')
        this.state = {
            dragValue: null,
            grabValue: null,
            grabX: null,
            typing: false,
            typingText: '',
        }
    }

    private get spec(): ControlSpec {
        const control = this.props.control
        const spec = typeof control === 'string' ? findControl(control) : control
        if (!spec) {
            throw new Error(`Unknown develop control: ${control}`)
        }
        return spec
    }

    get shownValue(): number {
        return this.state.dragValue ?? this.props.value
    }

    private get isDragging(): boolean {
        return this.state.dragValue !== null
    }

    private clamp(v: number): number {
        const { spec } = this
        const stepped = Math.round(v / spec.step) * spec.step
        // avoid floating point dust (0.30000000000000004)
        return Number(Math.max(spec.min, Math.min(spec.max, stepped)).toFixed(spec.decimals + 2))
    }

    /** The position on the track (0..1) of a value. Temperature follows Lightroom's scale */
    private positionOf(v: number): number {
        const { spec } = this
        if (spec.id === 'wb.temp') {
            // 2000..7000 K fill the left half evenly; the right half grows logarithmically to 50000 K
            const centre = 7000
            const vClamped = Math.max(spec.min, Math.min(spec.max, v))
            if (vClamped > centre) {
                const knee = 1000
                return 0.5 + 0.5 * (1 + Math.log((vClamped - centre) / knee) / Math.log(1 + (spec.max - centre) / knee))
            }
            return 0.5 * (vClamped - spec.min) / (centre - spec.min)
        }
        return (v - spec.min) / (spec.max - spec.min)
    }

    /** The value at a track position (0..1) */
    private valueAt(p: number): number {
        const { spec } = this
        const pc = Math.max(0, Math.min(1, p))
        if (spec.id === 'wb.temp') {
            const centre = 7000
            if (pc > 0.5) {
                const knee = 1000
                return centre + knee * (Math.exp((2 * pc - 1) * Math.log(1 + (spec.max - centre) / knee)) - 1)
            }
            return spec.min + 2 * pc * (centre - spec.min)
        }
        return spec.min + pc * (spec.max - spec.min)
    }

    private valueFromEvent(event: React.PointerEvent): number {
        const track = this.trackRef.current
        if (!track) {
            return this.shownValue
        }
        const rect = track.getBoundingClientRect()
        const p = (event.clientX - rect.left) / rect.width
        return this.valueAt(p)
    }

    private onPointerDown(event: React.PointerEvent) {
        if (this.props.enabled === false || event.button !== 0) {
            return
        }
        event.preventDefault()
        const track = this.trackRef.current
        if (track) {
            track.setPointerCapture(event.pointerId)
        }
        const v = this.valueFromEvent(event)
        this.setState({ dragValue: v, grabValue: this.shownValue, grabX: event.clientX })
        this.props.onChange(this.clamp(v))
    }

    private onPointerMove(event: React.PointerEvent) {
        if (!this.isDragging) {
            return
        }
        let v: number
        if (event.shiftKey && this.state.grabValue !== null && this.state.grabX !== null) {
            // Fine adjust: the value moves a tenth of the pointer's travel since the grab
            const { spec } = this
            const unit = spec.id === 'wb.temp' ? 50 : (spec.max - spec.min) / 200
            v = this.state.grabValue + (event.clientX - this.state.grabX) * unit * 0.1 * 2
        } else {
            v = this.valueFromEvent(event)
        }
        this.setState({ dragValue: v })
        this.props.onChange(this.clamp(v))
    }

    private onPointerUp(event: React.PointerEvent) {
        if (!this.isDragging) {
            return
        }
        const track = this.trackRef.current
        if (track && track.hasPointerCapture(event.pointerId)) {
            track.releasePointerCapture(event.pointerId)
        }
        const v = this.clamp(this.state.dragValue!)
        this.setState({ dragValue: null, grabValue: null, grabX: null })
        this.props.onChangeCommitted?.(v)
    }

    private onDoubleClick() {
        const { spec } = this
        this.setState({ dragValue: null, grabValue: null, grabX: null })
        this.props.onChange(spec.default)
        this.props.onChangeCommitted?.(spec.default)
    }

    private onValueClick(event: React.MouseEvent) {
        if (this.props.enabled === false) {
            return
        }
        event.stopPropagation()
        this.setState({ typing: true, typingText: formatControlValue(this.spec, this.shownValue).replace(/^\+/, '') })
    }

    private onValueKeyDown(event: React.KeyboardEvent) {
        if (event.key === 'Return' || event.key === 'Enter') {
            this.commitTyping()
        } else if (event.key === 'Escape') {
            this.setState({ typing: false })
        }
    }

    private onValueBlur() {
        this.commitTyping()
    }

    private commitTyping() {
        if (!this.state.typing) {
            return
        }
        const { spec } = this
        const text = this.state.typingText.trim().replace(',', '.').replace(/[Kk%\s]/g, '')
        const parsed = parseFloat(text)
        this.setState({ typing: false })
        if (Number.isFinite(parsed)) {
            const v = this.clamp(parsed)
            if (Math.abs(v - this.props.value) > 1e-9) {
                this.props.onChange(v)
                this.props.onChangeCommitted?.(v)
            }
        }
    }

    render() {
        const { spec } = this
        const enabled = this.props.enabled !== false
        const v = this.shownValue
        const p = Math.max(0, Math.min(1, this.positionOf(v)))
        const stops = trackStops(spec.track)

        let trackStyle: React.CSSProperties
        if (stops) {
            const colors = stops.map(c => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`)
            trackStyle = { background: `linear-gradient(to right, ${colors.join(', ')})` }
        } else {
            trackStyle = { background: 'rgba(255, 255, 255, 0.18)' }
        }

        return (
            <div className={classNames(this.props.className, 'DevelopSlider', { isDisabled: !enabled })} style={this.props.style}>
                <div className='DevelopSlider-top'>
                    <span
                        className='DevelopSlider-label'
                        onDoubleClick={this.onDoubleClick}
                    >
                        {spec.label}
                    </span>
                    {this.state.typing
                        ? <input
                            className='DevelopSlider-valueInput'
                            autoFocus
                            value={this.state.typingText}
                            onChange={e => this.setState({ typingText: e.target.value })}
                            onKeyDown={this.onValueKeyDown}
                            onBlur={this.onValueBlur}
                        />
                        : <span
                            className='DevelopSlider-value'
                            title='Click to type a value'
                            onClick={this.onValueClick}
                        >
                            {formatControlValue(spec, v)}
                        </span>
                    }
                </div>
                <div
                    ref={this.trackRef}
                    className='DevelopSlider-track'
                    style={trackStyle}
                    onPointerDown={this.onPointerDown}
                    onPointerMove={this.onPointerMove}
                    onPointerUp={this.onPointerUp}
                    onDoubleClick={this.onDoubleClick}
                >
                    {spec.track.kind === 'centered' &&
                        <div
                            className='DevelopSlider-zero'
                            style={{ left: `${this.positionOf(0) * 100}%` }}
                        />
                    }
                    <div
                        className='DevelopSlider-thumb'
                        style={{ left: `${p * 100}%` }}
                    />
                </div>
            </div>
        )
    }

}
