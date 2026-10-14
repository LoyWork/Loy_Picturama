// Colour grading maths, following LightCraft's approach (see `crates/pipeline/src/colorops.rs`
// and `crates/color/src/perceptual.rs`): the wheels act in the perceptual OkLab space, so the
// same offset looks equally strong on any colour, and a saturated blue shifts differently from a
// dull one in a way that matches how the eye sees it.
//
// The photo texture arrives as sRGB-encoded bytes; the shader converts to linear light itself.
// This module only holds the maths shared between the shader (same formulas, GLSL) and the UI
// (wheel hues, weights preview), plus the wheel hue table.

import { ColorGrading, ColorGradingWheel } from 'app/CommonTypes'


/** How strongly a wheel at sat=100 shifts a colour in OkLab. Same constant as LightCraft's. */
export const wheelChromaStrength = 0.09
/** How strongly a wheel's lum at ±100 shifts lightness in OkLab. */
export const wheelLumStrength = 0.12


// ---------------------------------------------------------------------------
// OkLab conversions (sRGB primaries, linear light). Björn Ottosson, 2020.
// ---------------------------------------------------------------------------

/**
 * Linear sRGB → OkLab. Returns `[L, a, b]`, each component possibly outside 0..1 for extreme
 * inputs (callers clamp the result back).
 */
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

/** OkLab → linear sRGB. Not clamped: the shader clamps after converting back. */
export function oklabToLinearSrgb(lab: [number, number, number]): [number, number, number] {
    const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]
    const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]
    const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2]
    const l = l_ * l_ * l_
    const m = m_ * m_ * m_
    const s = s_ * s_ * s_
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
}


// ---------------------------------------------------------------------------
// Wheel hues
// ---------------------------------------------------------------------------

/**
 * OkLCh hue (radians) of a pure sRGB colour with the given HSV hue (degrees). The wheels are
 * drawn in sRGB hues (0 = red, 120 = green), but the offsets are applied in OkLab, whose hue
 * angles differ — a red wheel puck has to shift a red photo, so the wheel hue is mapped into
 * OkLCh first (same trick as LightCraft's `oklch_hue_of_srgb_hue`).
 */
export function oklchHueOfSrgbHue(deg: number): number {
    const [r, g, b] = hsvToRgb(deg, 1, 1)
    const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)])
    return Math.atan2(lab[2], lab[1])
}


// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

function smooth(e0: number, e1: number, x: number): number {
    const t = clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
}


// ---------------------------------------------------------------------------
// ColorGrading helpers
// ---------------------------------------------------------------------------

/** A wheel with all values neutral (= no effect). */
export const neutralWheel: Required<ColorGradingWheel> = { hue: 0, sat: 0, lum: 0 }

/** True when the grading changes nothing (every wheel neutral, blending/balance ignored). */
export function isNeutral(grading: ColorGrading | undefined | null): boolean {
    return !grading || [grading.shadows, grading.midtones, grading.highlights, grading.global].every(w => isNeutralWheel(w))
}

export function isNeutralWheel(wheel: ColorGradingWheel | undefined | null): boolean {
    return !wheel || !(wheel.sat || wheel.lum)
}

/**
 * The wheel with missing values filled in from `neutralWheel`, so UI code can read `hue`/`sat`/`lum` directly.
 */
export function withDefaults(wheel: ColorGradingWheel | undefined | null): Required<ColorGradingWheel> {
    return { ...neutralWheel, ...wheel }
}

/** A fresh, all-neutral grading object. */
export function neutralGrading(): ColorGrading {
    return {
        shadows: { ...neutralWheel },
        midtones: { ...neutralWheel },
        highlights: { ...neutralWheel },
    }
}

/**
 * True when the two gradings render identically. `blending`/`balance` don't matter while all
 * wheels are neutral, so toggling them alone doesn't mark the photo as edited.
 */
export function isRenderEqual(a: ColorGrading | undefined | null, b: ColorGrading | undefined | null): boolean {
    return isNeutral(a) === isNeutral(b) || (a === b)
}

/** Clamps a wheel's values to their valid ranges (a hand-edited picturama.yml may hold anything). */
export function clampWheel(wheel: ColorGradingWheel): ColorGradingWheel {
    return {
        hue: clamp(wheel.hue ?? 0, 0, 360),
        sat: clamp(wheel.sat ?? 0, 0, 100),
        lum: clamp(wheel.lum ?? 0, -100, 100),
    }
}


// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function srgbToLinear(v: number): number {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** HSV (h in degrees) → RGB, all 0..1. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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
    return [rgb[0] * v + (v - c), rgb[1] * v + (v - c), rgb[2] * v + (v - c)]
}
