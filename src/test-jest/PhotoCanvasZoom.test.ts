import { vec2 } from 'gl-matrix'
import PhotoCanvas from 'app/renderer/PhotoCanvas'
import { Texture } from 'app/renderer/WebGLCanvas'
import { CameraMetricsBuilder } from 'app/util/CameraMetrics'
import { getSliderPhotoPosition } from 'app/util/PhotoZoomUtil'

const mockGl = {
    SCISSOR_TEST: 1, COLOR_BUFFER_BIT: 2,
    viewport: jest.fn(), disable: jest.fn(), enable: jest.fn(), scissor: jest.fn(), clearColor: jest.fn(), clear: jest.fn(),
    createBuffer: jest.fn(() => ({})), createFramebuffer: jest.fn(() => ({})), createTexture: jest.fn(() => null),
}
const mockMatrices: Float32Array[] = []

// This test supplies an already-loaded texture; no image loader is needed.
jest.mock('app/util/CancelablePromise', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('app/renderer/WebGLCanvas', () => ({
    __esModule: true,
    default: class {
        gl = mockGl
        createBufferFromData() { return {} }
        setSize() {}
    },
}))
jest.mock('app/renderer/Shaders', () => {
    class Shader {
        use() { return this }
        setVertexBuffer() { return this }
        setTextureCoordBuffer() { return this }
        setTexture() { return this }
        setUniforms(uniforms: { uTransformationMatrix: Float32Array }) {
            mockMatrices.push(uniforms.uTransformationMatrix)
            return this
        }
        draw() { return this }
    }
    return { TransformationShader: Shader, ColorGradingShader: Shader }
})

test('large-photo zoom stays within the canvas viewport and preserves the visible image transform', () => {
    const canvas = new PhotoCanvas()
    canvas.setBaseTexture({ width: 24000, height: 16000 } as Texture, false)
    const builder = new CameraMetricsBuilder().setTextureSize({ width: 24000, height: 16000 })
        .setCanvasSize({ width: 1200, height: 800 })
    for (const scale of [0.5, 0.2, 0.7, 1, 0.3, 0.5]) {
        const metrics = builder.setPhotoPosition(getSliderPhotoPosition(builder.getCameraMetrics(), scale)).getCameraMetrics()
        canvas.setSize(metrics.canvasSize).setClipRect(metrics.cropRect)
            .setCameraMatrix(metrics.cameraMatrix).setProjectionMatrix(metrics.projectionMatrix).update()
        const matrix = mockMatrices[mockMatrices.length - 1]
        expect(Array.from(matrix).every(Number.isFinite)).toBe(true)
        const center = vec2.transformMat4(vec2.create(), [0.5, 0.5], matrix)
        expect(center[0]).toBeCloseTo(0)
        expect(center[1]).toBeCloseTo(0)
    }
    for (const viewport of mockGl.viewport.mock.calls) expect(viewport).toEqual([0, 0, 1200, 800])
    expect(mockGl.scissor).toHaveBeenLastCalledWith(0, 0, 1200, 800)
    expect(mockGl.disable).toHaveBeenLastCalledWith(mockGl.SCISSOR_TEST)
})
