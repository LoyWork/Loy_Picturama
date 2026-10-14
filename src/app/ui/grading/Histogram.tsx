import classNames from 'classnames'
import React from 'react'

import { Photo } from 'app/CommonTypes'
import { HistogramData, smoothHistogram } from 'app/util/DevelopUtil'
import { bindMany } from 'app/util/LangUtil'

import './Histogram.less'


/** The histogram's plot area height (like LightCraft's 118px plot) */
const PLOT_HEIGHT = 118
/** Height of the EXIF strip under the plot */
const EXIF_HEIGHT = 22

export interface Props {
    style?: any
    className?: any
    photo?: Photo
    /** The histogram of the rendered photo (live, from the render pipeline) */
    histogram?: HistogramData | null
}

interface State {
    /** Whether the clipping indicators are shown */
    showClipping: boolean
}

/**
 * The RGB histogram at the top of the develop panel (like LightCraft's): smoothed RGB channel
 * lines over a luminance fill, clipping indicators in the top corners, and an EXIF strip (ISO ·
 * focal length · aperture · shutter) under the plot.
 */
export default class Histogram extends React.Component<Props, State> {

    private canvasRef = React.createRef<HTMLCanvasElement>()

    constructor(props: Props) {
        super(props)
        bindMany(this, 'onToggleClipping')
        this.state = { showClipping: false }
    }

    componentDidUpdate(prevProps: Props) {
        if (prevProps.histogram !== this.props.histogram || prevProps.className !== this.props.className) {
            this.draw()
        }
    }

    componentDidMount() {
        this.draw()
    }

    private onToggleClipping() {
        this.setState(state => ({ showClipping: !state.showClipping }))
    }

    private draw() {
        const canvas = this.canvasRef.current
        if (!canvas) {
            return
        }
        const dpr = window.devicePixelRatio || 1
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = Math.max(1, Math.round(width * dpr))
            canvas.height = Math.max(1, Math.round(height * dpr))
        }
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, width, height)

        // panel background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        ctx.fillRect(0, 0, width, height)

        const plot = { x: 0, y: 6, w: width, h: height - 6 - EXIF_HEIGHT }

        const hist = this.props.histogram
        if (hist) {
            const r = smoothHistogram(hist.r)
            const g = smoothHistogram(hist.g)
            const b = smoothHistogram(hist.b)

            // peak over the middle bins (like LightCraft: skip the extreme clipping bins)
            let peak = 1
            for (const v of [ r, g, b ]) {
                for (let i = 2; i < 254; i++) {
                    peak = Math.max(peak, v[i])
                }
            }

            const to = (i: number, v: number) => [ plot.x + plot.w * i / 255, plot.y + plot.h - plot.h * Math.min(1, Math.sqrt(v / peak)) ] as [number, number]

            // luminance fill (grey, like LightCraft's)
            const lum = new Array(256)
            for (let i = 0; i < 256; i++) {
                lum[i] = (r[i] + g[i] + b[i]) / 3
            }
            ctx.beginPath()
            for (let i = 0; i < 256; i++) {
                const [ x, y ] = to(i, lum[i])
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.lineTo(plot.x + plot.w, plot.y + plot.h)
            ctx.lineTo(plot.x, plot.y + plot.h)
            ctx.closePath()
            ctx.fillStyle = 'rgba(150, 150, 150, 0.25)'
            ctx.fill()

            // greyscale images: the three channels coincide — draw one neutral line
            let spread = 0
            let total = 0
            for (let i = 0; i < 256; i++) {
                spread += Math.abs(r[i] - g[i]) + Math.abs(g[i] - b[i])
                total += g[i]
            }
            ctx.lineWidth = 1.5
            if (spread / Math.max(total, 1) < 0.02) {
                ctx.strokeStyle = 'rgba(200, 200, 200, 0.8)'
                ctx.beginPath()
                for (let i = 0; i < 256; i++) {
                    const [ x, y ] = to(i, g[i])
                    if (i === 0) ctx.moveTo(x, y)
                    else ctx.lineTo(x, y)
                }
                ctx.stroke()
            } else {
                // RGB channel lines (LightCraft's colours)
                for (const [ v, c ] of [ [ r, '#df3939' ], [ g, '#44b072' ], [ b, '#3b6fe0' ] ] as [number[], string][]) {
                    ctx.strokeStyle = c
                    ctx.beginPath()
                    for (let i = 0; i < 256; i++) {
                        const [ x, y ] = to(i, v[i])
                        if (i === 0) ctx.moveTo(x, y)
                        else ctx.lineTo(x, y)
                    }
                    ctx.stroke()
                }
            }

            // clipping indicators: triangles in the top corners when either end clips
            let loSum = 0
            let hiSum = 0
            for (const v of [ r, g, b ]) {
                loSum += v[0]
                hiSum += v[255]
            }
            const totalBins = Math.max(1, loSum + hiSum)
            const showClipping = this.state.showClipping
            for (const [ on, x, active ] of [
                [ loSum / totalBins > 0.003, plot.x + 12, showClipping ],
                [ hiSum / totalBins > 0.003, plot.x + plot.w - 12, showClipping ],
            ] as [boolean, number, boolean][]) {
                ctx.beginPath()
                ctx.moveTo(x, plot.y + 4)
                ctx.lineTo(x - 7, plot.y + 16)
                ctx.lineTo(x + 7, plot.y + 16)
                ctx.closePath()
                ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(60, 60, 60, 0.9)'
                ctx.fill()
                ctx.strokeStyle = on ? '#fff' : 'rgba(130, 130, 130, 0.9)'
                ctx.lineWidth = 1
                ctx.stroke()
            }
        }

        // EXIF strip (like LightCraft's: ISO · focal · aperture · shutter)
        const photo = this.props.photo
        if (photo) {
            const parts: string[] = []
            const exif = (photo as any).exif || {}
            if (exif.iso !== undefined) parts.push(`ISO ${exif.iso}`)
            if (exif.focalLength !== undefined) parts.push(`${Math.round(exif.focalLength)}mm`)
            if (exif.fNumber !== undefined) parts.push(`f/${exif.fNumber}`)
            if (exif.exposureTime) parts.push(String(exif.exposureTime))
            if (parts.length) {
                ctx.font = '11px system-ui, sans-serif'
                ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(parts.join(' · '), width / 2, height - EXIF_HEIGHT / 2)
            }
        }
    }

    render() {
        return (
            <div
                className={classNames(this.props.className, 'Histogram')}
                style={this.props.style}
                onClick={this.onToggleClipping}
            >
                <canvas
                    ref={this.canvasRef}
                    className='Histogram-canvas'
                />
            </div>
        )
    }

}
