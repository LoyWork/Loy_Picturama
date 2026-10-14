import { mat4 } from 'gl-matrix'

import { StandardShaderProgram, Texture } from './WebGLCanvas'


export class TransformationShader extends StandardShaderProgram<{ uTransformationMatrix: mat4 }> {
    constructor(gl: WebGLRenderingContext) {
        const vertexShaderSource = `
            uniform mat4 uTransformationMatrix;

            attribute vec4 aVertex;
            attribute vec2 aTextureCoord;

            varying highp vec2 vTextureCoord;

            void main() {
                gl_Position = uTransformationMatrix * aVertex;
                vTextureCoord = aTextureCoord;
            }`

        super(gl, vertexShaderSource, undefined)
    }
}


export interface ColorGradingUniforms {
    uGradingEnabled: number
    /** Wheel colours as OkLab (a, b) offsets at full strength; lum is the lightness shift. Per wheel: shadows, midtones, highlights. */
    uWheelA: Float32Array // vec3
    uWheelB: Float32Array // vec3
    uWheelLum: Float32Array // vec3
    uGlobalWheel: Float32Array // vec3: lightness, a, b
    uBlending: number
    uBalance: number
    // --- develop controls (LightCraft's pipeline) ---
    /** White balance: temperature in Kelvin (as-shot 6500) and tint -150..150 (negative = green) */
    uTemp: number
    uTint: number
    /** Exposure in stops, contrast/highlights/shadows/whites/blacks all -100..100 */
    uExposure: number
    uContrast: number
    uHighlights: number
    uShadows: number
    uWhites: number
    uBlacks: number
    /** Vibrance and saturation -100..100 */
    uVibrance: number
    uSaturation: number
    /** Vignette: amount -100..100, midpoint/feather/highlights 0..100 */
    uVignetteAmount: number
    uVignetteMidpoint: number
    uVignetteFeather: number
    uVignetteHighlights: number
    /** Colour mixer: per-band hue/sat/lum shifts, as 3×8 (rows: hue, sat, lum; columns: bands) */
    uMixerHueA: Float32Array
    uMixerHueB: Float32Array
    uMixerSatA: Float32Array
    uMixerSatB: Float32Array
    uMixerLumA: Float32Array
    uMixerLumB: Float32Array
    /** B&W mix weights per band (vec3 × 2 + 2 floats packed in two vec3s) */
    uBwA: Float32Array
    uBwB: Float32Array
    /** 1.0 when the B&W treatment is on */
    uBwEnabled: number
    /** Grain: amount/size/roughness 0..100 */
    uGrainAmount: number
    uGrainSize: number
    uGrainRoughness: number
    uGrainSeed: number
    /** Sharpening: amount 0..150, radius 0.5..3, detail/masking 0..100 */
    uSharpenAmount: number
    uSharpenRadius: number
    uSharpenDetail: number
    uSharpenMasking: number
    /** Noise reduction: luminance 0..100, color 0..100 */
    uNrLuminance: number
    uNrColor: number
    /** The texel size (1/width, 1/height) for the neighbourhood samples */
    uTexelSize: Float32Array // vec2
    /** Calibration: shadows tint -100..100, per-primary hue/sat -100..100 */
    uCalShadowsTint: number
    uCalRedHue: number
    uCalRedSat: number
    uCalGreenHue: number
    uCalGreenSat: number
    uCalBlueHue: number
    uCalBlueSat: number
    // ShaderParameterMap is keyed by string, so an index signature is required
    [key: string]: Texture | Float32Array | mat4 | number
}

/** Shared GLSL: the sRGB transfer functions and the OkLab conversions (also in ColorGradingUtil.ts) */
const COLOR_SPACE_GLSL = `
    highp float srgbToLinear(highp float v) {
        return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
    }

    highp float linearToSrgb(highp float v) {
        return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
    }

    vec3 linearSrgbToOklab(vec3 rgb) {
        vec3 lms = pow(vec3(
            0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b,
            0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b,
            0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b), vec3(1.0 / 3.0));
        return vec3(
            0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
            1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
            0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
    }

    vec3 oklabToLinearSrgb(vec3 lab) {
        vec3 lms = vec3(
            lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
            lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
            lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
        lms = lms * lms * lms;
        return vec3(
            4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
            -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
            -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
    }
`

/**
 * Like TransformationShader, but applies 3-way colour grading to the photo. The grading follows
 * LightCraft's approach: convert the sampled texel to linear light, then to OkLab, add each
 * wheel's OkLab offset weighted by the pixel's tonal range (shadows/midtones/highlights), and
 * convert back. See `app/util/ColorGradingUtil` for the shared maths and constants.
 */
export class ColorGradingShader extends StandardShaderProgram<ColorGradingUniforms> {
    constructor(gl: WebGLRenderingContext) {
        const vertexShaderSource = `
            uniform mat4 uTransformationMatrix;

            attribute vec4 aVertex;
            attribute vec2 aTextureCoord;

            varying highp vec2 vTextureCoord;

            void main() {
                gl_Position = uTransformationMatrix * aVertex;
                vTextureCoord = aTextureCoord;
            }`

        const fragmentShaderSource = `
            precision highp float;

            uniform sampler2D uSampler;
            uniform highp float uGradingEnabled;
            uniform highp vec3 uWheelA;    // shadows, midtones, highlights
            uniform highp vec3 uWheelB;
            uniform highp vec3 uWheelLum;
            uniform highp vec3 uGlobalWheel;
            uniform highp float uBlending; // 0..1
            uniform highp float uBalance;  // -1..1
            // develop controls (LightCraft's pipeline)
            uniform highp float uTemp;     // Kelvin
            uniform highp float uTint;     // -150..150, negative = green
            uniform highp float uExposure; // stops
            uniform highp float uContrast; // -100..100
            uniform highp float uHighlights;
            uniform highp float uShadows;
            uniform highp float uWhites;
            uniform highp float uBlacks;
            uniform highp float uVibrance;   // -100..100
            uniform highp float uSaturation; // -100..100
            uniform highp float uVignetteAmount;    // -100..100
            uniform highp float uVignetteMidpoint;  // 0..100
            uniform highp float uVignetteFeather;   // 0..100
            uniform highp float uVignetteHighlights; // 0..100
            // colour mixer: 8 bands × (hue, sat, lum), packed as 3 vec4s per channel
            uniform highp vec4 uMixerHueA;  // red, orange, yellow, green  hue shifts
            uniform highp vec4 uMixerHueB;  // aqua, blue, purple, magenta hue shifts
            uniform highp vec4 uMixerSatA;
            uniform highp vec4 uMixerSatB;
            uniform highp vec4 uMixerLumA;
            uniform highp vec4 uMixerLumB;
            // B&W mix: the 8 band weights (vec4 × 2) and the treatment switch
            uniform highp vec4 uBwA;        // red, orange, yellow, green
            uniform highp vec4 uBwB;        // aqua, blue, purple, magenta
            uniform highp float uBwEnabled;
            // grain
            uniform highp float uGrainAmount;      // 0..100
            uniform highp float uGrainSize;        // 0..100
            uniform highp float uGrainRoughness;   // 0..100
            uniform highp float uGrainSeed;
            // sharpening & noise reduction
            uniform highp float uSharpenAmount;   // 0..150
            uniform highp float uSharpenRadius;   // 0.5..3
            uniform highp float uSharpenDetail;   // 0..100
            uniform highp float uSharpenMasking;  // 0..100
            uniform highp float uNrLuminance;     // 0..100
            uniform highp float uNrColor;         // 0..100
            uniform highp vec2 uTexelSize;        // 1/width, 1/height
            // calibration
            uniform highp float uCalShadowsTint;  // -100..100
            uniform highp float uCalRedHue;       // -100..100
            uniform highp float uCalRedSat;
            uniform highp float uCalGreenHue;
            uniform highp float uCalGreenSat;
            uniform highp float uCalBlueHue;
            uniform highp float uCalBlueSat;

            varying highp vec2 vTextureCoord;

            ${COLOR_SPACE_GLSL}

            highp float smoothWindow(highp float e0, highp float e1, highp float x) {
                highp float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
                return t * t * (3.0 - 2.0 * t);
            }

            // Kelvin → normalised RGB of the illuminant colour (approximation of the blackbody
            // locus on the blue..yellow axis, used for the white balance gain)
            vec3 kelvinToRgb(highp float k) {
                highp float t = clamp(k, 2000.0, 50000.0) / 100.0;
                highp float r, g, b;
                if (t <= 66.0) {
                    r = 1.0;
                } else {
                    r = 1.292936186062745 * pow(t - 60.0, -0.1332047592);
                }
                if (t <= 66.0) {
                    g = 0.3900815787690196 * log(t) - 0.6318414437886275;
                } else {
                    g = 1.129890860895294 * pow(t - 60.0, -0.0755148492);
                }
                if (t >= 66.0) {
                    b = 1.0;
                } else if (t <= 19.0) {
                    b = 0.0;
                } else {
                    b = 0.5432067891102761 * log(t - 10.0) - 1.19625408914;
                }
                return clamp(vec3(r, g, b), 0.0, 1.0);
            }

            // HSV hue (degrees) → sRGB, for the colour mixer's band hues
            vec3 hsvToRgb(highp float h, highp float s, highp float v) {
                highp float hp = mod(h, 360.0) / 60.0;
                highp float c = v * s;
                highp float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
                vec3 rgb;
                if (hp < 1.0)      rgb = vec3(c, x, 0.0);
                else if (hp < 2.0) rgb = vec3(x, c, 0.0);
                else if (hp < 3.0) rgb = vec3(0.0, c, x);
                else if (hp < 4.0) rgb = vec3(0.0, x, c);
                else if (hp < 5.0) rgb = vec3(x, 0.0, c);
                else               rgb = vec3(c, 0.0, x);
                highp float m = v - c;
                return rgb + m;
            }

            // A cheap hash-based white noise (for the grain): returns 0..1
            highp float hashNoise(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7)) + uGrainSeed) * 43758.5453123);
            }

            // The photo's hue in degrees (0..360) and chroma, from linear sRGB
            highp float hueOf(vec3 rgb, out highp float chroma) {
                highp float mx = max(rgb.r, max(rgb.g, rgb.b));
                highp float mn = min(rgb.r, min(rgb.g, rgb.b));
                chroma = mx - mn;
                if (chroma < 1e-5) {
                    return 0.0;
                }
                highp float h;
                if (mx == rgb.r) {
                    h = 60.0 * mod((rgb.g - rgb.b) / chroma, 6.0);
                } else if (mx == rgb.g) {
                    h = 60.0 * ((rgb.b - rgb.r) / chroma + 2.0);
                } else {
                    h = 60.0 * ((rgb.r - rgb.g) / chroma + 4.0);
                }
                return mod(h + 360.0, 360.0);
            }

            void main(void) {
                vec4 color = texture2D(uSampler, vTextureCoord);

                bool anyDevelop =
                    uGradingEnabled > 0.5 || uTemp != 6500.0 || uTint != 0.0 ||
                    uExposure != 0.0 || uContrast != 0.0 || uHighlights != 0.0 || uShadows != 0.0 ||
                    uWhites != 0.0 || uBlacks != 0.0 || uVibrance != 0.0 || uSaturation != 0.0 ||
                    uVignetteAmount != 0.0 ||
                    uMixerHueA != vec4(0.0) || uMixerHueB != vec4(0.0) ||
                    uMixerSatA != vec4(0.0) || uMixerSatB != vec4(0.0) ||
                    uMixerLumA != vec4(0.0) || uMixerLumB != vec4(0.0) ||
                    uBwEnabled > 0.5 ||
                    uGrainAmount != 0.0 ||
                    uSharpenAmount != 0.0 || uNrLuminance != 0.0 || uNrColor != 0.0 ||
                    uCalShadowsTint != 0.0 || uCalRedHue != 0.0 || uCalRedSat != 0.0 ||
                    uCalGreenHue != 0.0 || uCalGreenSat != 0.0 || uCalBlueHue != 0.0 || uCalBlueSat != 0.0;

                if (anyDevelop) {
                    // --- to linear light -------------------------------------------------------
                    vec3 rgb = vec3(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b));

                    // --- sharpening & noise reduction (neighbourhood samples, in linear light) --
                    if (uSharpenAmount != 0.0 || uNrLuminance != 0.0 || uNrColor != 0.0) {
                        highp float px = max(uSharpenRadius, 0.5) * uTexelSize.x;
                        highp float py = max(uSharpenRadius, 0.5) * uTexelSize.y;
                        vec3 blur = (
                            texture2D(uSampler, vTextureCoord + vec2(-px, -py)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2( 0.0, -py)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2( px, -py)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2(-px, 0.0)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2( px, 0.0)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2(-px,  py)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2( 0.0,  py)).rgb +
                            texture2D(uSampler, vTextureCoord + vec2( px,  py)).rgb
                        ) / 8.0;

                        if (uNrColor != 0.0) {
                            // colour noise reduction: average the chroma towards the blurred chroma
                            highp float f = uNrColor / 100.0;
                            highp float baseLum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                            vec3 chroma = color.rgb - baseLum;
                            vec3 chromaBlur = blur - dot(blur, vec3(0.299, 0.587, 0.114));
                            color.rgb = vec3(baseLum) + mix(chroma, chromaBlur, f);
                        }

                        // recompute from the (possibly changed) colour
                        rgb = vec3(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b));

                        if (uNrLuminance != 0.0) {
                            highp float f = uNrLuminance / 100.0;
                            vec3 blurLin = vec3(srgbToLinear(blur.r), srgbToLinear(blur.g), srgbToLinear(blur.b));
                            rgb = mix(rgb, blurLin, f * 0.85);
                        }

                        if (uSharpenAmount != 0.0) {
                            // unsharp mask on the luminance, scaled by the detail amount
                            highp float amount = uSharpenAmount / 150.0 * (0.5 + uSharpenDetail / 100.0);
                            vec3 blurLin = vec3(srgbToLinear(blur.r), srgbToLinear(blur.g), srgbToLinear(blur.b));
                            vec3 detail = rgb - blurLin;
                            // masking: sharpen only where the local detail exceeds the threshold
                            highp float mask = 1.0;
                            if (uSharpenMasking > 0.0) {
                                highp float d = length(detail);
                                mask = smoothstep(uSharpenMasking / 100.0 * 0.25, uSharpenMasking / 100.0 * 0.25 + 0.05, d);
                            }
                            rgb += detail * amount * mask * 1.5;
                        }
                    }

                    // --- white balance (gain towards the illuminant's complement) --------------
                    if (uTemp != 6500.0 || uTint != 0.0) {
                        // The illuminant colour for a D65-balanced image: neutralising it means
                        // dividing by it (as Shot = 6500 K / 0 tint).
                        vec3 illum = kelvinToRgb(uTemp);
                        // tint: green (-) .. magenta (+) along the a axis
                        highp float tintShift = -uTint / 150.0 * 0.12;
                        illum = normalize(illum + vec3(tintShift, -tintShift * 0.6, -tintShift * 0.6) * illum);
                        rgb /= illum * 1.02;
                        rgb = clamp(rgb, 0.0, 4.0);
                    }

                    // --- camera calibration (white-preserving primary rotations, before tone) ---
                    if (uCalShadowsTint != 0.0 || uCalRedHue != 0.0 || uCalRedSat != 0.0 ||
                        uCalGreenHue != 0.0 || uCalGreenSat != 0.0 || uCalBlueHue != 0.0 || uCalBlueSat != 0.0) {
                        vec3 lab = linearSrgbToOklab(clamp(rgb, 0.0, 4.0));
                        if (uCalShadowsTint != 0.0) {
                            // green..magenta tint of the shadows
                            highp float w = 1.0 - smoothWindow(0.05, 0.45, lab.x);
                            lab.y += uCalShadowsTint / 100.0 * 0.03 * w;
                            lab.z -= uCalShadowsTint / 100.0 * 0.015 * w;
                        }
                        // primary hue/saturation: rotate the pixel's hue around each primary's hue
                        // and scale its chroma (a light version of LightCraft's 3×3 matrix)
                        if (uCalRedHue != 0.0 || uCalRedSat != 0.0 || uCalGreenHue != 0.0 ||
                            uCalGreenSat != 0.0 || uCalBlueHue != 0.0 || uCalBlueSat != 0.0) {
                            highp float chromaDummy;
                            highp float h = hueOf(clamp(rgb, 0.0, 1.0), chromaDummy);
                            // weight per primary: how close the hue is to the primary
                            highp float wR = cos(radians(min(abs(h - 0.0), 360.0 - abs(h - 0.0))));
                            highp float wG = cos(radians(abs(h - 120.0)));
                            highp float wB = cos(radians(abs(h - 240.0)));
                            highp float hueShift = uCalRedHue / 100.0 * 15.0 * max(0.0, wR)
                                + uCalGreenHue / 100.0 * 15.0 * max(0.0, wG)
                                + uCalBlueHue / 100.0 * 15.0 * max(0.0, wB);
                            highp float satScale = 1.0
                                + uCalRedSat / 100.0 * 0.5 * max(0.0, wR)
                                + uCalGreenSat / 100.0 * 0.5 * max(0.0, wG)
                                + uCalBlueSat / 100.0 * 0.5 * max(0.0, wB);
                            lab.yz *= satScale;
                            highp float ca = cos(radians(hueShift));
                            highp float sa = sin(radians(hueShift));
                            lab.yz = mat2(ca, sa, -sa, ca) * lab.yz;
                        }
                        rgb = oklabToLinearSrgb(lab);
                    }

                    // --- exposure (in stops, in linear light) ----------------------------------
                    if (uExposure != 0.0) {
                        rgb *= exp2(uExposure);
                    }

                    // --- black point / whites (linear-light lifts and rolloffs) ----------------
                    if (uBlacks != 0.0) {
                        highp float f = uBlacks / 100.0 * 0.08;
                        rgb = (rgb + f) / (1.0 + f);
                    }
                    if (uWhites != 0.0) {
                        highp float f = uWhites / 100.0;
                        rgb *= 1.0 + f * 0.15;
                    }

                    // --- highlights / shadows (tonal-range weighted gain in OkLab lightness) ---
                    if (uHighlights != 0.0 || uShadows != 0.0 || uContrast != 0.0) {
                        vec3 lab = linearSrgbToOklab(clamp(rgb, 0.0, 4.0));

                        if (uHighlights != 0.0) {
                            highp float w = smoothWindow(0.55, 0.95, lab.x);
                            lab.x += uHighlights / 100.0 * 0.12 * w;
                        }
                        if (uShadows != 0.0) {
                            highp float w = 1.0 - smoothWindow(0.05, 0.45, lab.x);
                            lab.x += uShadows / 100.0 * 0.12 * w;
                        }
                        if (uContrast != 0.0) {
                            // S-curve around the midpoint, as LightCraft's tone mapping does
                            highp float c = uContrast / 100.0;
                            highp float d = lab.x - 0.5;
                            lab.x = 0.5 + d * (1.0 + c * 0.6) - c * 0.4 * d * d * d * 4.0;
                        }
                        rgb = oklabToLinearSrgb(lab);
                    }

                    // --- vibrance & saturation (in OkLab) ---------------------------------------
                    if (uVibrance != 0.0 || uSaturation != 0.0) {
                        vec3 lab = linearSrgbToOklab(clamp(rgb, 0.0, 4.0));
                        highp float chroma = length(lab.yz);
                        if (uVibrance != 0.0) {
                            // Vibrance protects already-saturated colours (and skin tones, whose
                            // hue sits near 30°): scale the chroma more where it is low
                            highp float protect = smoothstep(0.08, 0.25, chroma);
                            lab.yz *= 1.0 + uVibrance / 100.0 * 0.5 * (1.0 - protect * 0.75);
                        }
                        if (uSaturation != 0.0) {
                            lab.yz *= max(0.0, 1.0 + uSaturation / 100.0);
                        }
                        rgb = oklabToLinearSrgb(lab);
                    }

                    rgb = clamp(rgb, 0.0, 1.0);

                    // --- vignette (radial darkening/lightening from the corners) ----------------
                    if (uVignetteAmount != 0.0) {
                        highp float d = distance(vTextureCoord, vec2(0.5)) / 0.7071;
                        highp float midpoint = mix(0.2, 1.4, uVignetteMidpoint / 100.0);
                        highp float feather = mix(0.05, 1.2, uVignetteFeather / 100.0);
                        highp float v = 1.0 - smoothstep(midpoint, midpoint + feather, d);
                        highp float amt = uVignetteAmount / 100.0;
                        // highlights slider: protect highlights from the darkening
                        if (amt < 0.0 && uVignetteHighlights > 0.0) {
                            highp float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                            highp float prot = smoothstep(0.5, 1.0, lum) * uVignetteHighlights / 100.0;
                            v = mix(v, 1.0, prot);
                        }
                        highp float f = 1.0 + amt * 0.8 * (1.0 - v);
                        rgb *= clamp(f, 0.0, 2.0);
                        rgb = clamp(rgb, 0.0, 1.0);
                    }

                    // --- 3-way colour grading ----------------------------------------------------
                    if (uGradingEnabled > 0.5) {
                        vec3 lab = linearSrgbToOklab(rgb);

                        // Tonal range weights: how much of shadows / midtones / highlights is in this pixel
                        highp float m = 0.5 - uBalance * 0.25;
                        highp float width = 0.15 + uBlending * 0.5;
                        highp float wShadow = 1.0 - smoothWindow(m - width, m + width * 0.25, lab.x);
                        highp float wHigh = smoothWindow(m - width * 0.25, m + width, lab.x);
                        highp float wMid = max(0.0, 1.0 - wShadow - wHigh);

                        lab.y += dot(uWheelA, vec3(wShadow, wMid, wHigh));
                        lab.z += dot(uWheelB, vec3(wShadow, wMid, wHigh));
                        lab.x += dot(uWheelLum, vec3(wShadow, wMid, wHigh));

                        rgb = oklabToLinearSrgb(lab);
                    }

                    // --- colour mixer (8 bands × hue/sat/lum, in OkLab) -------------------------
                    if (uMixerHueA != vec4(0.0) || uMixerHueB != vec4(0.0) ||
                        uMixerSatA != vec4(0.0) || uMixerSatB != vec4(0.0) ||
                        uMixerLumA != vec4(0.0) || uMixerLumB != vec4(0.0)) {
                        vec3 lab = linearSrgbToOklab(clamp(rgb, 0.0, 4.0));
                        highp float chroma = length(lab.yz);
                        if (chroma > 1e-4) {
                            vec3 rgbSrgb = clamp(oklabToLinearSrgb(lab), 0.0, 1.0);
                            highp float chromaDummy;
                            highp float h = hueOf(rgbSrgb, chromaDummy);

                            // band weights: how close the pixel's hue is to each band's centre hue
                            // (band centres: 0, 30, 60, 120, 180, 225, 270, 315 degrees)
                            highp float hueDist[8];
                            hueDist[0] = min(abs(h - 0.0), 360.0 - abs(h - 0.0));
                            hueDist[1] = abs(h - 30.0);
                            hueDist[2] = abs(h - 60.0);
                            hueDist[3] = abs(h - 120.0);
                            hueDist[4] = abs(h - 180.0);
                            hueDist[5] = abs(h - 225.0);
                            hueDist[6] = abs(h - 270.0);
                            hueDist[7] = abs(h - 315.0);
                            highp float w[8];
                            for (int i = 0; i < 8; i++) {
                                // weight falls off over ±45° around each band's centre
                                w[i] = 1.0 - smoothstep(15.0, 60.0, hueDist[i]);
                            }
                            highp float wSum = w[0] + w[1] + w[2] + w[3] + w[4] + w[5] + w[6] + w[7];
                            if (wSum > 1e-4) {
                                highp float f = (1.0 / wSum) / 100.0;
                                highp float hueShift = dot(uMixerHueA, vec4(w[0], w[1], w[2], w[3])) + dot(uMixerHueB, vec4(w[4], w[5], w[6], w[7]));
                                highp float satShift = dot(uMixerSatA, vec4(w[0], w[1], w[2], w[3])) + dot(uMixerSatB, vec4(w[4], w[5], w[6], w[7]));
                                highp float lumShift = dot(uMixerLumA, vec4(w[0], w[1], w[2], w[3])) + dot(uMixerLumB, vec4(w[4], w[5], w[6], w[7]));
                                // hue shift: ±29° at full strength (like Lightroom)
                                highp float a = radians(hueShift * f * 29.0);
                                highp float cA = cos(a);
                                highp float sA = sin(a);
                                lab.yz = mat2(cA, sA, -sA, cA) * lab.yz;
                                // saturation: chroma scale
                                lab.yz *= max(0.0, 1.0 + satShift * f);
                                // luminance
                                lab.x += lumShift * f * 0.12;
                                rgb = oklabToLinearSrgb(lab);
                            }
                        }
                    }

                    // --- B&W treatment -----------------------------------------------------------
                    if (uBwEnabled > 0.5) {
                        // The B&W mix: a weighted luminance over the 8 bands (like Lightroom's
                        // B&W Mixer). The band shift re-weights the colour contribution before
                        // desaturating; 0 everywhere gives the plain luminance.
                        vec3 rgbSrgb = clamp(vec3(linearToSrgb(clamp(rgb.r, 0.0, 1.0)), linearToSrgb(clamp(rgb.g, 0.0, 1.0)), linearToSrgb(clamp(rgb.b, 0.0, 1.0))), 0.0, 1.0);
                        highp float chromaDummy;
                        highp float h = hueOf(rgbSrgb, chromaDummy);
                        // distribute the band weights over the pixel's hue neighbourhood
                        highp float bandW[8];
                        bandW[0] = max(0.0, cos(radians(min(abs(h - 0.0), 360.0 - abs(h - 0.0)))));
                        bandW[1] = max(0.0, cos(radians(abs(h - 30.0))));
                        bandW[2] = max(0.0, cos(radians(abs(h - 60.0))));
                        bandW[3] = max(0.0, cos(radians(abs(h - 120.0))));
                        bandW[4] = max(0.0, cos(radians(abs(h - 180.0))));
                        bandW[5] = max(0.0, cos(radians(abs(h - 225.0))));
                        bandW[6] = max(0.0, cos(radians(abs(h - 270.0))));
                        bandW[7] = max(0.0, cos(radians(abs(h - 315.0))));
                        highp float bwShift = dot(uBwA, vec4(bandW[0], bandW[1], bandW[2], bandW[3]))
                            + dot(uBwB, vec4(bandW[4], bandW[5], bandW[6], bandW[7]));
                        highp float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                        highp float chroma = length(rgb - vec3(lum));
                        lum += bwShift / 100.0 * chroma * 0.5;
                        rgb = vec3(clamp(lum, 0.0, 1.0));
                    }

                    // --- grain (procedural white noise, luminance-scaled) ------------------------
                    if (uGrainAmount != 0.0) {
                        highp float scale = mix(2.5, 0.5, uGrainSize / 100.0);
                        vec2 gp = floor(vTextureCoord / uTexelSize / scale);
                        // roughness: mix fine and coarse noise
                        highp float nFine = hashNoise(gp * scale) - 0.5;
                        highp float nCoarse = hashNoise(floor(gp / 3.0) * scale) - 0.5;
                        highp float n = mix(nFine, nCoarse, uGrainRoughness / 100.0);
                        highp float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                        // grain shows more in the midtones (like film)
                        highp float midtone = 1.0 - abs(lum * 2.0 - 1.0);
                        rgb += n * (uGrainAmount / 100.0) * 0.35 * midtone;
                        rgb = clamp(rgb, 0.0, 1.0);
                    }

                    // linear light back to sRGB transfer function (clamped: a strong edit may
                    // push values out of gamut)
                    color = vec4(
                        clamp(linearToSrgb(clamp(rgb.r, 0.0, 1.0)), 0.0, 1.0),
                        clamp(linearToSrgb(clamp(rgb.g, 0.0, 1.0)), 0.0, 1.0),
                        clamp(linearToSrgb(clamp(rgb.b, 0.0, 1.0)), 0.0, 1.0),
                        color.a);
                }

                gl_FragColor = color;
            }`

        super(gl, vertexShaderSource, fragmentShaderSource)
    }
}
