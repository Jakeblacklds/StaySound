"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
    Renderer,
    Camera,
    Mesh,
    Plane,
    Program,
    RenderTarget as OglRenderTarget,
    Texture,
} from "ogl";

const INTRINSIC_WIDTH = 600;
const INTRINSIC_HEIGHT = 400;
const DEFAULT_GLYPH_PADDING_PX = 2;
const DEFAULT_CHARACTERS = "●○•·";

const perlinVertexShader = `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`;

const perlinFragmentShader = `#version 300 es
precision mediump float;
uniform float uFrequency;
uniform float uPhase;
uniform float uValue;
uniform vec2 uResolution;
uniform vec2 uDrift;
uniform vec3 uPulse;
uniform float uReactivity;
in vec2 vUv;
out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  // Centred coordinates: the field breathes about the middle of the screen
  // instead of being scaled about its top-left corner, which used to drag the
  // whole pattern sideways whenever the music changed its scale.
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);

  float pulse = clamp(uPulse.x, 0.0, 1.0) * uReactivity;
  float swell = clamp(uPulse.y, 0.0, 1.0) * uReactivity;

  // Inhale on the downbeat. Position is only ever touched by quantities that
  // are continuous in time (this zoom, and the integrated drift), so the field
  // never jumps between frames.
  float zoom = 1.0 - swell * 0.030 - pulse * 0.026;
  p = p * zoom + uDrift;

  float coarse = snoise(vec3(p * uFrequency, uPhase));
  float fine = snoise(vec3(p * uFrequency * 2.7 + vec2(19.3, 7.1), uPhase * 1.31 + 5.0));

  // Surface tension. At rest the fine lobe keeps the field broken up and
  // grainy; on a transient it is pulled into the coarse body, so neighbouring
  // cells agree, blobs coalesce, and they slowly separate again on the decay.
  float cohesion = clamp(pulse * 1.15 + swell * 0.30, 0.0, 1.0);
  float grain = mix(0.22, 0.06, cohesion);

  float field = coarse * (1.0 - grain) + fine * grain;
  float hue = abs(field);
  vec3 rainbowColor = hsv2rgb(vec3(hue, 1.0, uValue));
  fragColor = vec4(rainbowColor, 1.0);
}`;

const dotVertexShader = `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`;

const dotFragmentShader = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uTexture;
uniform int uPaletteCount;
uniform vec3 uPalette[10];
uniform float uPaletteA[10];
uniform float uCellSize;
uniform float uGamma;
uniform float uPaletteBias;
uniform int uUseGlyphAtlas;
uniform sampler2D uGlyphAtlas;
uniform ivec2 uGlyphGrid;
uniform int uCharCount;
uniform vec4 uAudio;
uniform vec3 uPulse;
uniform float uReactivity;
out vec4 fragColor;

void main() {
  vec2 pix = gl_FragCoord.xy;
  float cell = max(uCellSize, 1.0);

  vec2 cellIdx = floor(pix / cell);
  vec2 cellCenter = (cellIdx + 0.5) * cell;
  vec3 col = texture(uTexture, cellCenter / uResolution.xy).rgb;
  float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;
  gray = pow(clamp(gray, 0.0001, 1.0), uGamma);

  float pulse = clamp(uPulse.x, 0.0, 1.0) * uReactivity;
  float swell = clamp(uPulse.y, 0.0, 1.0) * uReactivity;
  float age = uPulse.z;

  // One soft wavefront leaves the centre on each onset and fades out before it
  // reaches the corners, so the beat reads as the field breathing outwards
  // rather than as every dot flashing at once.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float radial = length((cellCenter / uResolution.xy - 0.5) * vec2(aspect, 1.0));
  float travel = age * 0.72;
  // pow() is undefined for a negative base and smoothstep() for reversed
  // edges, so the falloff is written out longhand rather than relying on
  // whatever a given driver happens to do with either.
  float front = (radial - travel) / 0.30;
  float ring = exp(-front * front)
             * pulse
             * (1.0 - smoothstep(0.30, 1.20, travel));

  // Loudness thickens the matrix; the beat lets the brightest cores push past
  // radius 0.5, which is where neighbouring dots touch and fuse into blobs.
  float density = clamp(uAudio.w, 0.0, 1.0) * 0.030 * uReactivity;
  float bloom = 1.0 + swell * 0.035 + pulse * 0.030 + ring * 0.090;

  float mark = 0.0;
  if (uUseGlyphAtlas == 1 && uCharCount > 0 && uGlyphGrid.x > 0 && uGlyphGrid.y > 0) {
    float g = clamp(gray + uPaletteBias, 0.0, 1.0);
    int idx = int(clamp(floor(g * float(uCharCount - 1) + 0.5), 0.0, float(uCharCount - 1)));
    vec2 cellUV = fract(pix / cell);
    vec2 grid = vec2(uGlyphGrid);
    vec2 tileSize = 1.0 / grid;
    float colIdx = float(idx % uGlyphGrid.x);
    float rowIdx = floor(float(idx) / float(uGlyphGrid.x));
    vec2 atlasUV = (vec2(colIdx, rowIdx) + cellUV) * tileSize;
    vec3 glyphSample = texture(uGlyphAtlas, atlasUV).rgb;
    mark = dot(glyphSample, vec3(0.299, 0.587, 0.114));
  } else {
    vec2 cellUV = fract(pix / cell) - 0.5;
    float dist = length(cellUV);
    float radius = clamp(gray + uPaletteBias + density, 0.0, 1.0) * 0.5 * bloom;
    float aa = fwidth(dist) + 1e-4;
    mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);
  }

  float g2 = clamp(gray + uPaletteBias + density, 0.0, 1.0);
  int cnt = max(uPaletteCount, 1);
  vec3 dotCol;
  float dotOpacity;
  if (cnt <= 1) {
    dotCol = uPalette[0];
    dotOpacity = uPaletteA[0];
  } else {
    float scaled = g2 * float(cnt - 1);
    int i0 = int(floor(scaled));
    i0 = clamp(i0, 0, cnt - 2);
    float f = scaled - float(i0);
    dotCol = mix(uPalette[i0], uPalette[i0 + 1], f);
    dotOpacity = mix(uPaletteA[i0], uPaletteA[i0 + 1], f);
  }
  dotOpacity = min(1.0, dotOpacity * (1.0 + ring * 0.10 + swell * 0.03));
  fragColor = vec4(dotCol, mark * dotOpacity);
}`;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColorToRgba(input: string): Rgba {
    if (!input) return { r: 0, g: 0, b: 0, a: 1 };
    const str = input.trim();
    const rgbaMatch = str.match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i
    );
    if (rgbaMatch) {
        const r = Math.max(0, Math.min(255, parseFloat(rgbaMatch[1]))) / 255;
        const g = Math.max(0, Math.min(255, parseFloat(rgbaMatch[2]))) / 255;
        const b = Math.max(0, Math.min(255, parseFloat(rgbaMatch[3]))) / 255;
        const a =
            rgbaMatch[4] !== undefined
                ? Math.max(0, Math.min(1, parseFloat(rgbaMatch[4])))
                : 1;
        return { r, g, b, a };
    }
    const hex = str.replace(/^#/, "");
    if (hex.length === 8) {
        return {
            r: parseInt(hex.slice(0, 2), 16) / 255,
            g: parseInt(hex.slice(2, 4), 16) / 255,
            b: parseInt(hex.slice(4, 6), 16) / 255,
            a: parseInt(hex.slice(6, 8), 16) / 255,
        };
    }
    if (hex.length === 6) {
        return {
            r: parseInt(hex.slice(0, 2), 16) / 255,
            g: parseInt(hex.slice(2, 4), 16) / 255,
            b: parseInt(hex.slice(4, 6), 16) / 255,
            a: 1,
        };
    }
    if (hex.length === 4) {
        return {
            r: parseInt(hex[0] + hex[0], 16) / 255,
            g: parseInt(hex[1] + hex[1], 16) / 255,
            b: parseInt(hex[2] + hex[2], 16) / 255,
            a: parseInt(hex[3] + hex[3], 16) / 255,
        };
    }
    if (hex.length === 3) {
        return {
            r: parseInt(hex[0] + hex[0], 16) / 255,
            g: parseInt(hex[1] + hex[1], 16) / 255,
            b: parseInt(hex[2] + hex[2], 16) / 255,
            a: 1,
        };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
}

function colorStringToVec4(input: string): [number, number, number, number] {
    const { r, g, b, a } = parseColorToRgba(input);
    return [r, g, b, a];
}

function mapLinear(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
): number {
    if (inMax === inMin) return outMin;
    const t = (value - inMin) / (inMax - inMin);
    return outMin + t * (outMax - outMin);
}

function mapFrequencyUiToShader(ui: number): number {
    return mapLinear(ui, 1, 10, 0.3, 6);
}
function mapSpeedUiToShader(ui: number): number {
    return ui * 0.05;
}
function mapCellSizeUiToShader(ui: number): number {
    return mapLinear(ui, 1, 100, 6, 60);
}
function mapGammaUiToShader(ui: number): number {
    return mapLinear(ui, 1, 20, 0.5, 8);
}
function mapPaletteBiasUiToShader(ui: number): number {
    return ui * 0.05;
}

/** Texels kept per dot cell in the low-resolution simplex target. */
const FIELD_TEXELS_PER_CELL = 3;

/**
 * Size of the offscreen field pass. The dot pass only ever samples it at cell
 * centres, so a handful of texels per cell is indistinguishable from full
 * resolution — and roughly 25x cheaper for the one shader that is expensive.
 */
function fieldSize(
    canvasWidth: number,
    canvasHeight: number,
    cellSizeUi: number
): [number, number] {
    const cellPx = Math.max(1, mapCellSizeUiToShader(cellSizeUi));
    const scale = Math.min(1, Math.max(0.2, FIELD_TEXELS_PER_CELL / cellPx));
    return [
        Math.max(2, Math.round(canvasWidth * scale)),
        Math.max(2, Math.round(canvasHeight * scale)),
    ];
}

type FontSettings = { family: string; weight: string | number; sizePx: number };

function deriveFontSettings(
    fallbackFamily: string,
    fallbackWeight: string | number,
    fallbackSizePx: number
): FontSettings {
    return { family: fallbackFamily, weight: fallbackWeight, sizePx: fallbackSizePx };
}

function buildGlyphAtlas(
    gl: any,
    characters: string,
    fontFamily: string,
    fontWeight: string | number,
    fontSizePx: number,
    paddingPx: number
) {
    const count = Math.max(1, characters.length);
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellPx = Math.max(8, fontSizePx + paddingPx * 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = cols * cellPx * dpr;
    canvas.height = rows * cellPx * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
    for (let i = 0; i < count; i++) {
        const cx = i % cols;
        const cy = Math.floor(i / cols);
        const x = cx * cellPx + cellPx / 2;
        const y = cy * cellPx + cellPx / 2;
        ctx.fillText(characters[i], x, y);
    }
    const texture = new Texture(gl, {
        image: canvas,
        wrapS: gl.CLAMP_TO_EDGE,
        wrapT: gl.CLAMP_TO_EDGE,
        generateMipmaps: false,
        flipY: true,
    });
    return { texture, cols, rows, cellPx, count };
}

const MAX_COLORS = 10;
const DEFAULT_COLORS = ["#FFFFFF", "#E07000", "#000000"];

function buildPaletteUniforms(colorList: string[]) {
    const rgb: [number, number, number][] = [];
    const alpha: number[] = [];
    for (let i = 0; i < MAX_COLORS; i++) {
        const src = colorList[i];
        if (src != null) {
            const [r, g, b, a] = colorStringToVec4(src);
            rgb.push([r, g, b]);
            alpha.push(a);
        } else {
            rgb.push([0, 0, 0]);
            alpha.push(0);
        }
    }
    return { rgb, alpha };
}

export interface DottedAudioSignal {
    bass: number;
    mid: number;
    treble: number;
    level: number;
    /** Percussive onset envelope, 0..1. */
    pulse?: number;
    /** Slow loudness envelope, 0..1. */
    swell?: number;
    /** Seconds since the last onset — drives the outgoing wavefront. */
    pulseAge?: number;
}

interface DottedBackgroundProps {
    frequency?: number;
    speed?: number;
    bgColor?: string;
    colors?: string[];
    cellSize?: number;
    gamma?: number;
    paletteBias?: number;
    style?: CSSProperties;
    useGlyphAtlas?: boolean;
    characters?: string;
    fontFamily?: string;
    fontWeight?: string | number;
    fontSizePx?: number;
    audioSignalRef?: RefObject<DottedAudioSignal>;
    /** 0 = ignore the music entirely, 1 = full (still deliberately subtle). */
    reactivity?: number;
    /** Render cadence. 30 is plenty for an ambient layer; 60 for the player. */
    fps?: number;
    /** Device-pixel-ratio ceiling for the backing canvas. */
    maxDpr?: number;
}

export default function DottedBackground({
    frequency = 1,
    speed = 6,
    bgColor = "#000000",
    colors,
    cellSize = 20,
    gamma = 4,
    paletteBias = 10,
    style,
    useGlyphAtlas = false,
    characters = DEFAULT_CHARACTERS,
    fontFamily = "monospace",
    fontWeight = 400,
    fontSizePx = 42,
    audioSignalRef,
    reactivity = 1,
    fps = 30,
    maxDpr = 2,
}: DottedBackgroundProps) {
    const useGlyphAtlasFlag = useGlyphAtlas === true;
    const paletteColors =
        Array.isArray(colors) && colors.length > 0 ? colors : DEFAULT_COLORS;
    const effPaletteCount = Math.min(
        MAX_COLORS,
        Math.max(1, paletteColors.length)
    );
    const palette = buildPaletteUniforms(paletteColors);
    const paletteKey = paletteColors.slice(0, MAX_COLORS).join("|");

    const effectiveCharacters = (() => {
        const raw = typeof characters === "string" ? characters : "";
        const sanitized = Array.from(raw)
            .filter((ch) => !/\s/.test(ch))
            .join("");
        return sanitized.length > 0 ? sanitized : DEFAULT_CHARACTERS;
    })();

    const effectivePlay = true;

    // Bumped whenever the GL context has to be rebuilt after a loss.
    const [contextEpoch, setContextEpoch] = useState(0);

    // Survives the rebuild it schedules, so repeated losses can back off
    // instead of restarting from the same delay every time.
    const glRecoveryRef = useRef({ attempts: 0, lastLostAt: 0 });

    const containerRef = useRef<HTMLDivElement>(null);
    const perlinProgramRef = useRef<any>(null);
    const dotProgramRef = useRef<any>(null);
    const rendererRef = useRef<any>(null);
    const cameraRef = useRef<any>(null);
    const perlinMeshRef = useRef<any>(null);
    const dotMeshRef = useRef<any>(null);
    const renderTargetRef = useRef<any>(null);
    const glRef = useRef<any>(null);
    const rafIdRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);
    const phaseRef = useRef(0);
    const driftRef = useRef<[number, number]>([0, 0]);
    const reactivityRef = useRef(reactivity);
    const cellSizeRef = useRef(cellSize);
    cellSizeRef.current = cellSize;
    const speedRef = useRef(speed);
    const fpsRef = useRef(fps);
    reactivityRef.current = reactivity;
    speedRef.current = speed;
    fpsRef.current = fps;
    const isPlayingRef = useRef(effectivePlay);
    const glyphTextureRef = useRef<any>(null);
    const glyphGridRef = useRef<any>(null);
    const dummyGlyphTextureRef = useRef<any>(null);

    const renderOnce = () => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        const perlinMesh = perlinMeshRef.current;
        const dotMesh = dotMeshRef.current;
        const renderTarget = renderTargetRef.current;
        const gl = glRef.current;
        const dotProgram = dotProgramRef.current;
        if (
            !renderer ||
            !camera ||
            !perlinMesh ||
            !dotMesh ||
            !renderTarget ||
            !gl ||
            !dotProgram
        )
            return;
        renderer.render({ scene: perlinMesh, camera, target: renderTarget });
        dotProgram.uniforms.uResolution.value = [
            gl.canvas.width,
            gl.canvas.height,
        ];
        renderer.render({ scene: dotMesh, camera });
    };

    useEffect(() => {
        let resizeHandler: (() => void) | null = null;
        let resizeObserver: ResizeObserver | null = null;
        const container = containerRef.current;
        if (!container) return;

        const renderer = new Renderer({
            dpr: Math.min(window.devicePixelRatio || 1, Math.max(0.75, maxDpr)),
            alpha: true,
            premultipliedAlpha: false,
            // Two fullscreen quads, no depth testing: the default depth buffer
            // is pure wasted GPU memory on a canvas this size.
            depth: false,
        });
        const gl = renderer.gl;
        container.appendChild(gl.canvas);
        rendererRef.current = renderer;
        glRef.current = gl;

        // ogl ships with a "TODO: Handle context loss", so the page has to do
        // it. Without preventDefault() the browser never even attempts to
        // restore, and the field would stay dead until the next remount.
        let rebuildScheduled = false;
        let restoreTimer = 0;
        const requestRebuild = () => {
            if (rebuildScheduled) return;
            rebuildScheduled = true;
            window.clearTimeout(restoreTimer);
            setContextEpoch((epoch) => epoch + 1);
        };
        const handleContextLost = (event: Event) => {
            event.preventDefault();
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            // The rebuild does not reuse the lost context — it builds a new
            // canvas with a new one — so there is nothing to wait for in the
            // common case, and every millisecond spent waiting is a frozen
            // picture with the audio still playing. Go almost immediately.
            //
            // The exception is a context that dies again right after a
            // rebuild: the GPU is still under pressure and retrying at once
            // would spin. Each loss inside five seconds of the last one backs
            // the delay off toward the old ceiling.
            //
            // `webglcontextrestored` still races this timer, but WKWebView
            // does not deliver it reliably, so it can only make things faster.
            const now = performance.now();
            const recovery = glRecoveryRef.current;
            recovery.attempts =
                now - recovery.lastLostAt < 5000 ? recovery.attempts + 1 : 0;
            recovery.lastLostAt = now;
            const delay = Math.min(1500, 120 * Math.pow(3, recovery.attempts));
            restoreTimer = window.setTimeout(requestRebuild, delay);
        };
        const handleContextRestored = () => requestRebuild();
        gl.canvas.addEventListener("webglcontextlost", handleContextLost);
        gl.canvas.addEventListener("webglcontextrestored", handleContextRestored);

        const camera = new Camera(gl, { near: 0.1, far: 100 });
        camera.position.set(0, 0, 3);
        cameraRef.current = camera;

        const doResize = () => {
            const width = container.clientWidth || window.innerWidth;
            const height = container.clientHeight || window.innerHeight;
            renderer.setSize(width, height);
            camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
            if (renderTargetRef.current && renderTargetRef.current.setSize) {
                const [fieldWidth, fieldHeight] = fieldSize(
                    gl.canvas.width,
                    gl.canvas.height,
                    cellSizeRef.current
                );
                renderTargetRef.current.setSize(fieldWidth, fieldHeight);
            }
            if (perlinProgramRef.current) {
                perlinProgramRef.current.uniforms.uResolution.value = [
                    gl.canvas.width,
                    gl.canvas.height,
                ];
            }
        };

        let resizePending = false;
        const scheduleResize = () => {
            if (resizePending) return;
            resizePending = true;
            requestAnimationFrame(() => {
                resizePending = false;
                doResize();
                if (!isPlayingRef.current) renderOnce();
            });
        };
        resizeHandler = scheduleResize;
        window.addEventListener("resize", scheduleResize);
        if (typeof window.ResizeObserver !== "undefined") {
            resizeObserver = new window.ResizeObserver(scheduleResize);
            resizeObserver.observe(container);
        }
        scheduleResize();

        const perlinProgram = new Program(gl, {
            vertex: perlinVertexShader,
            fragment: perlinFragmentShader,
            uniforms: {
                uPhase: { value: 0 },
                uFrequency: { value: mapFrequencyUiToShader(frequency) },
                uValue: { value: 1 },
                uResolution: { value: [gl.canvas.width, gl.canvas.height] },
                uDrift: { value: [0, 0] },
                uPulse: { value: [0, 0, 4] },
                uReactivity: { value: reactivity },
            },
        });
        perlinProgramRef.current = perlinProgram;
        const perlinMesh = new Mesh(gl, {
            geometry: new Plane(gl, { width: 2, height: 2 }),
            program: perlinProgram,
        });
        perlinMeshRef.current = perlinMesh;

        // Only one texel per cell centre is ever read, so rendering the (costly)
        // simplex pass at full device resolution burns ~16x the fragments for a
        // field whose finest feature spans hundreds of pixels. Keep a few texels
        // per cell and spend the headroom on a smoother frame rate instead.
        const [initialFieldWidth, initialFieldHeight] = fieldSize(
            gl.canvas.width,
            gl.canvas.height,
            cellSizeRef.current
        );
        const renderTarget = new OglRenderTarget(gl, {
            width: initialFieldWidth,
            height: initialFieldHeight,
            depth: false,
        });
        renderTargetRef.current = renderTarget;

        const dummyGlyphTexture = new Texture(gl, {
            width: 1,
            height: 1,
            generateMipmaps: false,
            flipY: false,
        });
        dummyGlyphTextureRef.current = dummyGlyphTexture;

        const dotProgram = new Program(gl, {
            vertex: dotVertexShader,
            fragment: dotFragmentShader,
            uniforms: {
                uResolution: { value: [gl.canvas.width, gl.canvas.height] },
                uTexture: { value: renderTarget.texture },
                uPaletteCount: { value: effPaletteCount },
                uPalette: { value: palette.rgb },
                uPaletteA: { value: palette.alpha },
                uCellSize: { value: mapCellSizeUiToShader(cellSize) },
                uGamma: { value: mapGammaUiToShader(gamma) },
                uPaletteBias: { value: mapPaletteBiasUiToShader(paletteBias) },
                uUseGlyphAtlas: { value: useGlyphAtlasFlag ? 1 : 0 },
                uGlyphAtlas: { value: dummyGlyphTexture },
                uGlyphGrid: { value: [0, 0] },
                uCharCount: { value: 0 },
                uAudio: { value: [0, 0, 0, 0] },
                uPulse: { value: [0, 0, 4] },
                uReactivity: { value: reactivity },
            },
        });
        dotProgramRef.current = dotProgram;
        const dotMesh = new Mesh(gl, {
            geometry: new Plane(gl, { width: 2, height: 2 }),
            program: dotProgram,
        });
        dotMeshRef.current = dotMesh;

        if (useGlyphAtlasFlag) {
            try {
                const f = deriveFontSettings(fontFamily, fontWeight, fontSizePx);
                const fontCSS = `${f.weight} ${f.sizePx}px ${f.family}`;
                if (document.fonts && document.fonts.load) {
                    document.fonts.load(fontCSS).catch(() => {});
                }
            } catch {}
            const f = deriveFontSettings(fontFamily, fontWeight, fontSizePx);
            const atlas = buildGlyphAtlas(
                gl,
                effectiveCharacters,
                f.family,
                f.weight,
                f.sizePx,
                DEFAULT_GLYPH_PADDING_PX
            );
            glyphTextureRef.current = atlas.texture;
            glyphGridRef.current = {
                cols: atlas.cols,
                rows: atlas.rows,
                count: atlas.count,
            };
            dotProgram.uniforms.uGlyphAtlas.value = atlas.texture;
            dotProgram.uniforms.uGlyphGrid.value = [atlas.cols, atlas.rows];
            dotProgram.uniforms.uCharCount.value = atlas.count;
            dotProgram.uniforms.uUseGlyphAtlas.value = 1;
        }

        const update = (time: number) => {
            if (!isPlayingRef.current) {
                rafIdRef.current = null;
                return;
            }
            rafIdRef.current = requestAnimationFrame(update);

            // `lastTimeRef` is 0 until the first frame is actually drawn, so
            // the throttle has to let that first one through unconditionally —
            // deriving `last` from `time` instead deadlocks the loop, because
            // the elapsed time is then always 0 and the assignment below (the
            // only thing that ever advances `lastTimeRef`) is never reached.
            const last = lastTimeRef.current;
            const frameInterval = 1e3 / Math.max(12, fpsRef.current);
            const elapsed = last === 0 ? frameInterval : time - last;
            if (elapsed < frameInterval - 1) return;
            const dt = Math.min(0.1, Math.max(1 / 240, elapsed / 1000));
            lastTimeRef.current = time;
            if (typeof document !== "undefined" && document.hidden) return;

            const audio = audioSignalRef?.current;
            const react = Math.max(0, reactivityRef.current);
            const bass = audio?.bass ?? 0;
            const mid = audio?.mid ?? 0;
            const treble = audio?.treble ?? 0;
            const level = audio?.level ?? 0;
            const pulse = audio?.pulse ?? 0;
            const swell = audio?.swell ?? 0;
            const pulseAge = audio?.pulseAge ?? 4;

            // The music bends the *velocity* of the noise field, never its
            // absolute phase. Scaling elapsed time directly (as this did) means
            // a 7% tempo nudge teleports a field that is minutes old several
            // whole noise units forward — the beat scrambled the pattern instead
            // of breathing it.
            const warp = 1 + (level * 0.22 + pulse * 0.42) * react;
            phaseRef.current +=
                dt * mapSpeedUiToShader(speedRef.current) * warp;

            // Leaky integration keeps the current bounded: bands push the flow,
            // and it always eases back towards the resting frame.
            const drift = driftRef.current;
            const flowX = (treble - bass * 0.55) * 0.09 * react;
            const flowY = (mid - bass * 0.42) * 0.075 * react;
            const decay = Math.exp(-dt / 6);
            drift[0] = (drift[0] + flowX * dt) * decay;
            drift[1] = (drift[1] + flowY * dt) * decay;

            perlinProgram.uniforms.uPhase.value = phaseRef.current;
            perlinProgram.uniforms.uDrift.value = drift;
            const perlinPulse = perlinProgram.uniforms.uPulse.value;
            perlinPulse[0] = pulse;
            perlinPulse[1] = swell;
            perlinPulse[2] = pulseAge;
            perlinProgram.uniforms.uReactivity.value = react;

            const dotAudio = dotProgram.uniforms.uAudio.value;
            dotAudio[0] = bass;
            dotAudio[1] = mid;
            dotAudio[2] = treble;
            dotAudio[3] = level;
            const dotPulse = dotProgram.uniforms.uPulse.value;
            dotPulse[0] = pulse;
            dotPulse[1] = swell;
            dotPulse[2] = pulseAge;
            dotProgram.uniforms.uReactivity.value = react;

            renderer.render({
                scene: perlinMesh,
                camera,
                target: renderTarget,
            });
            dotProgram.uniforms.uResolution.value = [
                gl.canvas.width,
                gl.canvas.height,
            ];
            perlinProgram.uniforms.uResolution.value = [
                gl.canvas.width,
                gl.canvas.height,
            ];
            renderer.render({ scene: dotMesh, camera });
        };

        renderOnce();
        isPlayingRef.current = effectivePlay;
        if (effectivePlay && rafIdRef.current == null) {
            lastTimeRef.current = 0;
            rafIdRef.current = requestAnimationFrame(update);
        }

        return () => {
            if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
            if (resizeHandler)
                window.removeEventListener("resize", resizeHandler);
            if (resizeObserver) {
                try {
                    resizeObserver.disconnect();
                } catch {}
                resizeObserver = null;
            }
            if (glyphTextureRef.current) {
                try {
                    const tex = glyphTextureRef.current;
                    if (typeof tex.destroy === "function") tex.destroy();
                    else if (typeof tex.delete === "function") tex.delete();
                } catch {}
                glyphTextureRef.current = null;
                glyphGridRef.current = null;
            }
            if (dummyGlyphTextureRef.current) {
                try {
                    const tex = dummyGlyphTextureRef.current;
                    if (typeof tex.destroy === "function") tex.destroy();
                    else if (typeof tex.delete === "function") tex.delete();
                } catch {}
                dummyGlyphTextureRef.current = null;
            }
            window.clearTimeout(restoreTimer);
            gl.canvas.removeEventListener("webglcontextlost", handleContextLost);
            gl.canvas.removeEventListener(
                "webglcontextrestored",
                handleContextRestored
            );
            if (gl && gl.canvas && gl.canvas.parentElement === container) {
                container.removeChild(gl.canvas);
            }
            // Hand the GPU memory back now rather than whenever GC gets around
            // to noticing the detached canvas. WebKit caps how many live WebGL
            // contexts a page may hold; leaking one per mount eventually takes
            // the GPU process down, which freezes *all* painting in the window
            // (audio keeps playing, so it reads as the UI hanging).
            try {
                gl.getExtension("WEBGL_lose_context")?.loseContext();
            } catch {}
            try {
                gl.canvas.width = 1;
                gl.canvas.height = 1;
            } catch {}
            perlinProgramRef.current = null;
            dotProgramRef.current = null;
            rendererRef.current = null;
            cameraRef.current = null;
            perlinMeshRef.current = null;
            dotMeshRef.current = null;
            renderTargetRef.current = null;
            glRef.current = null;
            rafIdRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contextEpoch]);

    useEffect(() => {
        const perlin = perlinProgramRef.current;
        if (perlin) {
            perlin.uniforms.uFrequency.value = mapFrequencyUiToShader(frequency);
            perlin.uniforms.uReactivity.value = reactivity;
        }
        const dot = dotProgramRef.current;
        if (dot) {
            dot.uniforms.uPaletteCount.value = effPaletteCount;
            dot.uniforms.uPalette.value = palette.rgb;
            dot.uniforms.uPaletteA.value = palette.alpha;
            dot.uniforms.uCellSize.value = mapCellSizeUiToShader(cellSize);
            dot.uniforms.uReactivity.value = reactivity;
            const target = renderTargetRef.current;
            const gl = glRef.current;
            if (target?.setSize && gl) {
                const [fieldWidth, fieldHeight] = fieldSize(
                    gl.canvas.width,
                    gl.canvas.height,
                    cellSize
                );
                if (target.width !== fieldWidth || target.height !== fieldHeight) {
                    target.setSize(fieldWidth, fieldHeight);
                }
            }
            dot.uniforms.uGamma.value = mapGammaUiToShader(gamma);
            dot.uniforms.uPaletteBias.value =
                mapPaletteBiasUiToShader(paletteBias);

            if (useGlyphAtlasFlag && glRef.current) {
                if (glyphTextureRef.current) {
                    try {
                        const tex = glyphTextureRef.current;
                        if (typeof tex.destroy === "function") tex.destroy();
                        else if (typeof tex.delete === "function") tex.delete();
                    } catch {}
                    glyphTextureRef.current = null;
                    glyphGridRef.current = null;
                }
                try {
                    const gl = glRef.current;
                    const f = deriveFontSettings(fontFamily, fontWeight, fontSizePx);
                    const atlas = buildGlyphAtlas(
                        gl,
                        effectiveCharacters,
                        f.family,
                        f.weight,
                        f.sizePx,
                        DEFAULT_GLYPH_PADDING_PX
                    );
                    glyphTextureRef.current = atlas.texture;
                    glyphGridRef.current = {
                        cols: atlas.cols,
                        rows: atlas.rows,
                        count: atlas.count,
                    };
                    dot.uniforms.uGlyphAtlas.value = atlas.texture;
                    dot.uniforms.uGlyphGrid.value = [atlas.cols, atlas.rows];
                    dot.uniforms.uCharCount.value = atlas.count;
                    dot.uniforms.uUseGlyphAtlas.value = 1;
                } catch {
                    dot.uniforms.uUseGlyphAtlas.value = 0;
                    dot.uniforms.uCharCount.value = 0;
                    if (dummyGlyphTextureRef.current) {
                        dot.uniforms.uGlyphAtlas.value =
                            dummyGlyphTextureRef.current;
                    }
                }
            } else {
                dot.uniforms.uUseGlyphAtlas.value = 0;
                dot.uniforms.uCharCount.value = 0;
                if (dummyGlyphTextureRef.current) {
                    dot.uniforms.uGlyphAtlas.value =
                        dummyGlyphTextureRef.current;
                }
            }
        }
        if (rendererRef.current && glRef.current) {
            const gl = glRef.current;
            if (perlin)
                perlin.uniforms.uResolution.value = [
                    gl.canvas.width,
                    gl.canvas.height,
                ];
            if (dot)
                dot.uniforms.uResolution.value = [
                    gl.canvas.width,
                    gl.canvas.height,
                ];
        }
        if (!isPlayingRef.current) renderOnce();
    }, [
        effectivePlay,
        frequency,
        speed,
        effPaletteCount,
        bgColor,
        paletteKey,
        cellSize,
        gamma,
        paletteBias,
        useGlyphAtlas,
        characters,
        fontFamily,
        fontWeight,
        fontSizePx,
        reactivity,
    ]);

    // `effectivePlay` is a constant here; the mount effect owns the single rAF
    // loop. A second copy of it used to live at this spot with its own inlined
    // (and, once the audio integration landed, divergent) frame body.
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                background: bgColor,
                lineHeight: 0,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                ...style,
            }}
        >
            <div
                style={{
                    width: `${INTRINSIC_WIDTH}px`,
                    height: `${INTRINSIC_HEIGHT}px`,
                    minWidth: `${INTRINSIC_WIDTH}px`,
                    minHeight: `${INTRINSIC_HEIGHT}px`,
                    visibility: "hidden",
                    position: "absolute",
                    pointerEvents: "none",
                }}
            />
            <div
                ref={containerRef}
                style={{ position: "absolute", inset: 0 }}
            />
        </div>
    );
}
