import { CameraMetricsBuilder } from 'app/util/CameraMetrics'
import { canZoomPhoto, getSliderPhotoPosition, getZoomSliderValue } from 'app/util/PhotoZoomUtil'

test('small photos can zoom out and zoom in relative to fit instead of getting stuck at 200%', () => {
    const builder = new CameraMetricsBuilder().setTextureSize({ width: 32, height: 32 })
        .setCanvasSize({ width: 1200, height: 800 })
    const metrics = builder.getCameraMetrics()
    expect(metrics.minZoom).toBe(2)
    expect(canZoomPhoto(metrics)).toBe(true)
    expect(getZoomSliderValue(metrics)).toBe(0.5)
    expect(getSliderPhotoPosition(metrics, 0)).toMatchObject({ zoom: 0.5 })
    expect(getSliderPhotoPosition(metrics, 1)).toMatchObject({ zoom: 8 })
    for (const value of [0, 0.5, 1, NaN, Infinity]) {
        const position = getSliderPhotoPosition(metrics, value)
        const next = builder.setPhotoPosition(position).getCameraMetrics()
        expect(Array.from(next.cameraMatrix).every(Number.isFinite)).toBe(true)
    }
})

test('dragging zoom through its entire range and back keeps the photo visible and resets to fit', () => {
    const builder = new CameraMetricsBuilder().setTextureSize({ width: 24000, height: 16000 })
        .setCanvasSize({ width: 1200, height: 800 })
    for (const scale of [0.5, 0.1, 0, 1, 0.7, 0.2, 0.5]) {
        const metrics = builder.getCameraMetrics()
        const position = getSliderPhotoPosition(metrics, scale)
        const next = builder.setPhotoPosition(position).getCameraMetrics()
        expect(Array.from(next.cameraMatrix).every(Number.isFinite)).toBe(true)
        expect(next.photoPosition.centerX).toBe(0)
        expect(next.photoPosition.centerY).toBe(0)
        expect(getZoomSliderValue(next)).toBeCloseTo(scale)
    }
    expect(builder.getRequestedPhotoPosition()).toBe('contain')
})

test('invalid drag values recover to fit and values outside the track are clamped', () => {
    const metrics = new CameraMetricsBuilder().setTextureSize({ width: 4000, height: 3000 })
        .setCanvasSize({ width: 1200, height: 800 }).getCameraMetrics()
    expect(getSliderPhotoPosition(metrics, NaN)).toBe('contain')
    expect(getSliderPhotoPosition(metrics, -1)).toMatchObject({ zoom: metrics.minZoom * 0.25 })
    expect(getSliderPhotoPosition(metrics, 2)).toMatchObject({ zoom: metrics.minZoom * 4 })
})
