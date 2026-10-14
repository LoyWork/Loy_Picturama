import { linearSrgbToOklab, oklabToLinearSrgb, oklchHueOfSrgbHue, isNeutral, withDefaults, neutralGrading, clampWheel } from 'app/util/ColorGradingUtil'


describe('OkLab round trip', () => {
    test('converts linear sRGB to OkLab and back', () => {
        const cases: [number, number, number][] = [
            [0, 0, 0],
            [1, 1, 1],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
            [0.5, 0.25, 0.75],
            [0.1, 0.8, 0.3],
        ]
        for (const rgb of cases) {
            const roundTripped = oklabToLinearSrgb(linearSrgbToOklab(rgb))
            for (let i = 0; i < 3; i++) {
                expect(roundTripped[i]).toBeCloseTo(rgb[i], 5)
            }
        }
    })

    test('pure red has an OkLab hue near 29° (Björn Ottosson\'s value)', () => {
        const [l, a, b] = linearSrgbToOklab([1, 0, 0])
        const hueDeg = Math.atan2(b, a) * 180 / Math.PI
        expect(l).toBeCloseTo(0.6279, 3)
        expect(hueDeg).toBeCloseTo(29.23, 1)
    })

    test('oklchHueOfSrgbHue maps red to OkLab\'s red hue and keeps green opposite-ish', () => {
        const redHue = oklchHueOfSrgbHue(0)
        const greenHue = oklchHueOfSrgbHue(120)
        const blueHue = oklchHueOfSrgbHue(240)
        expect(redHue * 180 / Math.PI).toBeCloseTo(29.23, 1)
        // Green and blue keep their rough order and spacing (within ~40° of the ideal 120° steps)
        const deg = (h: number) => ((h * 180 / Math.PI) + 360) % 360
        const redToGreen = deg(greenHue - redHue)
        const greenToBlue = deg(blueHue - greenHue)
        expect(redToGreen).toBeGreaterThan(80)
        expect(redToGreen).toBeLessThan(160)
        expect(greenToBlue).toBeGreaterThan(80)
        expect(greenToBlue).toBeLessThan(160)
    })
})

describe('isNeutral / withDefaults / clampWheel', () => {
    test('a missing or all-neutral grading is neutral', () => {
        expect(isNeutral(undefined)).toBe(true)
        expect(isNeutral(null)).toBe(true)
        expect(isNeutral({})).toBe(true)
        expect(isNeutral(neutralGrading())).toBe(true)
        expect(isNeutral({ shadows: { hue: 30, sat: 50, lum: 0 } })).toBe(false)
        // lum alone also counts as an effect
        expect(isNeutral({ midtones: { lum: 10 } })).toBe(false)
    })

    test('withDefaults fills missing values and preserves set ones', () => {
        expect(withDefaults(undefined)).toEqual({ hue: 0, sat: 0, lum: 0 })
        expect(withDefaults({ hue: 200 })).toEqual({ hue: 200, sat: 0, lum: 0 })
        expect(withDefaults({ hue: 30, sat: 40, lum: -20 })).toEqual({ hue: 30, sat: 40, lum: -20 })
    })

    test('clampWheel clamps out-of-range sidecar values', () => {
        expect(clampWheel({ hue: 400, sat: 150, lum: -200 })).toEqual({ hue: 360, sat: 100, lum: -100 })
        expect(clampWheel({})).toEqual({ hue: 0, sat: 0, lum: 0 })
    })
})
