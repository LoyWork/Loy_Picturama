import VerticalRangeIndex from 'app/util/VerticalRangeIndex'

test('includes touching bounds, unequal heights in shared rows, gaps and empty ranges', () => {
    const index = new VerticalRangeIndex([
        { top: 0, height: 100 }, { top: 0, height: 30 }, { top: 150, height: 50 },
    ])
    expect(index.find(50, 80)).toEqual({ from: 0, to: 2 })
    expect(index.find(100, 150)).toEqual({ from: 0, to: 3 })
    expect(index.find(101, 149)).toEqual({ from: 2, to: 2 })
    expect(index.find(201, 250)).toEqual({ from: 3, to: 3 })
    expect(index.find(-100, -1)).toEqual({ from: 0, to: 0 })
    expect(new VerticalRangeIndex([]).find(0, 100)).toEqual({ from: 0, to: 0 })
})
