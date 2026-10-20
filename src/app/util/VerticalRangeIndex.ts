/** Indexes vertically ordered items, including items sharing a row with different heights. */
export default class VerticalRangeIndex {
    private tops: number[] = []
    private maxBottoms: number[] = []

    constructor(items: readonly { top: number, height: number }[]) {
        let maxBottom = Number.NEGATIVE_INFINITY
        for (const item of items) {
            this.tops.push(item.top)
            maxBottom = Math.max(maxBottom, item.top + item.height)
            this.maxBottoms.push(maxBottom)
        }
    }

    /** Inclusive pixel bounds; the returned end index is exclusive. */
    find(minY: number, maxY: number): { from: number, to: number } {
        const from = this.lowerBound(this.maxBottoms, minY, false)
        const to = this.lowerBound(this.tops, maxY, true)
        return { from, to: Math.max(from, to) }
    }

    private lowerBound(values: number[], value: number, exclusive: boolean): number {
        let left = 0
        let right = values.length
        while (left < right) {
            const mid = Math.floor((left + right) / 2)
            if (exclusive ? values[mid] <= value : values[mid] < value) left = mid + 1
            else right = mid
        }
        return left
    }
}
