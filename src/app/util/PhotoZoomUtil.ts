import { CameraMetrics, RequestedPhotoPosition, limitPhotoPosition } from './CameraMetrics'

export function canZoomPhoto(metrics: CameraMetrics | null): metrics is CameraMetrics {
    return !!metrics && Number.isFinite(metrics.minZoom) && Number.isFinite(metrics.maxZoom) &&
        metrics.minZoom > 0
}

export function getZoomSliderValue(metrics: CameraMetrics | null): number {
    if (!canZoomPhoto(metrics) || !Number.isFinite(metrics.photoPosition.zoom)) return 0
    const relativeZoom = metrics.photoPosition.zoom / metrics.minZoom
    return Math.max(0, Math.min(1, Math.log(relativeZoom / 0.25) / Math.log(16)))
}

export function getSliderPhotoPosition(metrics: CameraMetrics, value: number): RequestedPhotoPosition {
    if (!canZoomPhoto(metrics) || !Number.isFinite(value)) return 'contain'
    const scale = Math.max(0, Math.min(1, value))
    if (Math.abs(scale - 0.5) < 0.000001) return 'contain'
    const zoom = Math.min(metrics.maxZoom, metrics.minZoom * 0.25 * Math.pow(16, scale))
    return limitPhotoPosition(metrics, { ...metrics.photoPosition, zoom }, false)
}
