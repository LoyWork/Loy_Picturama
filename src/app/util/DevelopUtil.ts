// Develop maths, following LightCraft's pipeline (see `crates/pipeline/src/` and
// `crates/develop/src/controls.rs`): the constants, ranges and track colours of every develop
// control, plus the shared OkLab conversions already in use by the grading shader.
//
// The photo texture arrives as sRGB-encoded bytes; the shader converts to linear light itself.
// This module holds what the UI needs (control specs, track gradients, band colours) and the
// maths shared between the shader (same formulas, GLSL) and the UI (histogram, curve preview).

import { DevelopSettings, MixerBand } from 'app/CommonTypes'
import { isNeutral } from 'app/util/ColorGradingUtil'


// ---------------------------------------------------------------------------
// Control specs (mirrors LightCraft's `controls!` table, in panel order)
// ---------------------------------------------------------------------------

/** How a slider's track is drawn */
export type Track =
    | { kind: 'plain' }
    | { kind: 'centered' }
    | { kind: 'temp' }
    | { kind: 'tint' }
    | { kind: 'gradient', from: string, to: string }
    | { kind: 'hue', band: number }
    | { kind: 'sat', band: number }
    | { kind: 'lum', band: number }
    | { kind: 'rainbow' }

export interface ControlSpec {
    /** e.g. 'light.exposure' */
    id: string
    label: string
    /** The panel section the control belongs to */
    section: SectionId
    min: number
    max: number
    default: number
    step: number
    /** Decimal places shown */
    decimals: number
    track: Track
}

export type SectionId = 'light' | 'color' | 'mixer' | 'grading' | 'effects' | 'detail' | 'calibration'

/** Display colour of each mixer band, as LightCraft's `BAND_COLORS` */
export const BAND_COLORS: string[] = [ '#aa0000', '#bb6600', '#aaaa00', '#009900', '#00aaaa', '#0044cc', '#7722aa', '#aa0077' ]

const BAND_ORDER: MixerBand[] = [ 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta' ]

function band(name: MixerBand): number {
    return BAND_ORDER.indexOf(name)
}

/** All numeric develop controls, in panel order (mirrors LightCraft's `CONTROLS`) */
export const CONTROLS: ControlSpec[] = [
    { id: 'wb.temp', label: 'Temp', section: 'color', min: 2000, max: 50000, default: 6500, step: 50, decimals: 0, track: { kind: 'temp' } },
    { id: 'wb.tint', label: 'Tint', section: 'color', min: -150, max: 150, default: 0, step: 1, decimals: 0, track: { kind: 'tint' } },
    { id: 'light.exposure', label: 'Exposure', section: 'light', min: -5, max: 5, default: 0, step: 0.01, decimals: 2, track: { kind: 'centered' } },
    { id: 'light.contrast', label: 'Contrast', section: 'light', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'light.highlights', label: 'Highlights', section: 'light', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'light.shadows', label: 'Shadows', section: 'light', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'light.whites', label: 'Whites', section: 'light', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'light.blacks', label: 'Blacks', section: 'light', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'color.vibrance', label: 'Vibrance', section: 'color', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#7a7a7a', to: '#d8406a' } },
    { id: 'color.saturation', label: 'Saturation', section: 'color', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#7a7a7a', to: '#e04a3a' } },
    ...BAND_ORDER.flatMap(b => [
        { id: `mixer.${b}.hue`, label: `${cap(b)} Hue`, section: 'mixer' as SectionId, min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'hue', band: band(b) } as Track },
        { id: `mixer.${b}.sat`, label: `${cap(b)} Saturation`, section: 'mixer' as SectionId, min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'sat', band: band(b) } as Track },
        { id: `mixer.${b}.lum`, label: `${cap(b)} Luminance`, section: 'mixer' as SectionId, min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'lum', band: band(b) } as Track },
    ]),
    ...(['shadows', 'midtones', 'highlights', 'global'] as const).flatMap(mode => [
        { id: `grading.${mode}.hue`, label: 'Hue', section: 'grading' as SectionId, min: 0, max: 360, default: 0, step: 1, decimals: 0, track: { kind: 'rainbow' } as Track },
        { id: `grading.${mode}.sat`, label: 'Saturation', section: 'grading' as SectionId, min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } as Track },
        { id: `grading.${mode}.lum`, label: 'Luminance', section: 'grading' as SectionId, min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } as Track },
    ]),
    ...BAND_ORDER.map(b => ({ id: `bwMix.${b}`, label: cap(b), section: 'mixer' as SectionId, min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } as Track })),
    { id: 'grading.blending', label: 'Blending', section: 'grading', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'grading.balance', label: 'Balance', section: 'grading', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'effects.texture', label: 'Texture', section: 'effects', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'effects.clarity', label: 'Clarity', section: 'effects', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'effects.dehaze', label: 'Dehaze', section: 'effects', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'vignette.amount', label: 'Vignette', section: 'effects', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#101010', to: '#f0f0f0' } },
    { id: 'vignette.midpoint', label: 'Midpoint', section: 'effects', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'vignette.roundness', label: 'Roundness', section: 'effects', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'centered' } },
    { id: 'vignette.feather', label: 'Feather', section: 'effects', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'vignette.highlights', label: 'Highlights', section: 'effects', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'grain.amount', label: 'Grain', section: 'effects', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'grain.size', label: 'Size', section: 'effects', min: 0, max: 100, default: 25, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'grain.roughness', label: 'Roughness', section: 'effects', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.sharpenAmount', label: 'Sharpening', section: 'detail', min: 0, max: 150, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.sharpenRadius', label: 'Radius', section: 'detail', min: 0.5, max: 3, default: 1, step: 0.1, decimals: 1, track: { kind: 'plain' } },
    { id: 'detail.sharpenDetail', label: 'Detail', section: 'detail', min: 0, max: 100, default: 25, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.sharpenMasking', label: 'Masking', section: 'detail', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrLuminance', label: 'Noise Reduction', section: 'detail', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrDetail', label: 'Detail', section: 'detail', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrContrast', label: 'Contrast', section: 'detail', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrColor', label: 'Color Noise Reduction', section: 'detail', min: 0, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrColorDetail', label: 'Detail', section: 'detail', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'detail.nrColorSmoothness', label: 'Smoothness', section: 'detail', min: 0, max: 100, default: 50, step: 1, decimals: 0, track: { kind: 'plain' } },
    { id: 'calibration.shadowsTint', label: 'Shadows Tint', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'tint' } },
    { id: 'calibration.redHue', label: 'Red Hue', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#e0306a', to: '#e08a30' } },
    { id: 'calibration.redSat', label: 'Red Saturation', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#7a7a7a', to: '#e03a3a' } },
    { id: 'calibration.greenHue', label: 'Green Hue', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#b0c030', to: '#30c08a' } },
    { id: 'calibration.greenSat', label: 'Green Saturation', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#7a7a7a', to: '#40b050' } },
    { id: 'calibration.blueHue', label: 'Blue Hue', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#30a0d0', to: '#8040d0' } },
    { id: 'calibration.blueSat', label: 'Blue Saturation', section: 'calibration', min: -100, max: 100, default: 0, step: 1, decimals: 0, track: { kind: 'gradient', from: '#7a7a7a', to: '#3a60e0' } },
]

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
}

const CONTROLS_BY_ID: { [id: string]: ControlSpec } = {}
for (const c of CONTROLS) {
    CONTROLS_BY_ID[c.id] = c
}

export function findControl(id: string): ControlSpec | undefined {
    return CONTROLS_BY_ID[id]
}

/** A control's value as shown next to its label (like LightCraft's `shown_value`) */
export function formatControlValue(spec: ControlSpec, v: number): string {
    let s = v.toFixed(spec.decimals)
    if (v > 0 && spec.min < 0) {
        s = `+${s}`
    }
    if (s === '+0' || s === '-0' || s === '0' && spec.decimals === 0) {
        return '0'
    }
    return s
}


// ---------------------------------------------------------------------------
// Track gradients (mirrors LightCraft's `track_stops`)
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16)
    return [ (n >> 16) & 255, (n >> 8) & 255, n & 255 ]
}

export function rgbToCss(rgb: [number, number, number]): string {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
    return [ a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t ]
}

function gammaMultiply(rgb: [number, number, number], f: number): [number, number, number] {
    return [ rgb[0] * f, rgb[1] * f, rgb[2] * f ]
}

/** The gradient stops of a track, or `null` for a plain grey one */
export function trackStops(track: Track): [number, number, number][] | null {
    switch (track.kind) {
        case 'plain':
        case 'centered':
            return null
        case 'temp':
            return [ '#193961', '#47566a', '#60666d', '#70705b', '#737339', '#75742a' ].map(hexToRgb)
        case 'tint':
            return [ '#246123', '#2c552c', '#394739', '#4a3d4c', '#6b336b', '#872c87' ].map(hexToRgb)
        case 'gradient':
            return [ hexToRgb(track.from), hexToRgb(track.to) ]
        case 'hue': {
            const i = track.band
            const prev = hexToRgb(BAND_COLORS[(i + 7) % 8])
            const next = hexToRgb(BAND_COLORS[(i + 1) % 8])
            const me = hexToRgb(BAND_COLORS[i])
            return [
                gammaMultiply(prev, 0.7),
                gammaMultiply(lerpRgb(prev, me, 0.5), 0.7),
                gammaMultiply(me, 0.7),
                gammaMultiply(lerpRgb(me, next, 0.5), 0.7),
                gammaMultiply(next, 0.7),
            ]
        }
        case 'sat': {
            const grey = hexToRgb('#454343')
            const me = hexToRgb(BAND_COLORS[track.band])
            return [ grey, gammaMultiply(lerpRgb(grey, me, 0.6), 1), me ]
        }
        case 'lum': {
            const c = hexToRgb(BAND_COLORS[track.band])
            return [ gammaMultiply(c, 0.2), gammaMultiply(c, 0.55), lerpRgb(c, [255, 255, 255], 0.35), lerpRgb(c, [255, 255, 255], 0.6) ]
        }
        case 'rainbow':
            return [ '#aa0000', '#aaaa00', '#009900', '#00aaaa', '#0044cc', '#aa0077', '#aa0000' ].map(hexToRgb)
    }
}


// ---------------------------------------------------------------------------
// Histogram maths (mirrors LightCraft's histogram smoothing)
// ---------------------------------------------------------------------------

/**
 * A 5-point box smooth of a 256-bin histogram, as LightCraft draws it (see `histogram()` in
 * `panels/edit.rs`).
 */
export function smoothHistogram(v: ArrayLike<number>): number[] {
    const out: number[] = []
    for (let i = 0; i < 256; i++) {
        const a = Math.max(i, 2) - 2
        const b = Math.min(i + 3, 256)
        let sum = 0
        for (let k = a; k < b; k++) {
            sum += v[k]
        }
        out.push(sum / (b - a))
    }
    return out
}


/** An RGB histogram of a photo, 256 bins per channel (as drawn by the develop panel) */
export interface HistogramData {
    r: number[]
    g: number[]
    b: number[]
}

/** Bins RGBA8 bytes (as read back from a small offscreen render) into 256-bin per-channel histograms */
export function histogramFromPixels(pixels: Uint8Array, pixelCount: number): HistogramData {
    const r = new Array<number>(256).fill(0)
    const g = new Array<number>(256).fill(0)
    const b = new Array<number>(256).fill(0)
    for (let i = 0; i < pixelCount; i++) {
        const o = i * 4
        r[pixels[o]]++
        g[pixels[o + 1]]++
        b[pixels[o + 2]]++
    }
    return { r, g, b }
}


// ---------------------------------------------------------------------------
// OkLab conversions (shared with the grading shader)
// ---------------------------------------------------------------------------

/** Linear sRGB → OkLab. Returns `[L, a, b]`, each component possibly outside 0..1 for extreme inputs */
export function linearSrgbToOklab(rgb: [number, number, number]): [number, number, number] {
    const l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2])
    const m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2])
    const s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2])
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ]
}


// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

/** True while all the develop settings are neutral (nothing to render or save) */
export function isDevelopNeutral(develop: DevelopSettings | null | undefined): boolean {
    if (!develop) {
        return true
    }
    for (const c of CONTROLS) {
        const parts = c.id.split('.')
        let obj: any = develop
        for (const p of parts.slice(0, -1)) {
            obj = obj?.[p]
        }
        const v = obj?.[parts[parts.length - 1]]
        if (v !== undefined && v !== c.default) {
            return false
        }
    }
    return !develop.treatment && isNeutral(develop.grading)
}
