import { mat4 } from 'gl-matrix'

import CancelablePromise from 'app/util/CancelablePromise'
import { ColorGrading, DevelopSettings, MixerBand, MIXER_BANDS } from 'app/CommonTypes'
import { Size, Rect } from 'app/util/GeometryTypes'
import { transformRect } from 'app/util/GeometryUtil'
import Profiler from 'app/util/Profiler'
import { isNeutral, oklchHueOfSrgbHue, wheelChromaStrength, wheelLumStrength, withDefaults } from 'app/util/ColorGradingUtil'
import { HistogramData, histogramFromPixels } from 'app/util/DevelopUtil'

import WebGLCanvas, { GraphicBuffer, Texture } from './WebGLCanvas'
import { ColorGradingShader, ColorGradingUniforms, TransformationShader } from './Shaders'


/**
 * Renders a photo using a WebGL canvas. Provides a high-level API suited for Picturama's photo rendering.
 */
export default class PhotoCanvas {

    private webGlCanvas: WebGLCanvas

    private size: Size = { width: 0, height: 0 }
    private clipRect: Rect | null = null

    private projectionMatrix: mat4 = mat4.create()
    private cameraMatrix: mat4

    private baseTexturePromise: CancelablePromise<void> | null = null
    private baseTexture: Texture | null = null
    private unitSquareBuffer: GraphicBuffer
    private transformationShader: TransformationShader
    private colorGradingShader: ColorGradingShader

    /** Offscreen buffer + framebuffer for the histogram's small readback pass */
    private histogramBuffer: WebGLBuffer | null = null
    private histogramFramebuffer: WebGLFramebuffer | null = null
    /** The histogram of the last rendered frame (null until the first successful render) */
    private histogram: HistogramData | null = null

    private colorGrading: ColorGrading | null = null

    private develop: DevelopSettings | null = null


    constructor(private clearColor: readonly [number, number, number, number] = [0, 0, 0, 1]) {
        this.webGlCanvas = new WebGLCanvas()
        const gl = this.webGlCanvas.gl

        this.cameraMatrix = mat4.create()

        // Create a buffer for a unit square (a square from 0,0 to 1,1)
        const squarePositions = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            1.0, 1.0,
        ])
        this.unitSquareBuffer = this.webGlCanvas.createBufferFromData(squarePositions, 2)

        this.transformationShader = new TransformationShader(gl)
        this.colorGradingShader = new ColorGradingShader(gl)
    }

    getElement() {
        return this.webGlCanvas.getElement()
    }

    isValid(): boolean {
        return !!(this.baseTexture)
    }

    /** The RGB histogram of the last successfully rendered frame, or null before the first one */
    getHistogram(): HistogramData | null {
        return this.histogram
    }

    setSize(size: Size): this {
        this.size = size
        return this
    }

    /**
     * Sets the rect where to clip the photo. In projected coordinates.
     */
    setClipRect(clipRect: Rect | null): this {
        this.clipRect = clipRect
        return this
    }

    /**
     * Sets the projection matrix translating from texture coordinates to projected coordinates.
     * See: `doc/geometry-concept.md`
     */
    setProjectionMatrix(projectionMatrix: mat4): this {
        this.projectionMatrix = projectionMatrix
        return this
    }

    /**
     * Sets the camera matrix translating projected coordinates to canvas coordinates.
     * See: `doc/geometry-concept.md`
     */
    setCameraMatrix(cameraMatrix: mat4): this {
        this.cameraMatrix = cameraMatrix
        return this
    }

    /**
     * Sets the colour grading to apply while rendering. `null` or a neutral grading disables it.
     */
    setColorGrading(colorGrading: ColorGrading | null): this {
        this.colorGrading = colorGrading
        return this
    }

    /**
     * Sets the develop adjustments (white balance, light, colour, vignette…) to apply while
     * rendering. `null` or an all-neutral object disables them.
     */
    setDevelop(develop: DevelopSettings | null): this {
        this.develop = develop
        return this
    }

    loadFromFile(filePath: string, profiler: Profiler | null = null): CancelablePromise<void> {
        if (this.baseTexturePromise !== null) {
            this.baseTexturePromise.cancel()
        }
        this.setBaseTexture(null)

        this.baseTexturePromise = this.createTextureFromFile(filePath, profiler)
            .then(texture => {
                this.baseTexturePromise = null
                this.setBaseTexture(texture)
                    .update()
                if (profiler) profiler.addPoint('Updadated canvas')
            })

        return this.baseTexturePromise
    }

    createTextureFromFile(filePath: string, profiler: Profiler | null = null): CancelablePromise<Texture> {
        return new CancelablePromise<Texture>(this.webGlCanvas.createTextureFromFile(filePath, undefined, undefined, profiler))
    }

    setBaseTexture(texture: Texture | null, destroyLast = true): this {
        if (destroyLast && this.baseTexture !== null) {
            this.baseTexture.destroy()
            this.baseTexture = null
        }
        this.baseTexture = texture

        return this
    }

    update(): this {
        const { size, baseTexture, clipRect } = this

        if (!baseTexture) {
            const gl = this.webGlCanvas.gl
            gl.clearColor(...this.clearColor)
            gl.clear(gl.COLOR_BUFFER_BIT)

            return this
        }

        // ===== Calculate =====

        // Important for matrix: Build it backwards (first operation last)
        const matrix = mat4.create()
        // Move origin to the center (0 .. 2) to clipspace coordinates (-1/1 .. 1/-1)
        mat4.translate(matrix, matrix, [ -1, 1, 0 ])
        // Scale to clipspace units (0 .. viewportWidth/viewportWidth) -> (0/2 .. 2/0)
        //   - 2 because clipspace coordinates are (-1 .. 1)
        //   - flip y, because clipspace's y axis goes from bottom to top
        mat4.scale(matrix, matrix, [ 2 / size.width, -2 / size.height, 1 ])
        // Apply camera
        mat4.multiply(matrix, matrix, this.cameraMatrix)
        // Apply projection
        mat4.multiply(matrix, matrix, this.projectionMatrix)
        // Scale from unit coordinates (0 .. 1) to texture coordinates (0 .. textureSize)
        mat4.scale(matrix, matrix, [ baseTexture.width, baseTexture.height, 1 ])

        // ===== Draw =====

        this.webGlCanvas.setSize(size.width, size.height)

        const gl = this.webGlCanvas.gl

        // Clear the canvas before we start drawing on it.
        gl.viewport(0, 0, size.width, size.height)
        gl.disable(gl.SCISSOR_TEST)
        gl.clearColor(...this.clearColor)
        gl.clear(gl.COLOR_BUFFER_BIT)

        if (clipRect) {
            // Clip within the canvas instead of enlarging the WebGL viewport with the zoomed
            // photo. Large photos can exceed the GPU's viewport limit when zoomed in.
            const rect = transformRect(clipRect, this.cameraMatrix)
            const left = Math.max(0, Math.min(size.width, Math.floor(rect.x)))
            const top = Math.max(0, Math.min(size.height, Math.floor(rect.y)))
            const right = Math.max(left, Math.min(size.width, Math.ceil(rect.x + rect.width)))
            const bottom = Math.max(top, Math.min(size.height, Math.ceil(rect.y + rect.height)))
            gl.enable(gl.SCISSOR_TEST)
            gl.scissor(left, size.height - bottom, right - left, bottom - top)
        }

        const grading = this.colorGrading
        const develop = this.develop
        const hasDevelop = !!develop && (
            (develop.wb?.temp !== undefined && develop.wb.temp !== 6500) ||
            (develop.wb?.tint ?? 0) !== 0 ||
            (develop.light?.exposure ?? 0) !== 0 || (develop.light?.contrast ?? 0) !== 0 ||
            (develop.light?.highlights ?? 0) !== 0 || (develop.light?.shadows ?? 0) !== 0 ||
            (develop.light?.whites ?? 0) !== 0 || (develop.light?.blacks ?? 0) !== 0 ||
            (develop.color?.vibrance ?? 0) !== 0 || (develop.color?.saturation ?? 0) !== 0 ||
            (develop.vignette?.amount ?? 0) !== 0 ||
            hasMixer(develop) || develop.treatment === 'bw' ||
            (develop.grain?.amount ?? 0) !== 0 ||
            (develop.detail?.sharpenAmount ?? 0) !== 0 ||
            (develop.detail?.nrLuminance ?? 0) !== 0 || (develop.detail?.nrColor ?? 0) !== 0 ||
            hasCalibration(develop)
        )
        const hasGrading = !!grading && !isNeutral(grading)

        if (hasGrading || hasDevelop) {
            const wheels = [ grading?.shadows, grading?.midtones, grading?.highlights ].map(w => withDefaults(w))
            // Wheel hue/sat -> OkLab (a, b) offset at full strength (sat=100). The offset is added
            // to the pixel weighted by its tonal range, so the strength scales with `sat`.
            const wheelOffsets = wheels.map(wheel => {
                const hueRad = oklchHueOfSrgbHue(wheel.hue)
                const chroma = (wheel.sat / 100) * wheelChromaStrength
                return { a: chroma * Math.cos(hueRad), b: chroma * Math.sin(hueRad), lum: (wheel.lum / 100) * wheelLumStrength }
            })

            // The mixer's 8 bands × (hue, sat, lum) packed as two vec4s per channel
            const mixer = packMixer(develop?.mixer)
            const bw = packBwMix(develop)
            const texture = baseTexture!

            this.colorGradingShader
                .use()
                .setVertexBuffer(this.unitSquareBuffer)
                .setTextureCoordBuffer(this.unitSquareBuffer)
                .setTexture(baseTexture)
                // NOTE: uniforms are per program - the grading shader needs the matrix set for
                // itself (a fresh program starts with all-zero uniforms, which would collapse the
                // quad to nothing and leave the cleared (black) canvas visible)
                .setUniforms({
                    uTransformationMatrix: matrix,
                    uGradingEnabled: hasGrading ? 1 : 0,
                    uGlobalWheel: globalWheelOffset(grading),
                    uWheelA: new Float32Array([ wheelOffsets[0].a, wheelOffsets[1].a, wheelOffsets[2].a ]),
                    uWheelB: new Float32Array([ wheelOffsets[0].b, wheelOffsets[1].b, wheelOffsets[2].b ]),
                    uWheelLum: new Float32Array([ wheelOffsets[0].lum, wheelOffsets[1].lum, wheelOffsets[2].lum ]),
                    uBlending: (grading?.blending ?? 50) / 100,
                    uBalance: (grading?.balance ?? 0) / 100,
                    uTemp: develop?.wb?.temp ?? 6500,
                    uTint: develop?.wb?.tint ?? 0,
                    uExposure: develop?.light?.exposure ?? 0,
                    uContrast: develop?.light?.contrast ?? 0,
                    uHighlights: develop?.light?.highlights ?? 0,
                    uShadows: develop?.light?.shadows ?? 0,
                    uWhites: develop?.light?.whites ?? 0,
                    uBlacks: develop?.light?.blacks ?? 0,
                    uVibrance: develop?.color?.vibrance ?? 0,
                    uSaturation: develop?.color?.saturation ?? 0,
                    uVignetteAmount: develop?.vignette?.amount ?? 0,
                    uVignetteMidpoint: develop?.vignette?.midpoint ?? 50,
                    uVignetteFeather: develop?.vignette?.feather ?? 50,
                    uVignetteHighlights: develop?.vignette?.highlights ?? 0,
                    uMixerHueA: mixer.hueA,
                    uMixerHueB: mixer.hueB,
                    uMixerSatA: mixer.satA,
                    uMixerSatB: mixer.satB,
                    uMixerLumA: mixer.lumA,
                    uMixerLumB: mixer.lumB,
                    uBwA: bw.a,
                    uBwB: bw.b,
                    uBwEnabled: develop?.treatment === 'bw' ? 1 : 0,
                    uGrainAmount: develop?.grain?.amount ?? 0,
                    uGrainSize: develop?.grain?.size ?? 25,
                    uGrainRoughness: develop?.grain?.roughness ?? 50,
                    uGrainSeed: 0,
                    uSharpenAmount: develop?.detail?.sharpenAmount ?? 0,
                    uSharpenRadius: develop?.detail?.sharpenRadius ?? 1,
                    uSharpenDetail: develop?.detail?.sharpenDetail ?? 25,
                    uSharpenMasking: develop?.detail?.sharpenMasking ?? 0,
                    uNrLuminance: develop?.detail?.nrLuminance ?? 0,
                    uNrColor: develop?.detail?.nrColor ?? 0,
                    uTexelSize: new Float32Array([ 1 / texture.width, 1 / texture.height ]),
                    uCalShadowsTint: develop?.calibration?.shadowsTint ?? 0,
                    uCalRedHue: develop?.calibration?.redHue ?? 0,
                    uCalRedSat: develop?.calibration?.redSat ?? 0,
                    uCalGreenHue: develop?.calibration?.greenHue ?? 0,
                    uCalGreenSat: develop?.calibration?.greenSat ?? 0,
                    uCalBlueHue: develop?.calibration?.blueHue ?? 0,
                    uCalBlueSat: develop?.calibration?.blueSat ?? 0,
                })
                .draw()
        } else {
            this.transformationShader
                .use()
                .setVertexBuffer(this.unitSquareBuffer)
                .setTextureCoordBuffer(this.unitSquareBuffer)
                .setTexture(baseTexture)
                .setUniforms({ uTransformationMatrix: matrix })
                .draw()
        }

        // The histogram renders the entire photo into its own framebuffer.
        gl.disable(gl.SCISSOR_TEST)
        this.updateHistogram()

        return this
    }

    /**
     * Recomputes the histogram: a tiny offscreen pass renders the same (graded) quad into a
     * 128×128 RGBA8 framebuffer and the CPU bins the read-back bytes. The shader is fully
     * texture-coordinate driven, so the small pass matches the visible render (except for grain
     * noise, which is fine for a histogram).
     */
    private updateHistogram() {
        const gl = this.webGlCanvas.gl
        const texture = this.baseTexture
        if (!texture) {
            this.histogram = null
            return
        }

        const histWidth = 128
        const histHeight = 128

        if (!this.histogramFramebuffer) {
            this.histogramBuffer = gl.createBuffer()
            this.histogramFramebuffer = gl.createFramebuffer()
        }
        if (!this.histogramBuffer || !this.histogramFramebuffer) {
            return
        }
        const buffer = this.histogramBuffer
        const framebuffer = this.histogramFramebuffer

        const fboTexture = gl.createTexture()
        if (!fboTexture) {
            return
        }
        try {
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, fboTexture)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, histWidth, histHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0)
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                return
            }
            gl.viewport(0, 0, histWidth, histHeight)
            gl.clearColor(0, 0, 0, 1)
            gl.clear(gl.COLOR_BUFFER_BIT)

            // Map the unit square to the entire clip space; identity fills only one quadrant.
            const identity = mat4.create()
            mat4.translate(identity, identity, [ -1, -1, 0 ])
            mat4.scale(identity, identity, [ 2, 2, 1 ])
            const histogramShader = this.colorGradingShader
            histogramShader
                .use()
                .setVertexBuffer(this.unitSquareBuffer)
                .setTextureCoordBuffer(this.unitSquareBuffer)
                .setTexture(texture)
                .setUniforms(this.histogramUniforms(texture, identity))
                .draw()

            const pixels = new Uint8Array(histWidth * histHeight * 4)
            gl.readPixels(0, 0, histWidth, histHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            this.histogram = histogramFromPixels(pixels, histWidth * histHeight)
        } finally {
            // Restore the visible-canvas state; delete the per-pass texture
            gl.deleteTexture(fboTexture)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.bindTexture(gl.TEXTURE_2D, null)
            gl.viewport(0, 0, this.size.width, this.size.height)
            gl.bindBuffer(gl.ARRAY_BUFFER, null)
        }
    }

    /** The uniforms for the histogram pass — the same edit as the visible render, identity matrix */
    private histogramUniforms(texture: Texture, matrix: mat4): ColorGradingUniforms {
        const develop = this.develop
        const grading = this.colorGrading
        const wheels = [ grading?.shadows, grading?.midtones, grading?.highlights ].map(w => withDefaults(w))
        const wheelOffsets = wheels.map(wheel => {
            const hueRad = oklchHueOfSrgbHue(wheel.hue)
            const chroma = (wheel.sat / 100) * wheelChromaStrength
            return { a: chroma * Math.cos(hueRad), b: chroma * Math.sin(hueRad), lum: (wheel.lum / 100) * wheelLumStrength }
        })
        const mixer = packMixer(develop?.mixer)
        const bw = packBwMix(develop)
        const hasGrading = !!grading && !isNeutral(grading)
        return {
            uTransformationMatrix: matrix,
            uGradingEnabled: hasGrading ? 1 : 0,
                    uGlobalWheel: globalWheelOffset(grading),
            uWheelA: new Float32Array([ wheelOffsets[0].a, wheelOffsets[1].a, wheelOffsets[2].a ]),
            uWheelB: new Float32Array([ wheelOffsets[0].b, wheelOffsets[1].b, wheelOffsets[2].b ]),
            uWheelLum: new Float32Array([ wheelOffsets[0].lum, wheelOffsets[1].lum, wheelOffsets[2].lum ]),
            uBlending: (grading?.blending ?? 50) / 100,
            uBalance: (grading?.balance ?? 0) / 100,
            uTemp: develop?.wb?.temp ?? 6500,
            uTint: develop?.wb?.tint ?? 0,
            uExposure: develop?.light?.exposure ?? 0,
            uContrast: develop?.light?.contrast ?? 0,
            uHighlights: develop?.light?.highlights ?? 0,
            uShadows: develop?.light?.shadows ?? 0,
            uWhites: develop?.light?.whites ?? 0,
            uBlacks: develop?.light?.blacks ?? 0,
            uVibrance: develop?.color?.vibrance ?? 0,
            uSaturation: develop?.color?.saturation ?? 0,
            uVignetteAmount: develop?.vignette?.amount ?? 0,
            uVignetteMidpoint: develop?.vignette?.midpoint ?? 50,
            uVignetteFeather: develop?.vignette?.feather ?? 50,
            uVignetteHighlights: develop?.vignette?.highlights ?? 0,
            uMixerHueA: mixer.hueA,
            uMixerHueB: mixer.hueB,
            uMixerSatA: mixer.satA,
            uMixerSatB: mixer.satB,
            uMixerLumA: mixer.lumA,
            uMixerLumB: mixer.lumB,
            uBwA: bw.a,
            uBwB: bw.b,
            uBwEnabled: develop?.treatment === 'bw' ? 1 : 0,
            uGrainAmount: 0,  // grain is skipped in the histogram pass (noise, not exposure data)
            uGrainSize: 0,
            uGrainRoughness: 0,
            uGrainSeed: 0,
            uSharpenAmount: develop?.detail?.sharpenAmount ?? 0,
            uSharpenRadius: develop?.detail?.sharpenRadius ?? 1,
            uSharpenDetail: develop?.detail?.sharpenDetail ?? 25,
            uSharpenMasking: develop?.detail?.sharpenMasking ?? 0,
            uNrLuminance: develop?.detail?.nrLuminance ?? 0,
            uNrColor: develop?.detail?.nrColor ?? 0,
            uTexelSize: new Float32Array([ 1 / texture.width, 1 / texture.height ]),
            uCalShadowsTint: develop?.calibration?.shadowsTint ?? 0,
            uCalRedHue: develop?.calibration?.redHue ?? 0,
            uCalRedSat: develop?.calibration?.redSat ?? 0,
            uCalGreenHue: develop?.calibration?.greenHue ?? 0,
            uCalGreenSat: develop?.calibration?.greenSat ?? 0,
            uCalBlueHue: develop?.calibration?.blueHue ?? 0,
            uCalBlueSat: develop?.calibration?.blueSat ?? 0,
        }
    }

}


/** True when any colour-mixer band has a non-neutral hue/sat/lum */
function hasMixer(develop: DevelopSettings): boolean {
    if (!develop.mixer) {
        return false
    }
    for (const band of MIXER_BANDS) {
        const b = develop.mixer[band]
        if (b && ((b.hue ?? 0) !== 0 || (b.sat ?? 0) !== 0 || (b.lum ?? 0) !== 0)) {
            return true
        }
    }
    return false
}

/** True when any calibration control is off its default */
function hasCalibration(develop: DevelopSettings): boolean {
    const c = develop.calibration
    if (!c) {
        return false
    }
    return (c.shadowsTint ?? 0) !== 0 || (c.redHue ?? 0) !== 0 || (c.redSat ?? 0) !== 0 ||
        (c.greenHue ?? 0) !== 0 || (c.greenSat ?? 0) !== 0 || (c.blueHue ?? 0) !== 0 || (c.blueSat ?? 0) !== 0
}

/** The 8 bands' mixer values packed as two vec4s per channel (bands 0..3 = A, 4..7 = B) */
function packMixer(mixer: DevelopSettings['mixer']): { hueA: Float32Array, hueB: Float32Array, satA: Float32Array, satB: Float32Array, lumA: Float32Array, lumB: Float32Array } {
    // per-channel vec4s (band order: red orange yellow green | aqua blue purple magenta)
    const read = (band: MixerBand, key: 'hue' | 'sat' | 'lum') => mixer?.[band]?.[key] ?? 0
    const vec = (bands: MixerBand[], key: 'hue' | 'sat' | 'lum') =>
        new Float32Array(bands.map(band => read(band, key)))
    const first = MIXER_BANDS.slice(0, 4)
    const second = MIXER_BANDS.slice(4)
    return {
        hueA: vec(first, 'hue'), hueB: vec(second, 'hue'),
        satA: vec(first, 'sat'), satB: vec(second, 'sat'),
        lumA: vec(first, 'lum'), lumB: vec(second, 'lum'),
    }
}

/** The 8 B&W mix weights packed as two vec4s (in band order) */
function packBwMix(develop: DevelopSettings | null): { a: Float32Array, b: Float32Array } {
    const mix = develop?.bwMix
    const read = (band: MixerBand) => mix?.[band] ?? 0
    return {
        a: new Float32Array(MIXER_BANDS.slice(0, 4).map(read)),
        b: new Float32Array(MIXER_BANDS.slice(4).map(read)),
    }
}

function globalWheelOffset(grading: ColorGrading | null): Float32Array {
    const wheel = withDefaults(grading?.global)
    const hue = oklchHueOfSrgbHue(wheel.hue)
    const chroma = wheel.sat / 100 * wheelChromaStrength
    return new Float32Array([ wheel.lum / 100 * wheelLumStrength, chroma * Math.cos(hue), chroma * Math.sin(hue) ])
}
