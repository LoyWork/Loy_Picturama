import classNames from 'classnames'
import React from 'react'

import { Icon } from '@blueprintjs/core'

import { bindMany } from 'app/util/LangUtil'

import './ColorGradingWheel.less'


/**
 * The wheel is drawn once per size into a cached canvas and blitted from there: rebuilding the
 * gradient every frame made dragging stutter on hi-res displays. The colours follow LightCraft's
 * wheels (soft hues, not full saturation, with a dark rim).
 */
const wheelCanvasCache: { [size: number]: HTMLCanvasElement } = {}

function getWheelCanvas(size: number): HTMLCanvasElement {
    let canvas = wheelCanvasCache[size]
    if (canvas) {
        return canvas
    }
    canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const radius = size / 2
    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - radius
            const dy = y + 0.5 - radius
            const distance = Math.sqrt(dx * dx + dy * dy)
            const index = (y * size + x) * 4
            if (distance > radius) {
                // transparent outside the wheel
                image.data[index + 3] = 0
                continue
            }
            // hue from the angle, saturation from the distance. +90° because canvas x/y is
            // clockwise from east while the wheel's 0° is east going counter-clockwise
            const hue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360
            const sat = Math.min(1, distance / (radius - 1))
            const [r, g, b] = hsvToRgbBytes(hue, sat * 0.75, 0.8)
            image.data[index] = r
            image.data[index + 1] = g
            image.data[index + 2] = b
            // soften the outer edge with one antialiased pixel
            image.data[index + 3] = Math.round(255 * Math.min(1, radius - distance))
        }
    }
    ctx.putImageData(image, 0, 0)
    wheelCanvasCache[size] = canvas
    return canvas
}

function hsvToRgbBytes(h: number, s: number, v: number): [number, number, number] {
    const c = v * s
    const hp = ((h % 360) + 360) % 360 / 60
    const x = c * (1 - Math.abs(hp % 2 - 1))
    let rgb: [number, number, number]
    if (hp < 1)      rgb = [c, x, 0]
    else if (hp < 2) rgb = [x, c, 0]
    else if (hp < 3) rgb = [0, c, x]
    else if (hp < 4) rgb = [0, x, c]
    else if (hp < 5) rgb = [x, 0, c]
    else             rgb = [c, 0, x]
    const m = v - c
    return [ Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255) ]
}


/** A constraint held while dragging: keep the hue (move along the spoke) or the saturation */
type WheelLock = { kind: 'hue', hue: number } | { kind: 'sat', sat: number }

export interface Props {
    /** e.g. 'grading-wheel-shadows' — must be unique, it keys the DOM input */
    id: string
    className?: string
    /** Wheel diameter in px */
    size: number
    hue: number
    sat: number
    /** The wheel's effect is temporarily hidden (drawn dark, with an eye to bring it back) */
    hidden?: boolean
    onChangeHueSat(hue: number, sat: number): void
    onChangeHidden(hidden: boolean): void
}

interface State {
    /** While dragging, the locally shown hue/sat (the parent may round or debounce its state) */
    dragHue: number | null
    dragSat: number | null
    /** The constraint held while dragging (from Shift / Ctrl/Cmd, like LightCraft's wheels) */
    lock: WheelLock | null
    /** The puck as it was when the drag grabbed it (origin of a fine adjust) */
    grabHue: number
    grabSat: number
    grabOffset: { x: number, y: number } | null
    grabPointer: { x: number, y: number } | null
    /** Whether the pointer is over the wheel (shows the readout and the eye) */
    hovering: boolean
}

/**
 * A colour grading wheel in the style of LightCraft's: drag to pick hue (angle) and saturation
 * (distance from the centre), double-click to reset, and an eye at its bottom-left corner that
 * hides this wheel's effect on the photo for viewing. Shift keeps the hue, Ctrl/Cmd keeps the
 * saturation (a guide line/ring shows the constraint), Alt fine-adjusts (the puck moves a tenth
 * as far as the pointer). While hovered, `H …° S …` shows centred above the wheel.
 */
export default class ColorGradingWheel extends React.Component<Props, State> {

    private canvasRef = React.createRef<HTMLCanvasElement>()

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onDoubleClick',
            'onContextMenu', 'onMouseEnter', 'onMouseLeave')
        this.state = {
            dragHue: null,
            dragSat: null,
            lock: null,
            grabHue: 0,
            grabSat: 0,
            grabOffset: null,
            grabPointer: null,
            hovering: false,
        }
    }

    get shownHue(): number {
        return this.state.dragHue ?? this.props.hue
    }

    get shownSat(): number {
        return this.state.dragSat ?? this.props.sat
    }

    private get isDragging(): boolean {
        return this.state.dragHue !== null
    }

    componentDidUpdate(prevProps: Props) {
        if (prevProps.size !== this.props.size || prevProps.hidden !== this.props.hidden) {
            this.drawWheel()
        }
        if (!this.isDragging && (prevProps.hue !== this.props.hue || prevProps.sat !== this.props.sat)) {
            this.drawWheel()
        }
    }

    componentDidMount() {
        this.drawWheel()
    }

    private drawWheel() {
        const canvas = this.canvasRef.current
        if (!canvas) {
            return
        }
        const { size } = this.props
        const ctx = canvas.getContext('2d')!
        const radius = size / 2
        ctx.clearRect(0, 0, size, size)
        ctx.drawImage(getWheelCanvas(size), 0, 0)

        // Dark rim around the wheel (like LightCraft's wheels)
        ctx.beginPath()
        ctx.arc(radius, radius, radius - 0.5, 0, Math.PI * 2)
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(40, 40, 40, 0.9)'
        ctx.stroke()

        // Dashed saturation guide rings at 25 / 50 / 75 % on the large single wheel
        if (size >= 120) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
            ctx.lineWidth = 0.8
            ctx.setLineDash([4, 3.5])
            for (const f of [0.25, 0.5, 0.75]) {
                ctx.beginPath()
                ctx.arc(radius, radius, radius * f, 0, Math.PI * 2)
                ctx.stroke()
            }
            ctx.setLineDash([])
        }

        if (this.props.hidden) {
            // Hidden wheel: dark overlay like LightCraft's
            ctx.beginPath()
            ctx.arc(radius, radius, radius, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
            ctx.fill()
        }

        // The constraint guide while a lock is held (the spoke for hue, the ring for saturation)
        if (this.state.lock) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
            ctx.lineWidth = 1.5
            if (this.state.lock.kind === 'hue') {
                const a = this.state.lock.hue * Math.PI / 180
                ctx.beginPath()
                ctx.moveTo(radius, radius)
                ctx.lineTo(radius + Math.cos(a) * radius, radius - Math.sin(a) * radius)
                ctx.stroke()
            } else {
                ctx.beginPath()
                ctx.arc(radius, radius, radius * this.state.lock.sat / 100, 0, Math.PI * 2)
                ctx.stroke()
            }
        }

        // The neutral centre dot and the puck
        ctx.beginPath()
        ctx.arc(radius, radius, 2, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()

        const hueRad = this.shownHue * Math.PI / 180
        const distance = this.shownSat / 100 * (radius - 2)
        const x = radius + Math.cos(hueRad) * distance
        const y = radius - Math.sin(hueRad) * distance
        ctx.beginPath()
        ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = this.props.hidden ? 'rgb(150, 150, 150)' : '#fff'
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = '#000'
        ctx.stroke()
    }

    private modifiersOf(event: React.PointerEvent | React.MouseEvent): { keepHue: boolean, keepSat: boolean, fine: boolean } {
        return {
            keepHue: event.shiftKey,
            // Shift wins when both are down: keeping both would freeze the puck
            keepSat: (event.ctrlKey || event.metaKey) && !event.shiftKey,
            fine: event.altKey,
        }
    }

    private lockOf(mods: { keepHue: boolean, keepSat: boolean }): WheelLock | null {
        if (mods.keepHue) {
            return { kind: 'hue', hue: this.state.grabHue }
        }
        if (mods.keepSat) {
            return { kind: 'sat', sat: this.state.grabSat }
        }
        return null
    }

    private hueSatFromEvent(event: React.PointerEvent | React.MouseEvent): { hue: number, sat: number } {
        const canvas = this.canvasRef.current!
        const rect = canvas.getBoundingClientRect()
        const vx = event.clientX - rect.left - rect.width / 2
        const vy = event.clientY - rect.top - rect.height / 2
        const radius = rect.width / 2
        const mods = this.modifiersOf(event)
        const lock = this.lockOf(mods)

        if (mods.fine && this.state.grabOffset && this.state.grabPointer) {
            // Fine adjust: the puck moves a tenth of the pointer's travel since the grab
            const travelX = vx - (this.state.grabPointer.x)
            const travelY = vy - (this.state.grabPointer.y)
            const grabRad = this.state.grabHue * Math.PI / 180
            const grabDist = this.state.grabSat / 100 * radius
            const puckX = Math.cos(grabRad) * grabDist + (vx - this.state.grabOffset.x) * 0.1
            const puckY = -Math.sin(grabRad) * grabDist + (vy - this.state.grabOffset.y) * 0.1
            void travelX
            void travelY
            return this.pick({ x: puckX, y: puckY }, lock)
        }
        return this.pick({ x: vx, y: vy }, lock)
    }

    /** Hue (degrees) and saturation (0..100) for an offset from the wheel's centre, honouring a lock */
    private pick(v: { x: number, y: number }, lock: WheelLock | null): { hue: number, sat: number } {
        const radius = (this.props.size / 2) || 1
        const angle = () => ((Math.atan2(-v.y, v.x) * 180 / Math.PI) + 360) % 360
        if (lock?.kind === 'hue') {
            const a = lock.hue * Math.PI / 180
            const along = v.x * Math.cos(a) - v.y * Math.sin(a)
            return { hue: lock.hue, sat: clamp01(along / radius) * 100 }
        }
        if (lock?.kind === 'sat') {
            return { hue: angle(), sat: lock.sat }
        }
        return { hue: angle(), sat: clamp01(Math.sqrt(v.x * v.x + v.y * v.y) / radius) * 100 }
    }

    private onPointerDown(event: React.PointerEvent) {
        if (event.button !== 0) {
            return
        }
        event.preventDefault()
        const canvas = this.canvasRef.current!
        canvas.setPointerCapture(event.pointerId)

        const startHue = this.shownHue
        const startSat = this.shownSat
        const rect = canvas.getBoundingClientRect()
        const { hue, sat } = this.hueSatFromEvent(event)
        this.setState({
            dragHue: hue,
            dragSat: sat,
            lock: this.lockOf(this.modifiersOf(event)),
            grabHue: startHue,
            grabSat: startSat,
            grabOffset: { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 },
            grabPointer: { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 },
        })
        this.props.onChangeHueSat(hue, sat)
    }

    private onPointerMove(event: React.PointerEvent) {
        if (!this.isDragging) {
            return
        }
        // A modifier pressed or released mid-drag re-grabs the puck as it is at that moment
        const lock = this.lockOf(this.modifiersOf(event))
        if (JSON.stringify(lock) !== JSON.stringify(this.state.lock)) {
            this.setState({ lock, grabHue: this.shownHue, grabSat: this.shownSat })
        }
        const { hue, sat } = this.hueSatFromEvent(event)
        this.setState({ dragHue: hue, dragSat: sat })
        this.drawWheel()
        this.props.onChangeHueSat(hue, sat)
    }

    private onPointerUp(event: React.PointerEvent) {
        if (!this.isDragging) {
            return
        }
        const canvas = this.canvasRef.current!
        if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId)
        }
        const { hue, sat } = this.hueSatFromEvent(event)
        this.setState({ dragHue: null, dragSat: null, lock: null, grabOffset: null, grabPointer: null })
        this.props.onChangeHueSat(hue, sat)
    }

    private onDoubleClick(event: React.MouseEvent) {
        event.preventDefault()
        this.setState({ dragHue: null, dragSat: null, lock: null, grabOffset: null, grabPointer: null })
        this.props.onChangeHueSat(0, 0)
    }

    private onContextMenu(event: React.MouseEvent) {
        // The wheel is a drag surface: don't open the photo's context menu over it
        event.preventDefault()
        event.stopPropagation()
    }

    private onMouseEnter() {
        this.setState({ hovering: true })
    }

    private onMouseLeave() {
        if (!this.isDragging) {
            this.setState({ hovering: false })
        }
    }

    render() {
        const { props, state } = this
        const showReadout = props.size < 120 && (state.hovering || this.isDragging)
        return (
            <div
                className={classNames(props.className, 'ColorGradingWheel')}
                onMouseEnter={this.onMouseEnter}
                onMouseLeave={this.onMouseLeave}
            >
                {showReadout &&
                    <div className='ColorGradingWheel-readout'>
                        {`H ${Math.round(this.shownHue)}°  S ${Math.round(this.shownSat)}`}
                    </div>
                }
                <div className='ColorGradingWheel-canvasWrap'>
                    <canvas
                        id={props.id}
                        ref={this.canvasRef}
                        className='ColorGradingWheel-canvas'
                        width={props.size}
                        height={props.size}
                        style={{ width: props.size, height: props.size }}
                        onPointerDown={this.onPointerDown}
                        onPointerMove={this.onPointerMove}
                        onPointerUp={this.onPointerUp}
                        onDoubleClick={this.onDoubleClick}
                        onContextMenu={this.onContextMenu}
                    />
                    {(state.hovering || props.hidden) &&
                        <button
                            type='button'
                            className={classNames('ColorGradingWheel-eye', { isHidden: props.hidden })}
                            onClick={() => props.onChangeHidden(!props.hidden)}
                        >
                            <Icon icon={props.hidden ? 'eye-off' : 'eye-open'} iconSize={13} />
                        </button>
                    }
                </div>
            </div>
        )
    }

}


function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}
