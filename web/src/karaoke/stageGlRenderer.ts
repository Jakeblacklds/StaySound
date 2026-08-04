import type { StageFrame } from './stageScenes';

export interface StageGlRenderer {
  render(frame: StageFrame): void;
  destroy(): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform vec4 uBands;
uniform vec4 uMotion;
uniform float uInstrumental;
uniform int uGenre;

#define PI 3.14159265359

float hash11(float p) {
  p = fract(p * .1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n + 19.19));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1., 0.)), f.x),
    mix(hash21(i + vec2(0., 1.)), hash21(i + 1.), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.;
  float amplitude = .5;
  mat2 turn = mat2(.8, .6, -.6, .8);
  for (int octave = 0; octave < 5; octave++) {
    value += noise(p) * amplitude;
    p = turn * p * 2.03 + 7.17;
    amplitude *= .5;
  }
  return value;
}

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float lineGlow(float distanceToLine, float width) {
  return width / max(width, abs(distanceToLine));
}

float boxLine(vec2 p, vec2 halfSize, float width) {
  vec2 d = abs(p) - halfSize;
  float outside = length(max(d, 0.));
  float inside = min(max(d.x, d.y), 0.);
  return 1. - smoothstep(0., width, abs(outside + inside));
}

vec3 popScene(vec2 p, vec2 uv, float t) {
  float bass = uBands.x;
  float mid = uBands.y;
  float treble = uBands.z;
  float vocal = uMotion.x;
  float beat = uMotion.z;
  vec3 color = vec3(0.);

  vec2 silkP = p;
  silkP.y += sin(silkP.x * 1.7 + t * .08) * .055;
  for (int ribbon = 0; ribbon < 4; ribbon++) {
    float fi = float(ribbon);
    float phase = t * (.12 + fi * .018) + fi * 1.73;
    float wave = sin(silkP.x * (2.15 + fi * .28) + phase) * (.16 + mid * .06);
    wave += sin(silkP.x * 5.2 - phase * .7) * .025;
    float offset = (fi - 1.5) * .245;
    float distanceToSilk = abs(silkP.y - wave - offset);
    float body = exp(-distanceToSilk * (16. + fi * 2.));
    float edge = exp(-distanceToSilk * 92.) * (1.2 + treble);
    vec3 ribbonColor = fi < 1. ? uPrimary : fi < 2. ? uSecondary : fi < 3. ? uAccent : mix(uPrimary, uSecondary, .5);
    color += ribbonColor * body * (.22 + bass * .14);
    color += mix(ribbonColor, vec3(1.), .58) * edge * (.28 + treble * .34);
  }

  vec2 cells = uv * vec2(72., 42.);
  cells.y -= t * (.35 + mid * .65);
  vec2 id = floor(cells);
  vec2 local = fract(cells) - .5;
  vec2 jitter = hash22(id) - .5;
  float starDistance = length(local - jitter * .7);
  float stars = smoothstep(.06, 0., starDistance) * step(.82, hash21(id + 4.));
  float starPulse = .35 + .65 * sin(t * (2. + hash21(id) * 3.) + hash21(id + 9.) * 10.);
  color += mix(uPrimary, vec3(1.), .72) * stars * max(.12, starPulse) * (.42 + treble * 1.05);

  float halo = exp(-dot(p * vec2(.82, 1.25), p * vec2(.82, 1.25)) * (4.8 - vocal * 1.8));
  color += mix(uPrimary, vec3(1.), .28) * halo * (.045 + vocal * .16 + beat * .04);
  return color;
}

vec3 rockScene(vec2 p, vec2 uv, float t) {
  float bass = uBands.x;
  float mid = uBands.y;
  float treble = uBands.z;
  float beat = uMotion.z;
  float hit = uMotion.w;
  vec3 color = vec3(0.);

  vec2 q = rotate2d(-.34) * p;
  q.x += sin(q.y * 19. + t * 7.) * hit * .008;
  float smokeA = fbm(q * vec2(2.2, 3.4) + vec2(-t * .11, t * .035));
  float smokeB = fbm(q * vec2(4.5, 2.1) + vec2(t * .07, -t * .025) + smokeA);
  float smoke = smoothstep(.48 - mid * .08, .78, smokeA * .62 + smokeB * .58);
  float torn = smoothstep(.25, .8, noise(q * vec2(14., 3.) + t * vec2(-.9, .08)));
  color += mix(uAccent * .62, vec3(.92, .18, .035), .6) * smoke * torn * (.28 + mid * .3);

  vec2 sparkGrid = vec2(uv.x * 46., uv.y * 25. + t * (3. + treble * 5.));
  vec2 sparkId = floor(sparkGrid);
  vec2 sparkLocal = fract(sparkGrid) - .5;
  float sparkSeed = hash21(sparkId);
  float sparkLine = abs(sparkLocal.x + sparkLocal.y * (.35 + sparkSeed));
  float spark = smoothstep(.028, 0., sparkLine)
    * smoothstep(.48, .08, abs(sparkLocal.y))
    * step(.88 - treble * .08, sparkSeed);
  color += mix(uAccent, vec3(1., .62, .18), .55) * spark * (.72 + hit * 1.65);

  float rightBurn = smoothstep(.48, .94, p.x) * (noise(vec2(p.y * 5., t * .35)) * .55 + .45);
  float leftScratch = smoothstep(.75, .98, -p.x) * noise(vec2(p.y * 22., t * .7));
  color += vec3(1., .12, .025) * rightBurn * (.38 + bass * .3 + hit * .35);
  color += uPrimary * leftScratch * .14;

  float flash = exp(-abs(p.y + p.x * .35) * 26.) * hit;
  color += vec3(1., .62, .34) * flash * .4;
  return color;
}

vec3 reggaetonScene(vec2 p, vec2 uv, float t) {
  float bass = uBands.x;
  float mid = uBands.y;
  float treble = uBands.z;
  float beat = uMotion.z;
  vec3 color = vec3(0.);

  float horizon = .56;
  float floorMask = 1. - smoothstep(horizon - .025, horizon + .04, uv.y);
  float depth = 1. / max(.09, horizon - uv.y + .1);
  vec2 floorP = vec2(p.x * depth * 1.25, depth * .64);
  float liquidWarp = sin(floorP.x * 2.2 + sin(floorP.y * .9 - t * .8)) * .45;
  float caustic = sin(floorP.y * 3.6 - t * (1.8 + bass * 1.8) + liquidWarp);
  caustic += sin(floorP.x * 5.1 + floorP.y * 1.3 + t * .7);
  caustic = pow(max(0., caustic * .5), 3.);

  float radius = length(vec2(p.x, (uv.y - .22) * 2.4));
  float ring = abs(sin(radius * (38. + bass * 12.) - t * (3.2 + beat * 2.)));
  ring = smoothstep(.12, 0., ring) * floorMask;
  color += mix(uPrimary, uSecondary, .4 + .3 * sin(floorP.x)) * caustic * floorMask * (.3 + bass * .4);
  color += mix(uAccent, uPrimary, .45) * ring * (.2 + beat * .5);

  vec2 dropGrid = uv * vec2(42., 26.);
  dropGrid.y += t * (1.2 + mid * 1.2);
  vec2 dropId = floor(dropGrid);
  vec2 dropLocal = fract(dropGrid) - .5;
  vec2 dropOffset = hash22(dropId) - .5;
  float dropDistance = length((dropLocal - dropOffset * .65) * vec2(1., 1.7));
  float drops = smoothstep(.07, .018, dropDistance)
    * step(.9 - treble * .07, hash21(dropId + 18.))
    * smoothstep(.16, .62, uv.y);
  color += mix(uAccent, vec3(1.), .55) * drops * (.35 + treble * .85);

  float humid = fbm(vec2(p.x * 1.8 + t * .03, p.y * 2.5 - t * .06));
  color += mix(uSecondary, uPrimary, uv.x) * humid * smoothstep(.3, .72, humid) * .075;
  return color;
}

vec3 folkScene(vec2 p, vec2 uv, float t) {
  float mid = uBands.y;
  float treble = uBands.z;
  float vocal = uMotion.x;
  vec3 color = vec3(0.);

  vec2 ray = uv - vec2(.88, 1.08);
  float along = max(0., -ray.y);
  float beam = smoothstep(.3, .025, abs(ray.x + ray.y * .46));
  beam *= smoothstep(.02, .22, along) * smoothstep(1.2, .18, along);
  float air = fbm(p * 2.1 + vec2(t * .018, -t * .012));
  beam *= .48 + air * .8;
  color += mix(uAccent, vec3(1., .66, .28), .55) * beam * (.18 + vocal * .2);
  float secondaryBeam = smoothstep(.22, .02, abs(ray.x + ray.y * .72 + .09))
    * smoothstep(.08, .5, along) * smoothstep(1.15, .25, along);
  color += mix(uPrimary, uAccent, .65) * secondaryBeam * (.045 + mid * .08);

  vec2 dustGrid = uv * vec2(58., 34.);
  dustGrid += vec2(sin(t * .12) * .3, -t * (.18 + mid * .18));
  vec2 dustId = floor(dustGrid);
  vec2 dustLocal = fract(dustGrid) - .5;
  vec2 dustJitter = hash22(dustId) - .5;
  float dustDistance = length(dustLocal - dustJitter * .8);
  float dust = smoothstep(.045, .008, dustDistance) * step(.74, hash21(dustId + 3.));
  color += mix(uAccent, vec3(1.), .68) * dust * (.14 + treble * .3) * (.4 + beam);

  vec2 fibreGrid = uv * vec2(19., 12.);
  fibreGrid += vec2(t * .035, -t * .045);
  vec2 fibreId = floor(fibreGrid);
  vec2 fibreLocal = fract(fibreGrid) - .5;
  float fibreSeed = hash21(fibreId + 8.);
  fibreLocal = rotate2d((fibreSeed - .5) * 1.3) * fibreLocal;
  float fibre = smoothstep(.025, .004, abs(fibreLocal.y))
    * smoothstep(.42, .09, abs(fibreLocal.x))
    * step(.87, fibreSeed);
  color += uAccent * fibre * (.16 + vocal * .2);

  float candle = exp(-length((p - vec2(.42, -.46)) * vec2(.75, 1.5)) * 4.);
  candle *= .7 + .3 * noise(vec2(t * 2.2, p.y * 4.));
  color += vec3(1., .38, .08) * candle * (.06 + vocal * .1);
  return color;
}

vec3 discoScene(vec2 p, vec2 uv, float t) {
  float bass = uBands.x;
  float mid = uBands.y;
  float treble = uBands.z;
  float beat = uMotion.z;
  float glow = uMotion.y;
  vec3 color = vec3(0.);

  vec2 shardP = rotate2d(-.32 + sin(t * .08) * .025) * p;
  vec2 voronoiP = shardP * vec2(7.6, 2.45);
  voronoiP += vec2(
    sin(voronoiP.y * 1.28 + t * .06) * .74,
    sin(voronoiP.x * .31 - t * .045) * .18
  );
  vec2 voronoiCell = floor(voronoiP);
  vec2 voronoiLocal = fract(voronoiP);
  float nearest = 10.;
  float secondNearest = 10.;
  vec2 nearestId = vec2(0.);
  vec2 nearestVector = vec2(0.);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbour = vec2(float(x), float(y));
      vec2 point = neighbour + .12 + hash22(voronoiCell + neighbour) * .76;
      vec2 difference = point - voronoiLocal;
      float distanceToPoint = dot(difference, difference);
      if (distanceToPoint < nearest) {
        secondNearest = nearest;
        nearest = distanceToPoint;
        nearestId = voronoiCell + neighbour;
        nearestVector = difference;
      } else if (distanceToPoint < secondNearest) {
        secondNearest = distanceToPoint;
      }
    }
  }
  float seed = hash21(nearestId);
  float shardEdge = smoothstep(.105, .014, secondNearest - nearest);
  vec3 shardColor = seed < .33 ? uPrimary : seed < .66 ? uSecondary : uAccent;
  float planeLight = pow(
    .5 + .5 * sin(seed * 21. + t * (.18 + seed * .08) + nearestVector.x * 5.),
    3.
  );
  float shardSurface = smoothstep(.82, .04, nearest)
    * (.12 + planeLight * .88);
  color += mix(shardColor * .48, vec3(1.), planeLight * .42)
    * shardSurface * (.21 + bass * .18 + glow * .11);
  float fracture = shardEdge * step(.72, hash21(nearestId + 11.));
  color += mix(shardColor, vec3(1.), .82) * fracture * (.035 + treble * .11 + glow * .08);

  for (int beamIndex = 0; beamIndex < 4; beamIndex++) {
    float fi = float(beamIndex);
    vec2 beamP = rotate2d(-.72 + fi * .49 + sin(t * (.11 + fi * .01)) * .045) * p;
    float beam = lineGlow(beamP.y - (.3 - fi * .2), .006 + mid * .003);
    float fade = smoothstep(1.1, .08, abs(beamP.x));
    vec3 beamColor = fi < 1. ? uPrimary : fi < 2. ? vec3(1.) : fi < 3. ? uSecondary : uAccent;
    color += beamColor * beam * fade * (.012 + glow * .026);
  }

  vec2 glintGrid = uv * vec2(24., 14.);
  vec2 glintId = floor(glintGrid);
  vec2 glintLocal = fract(glintGrid) - .5;
  float glintSeed = hash21(glintId + 17.);
  float glintPhase = pow(max(0., sin(t * (1.3 + glintSeed) + glintSeed * 18.)), 18.);
  float cross = max(
    smoothstep(.022, .002, abs(glintLocal.x)) * smoothstep(.35, .02, abs(glintLocal.y)),
    smoothstep(.022, .002, abs(glintLocal.y)) * smoothstep(.35, .02, abs(glintLocal.x))
  );
  cross *= step(.84, glintSeed) * glintPhase;
  color += vec3(1.) * cross * (.45 + treble * 1.1);

  float prism = .5 + .5 * sin((p.x + p.y * .28) * 8. - t * (1. + beat));
  color += mix(uPrimary, uSecondary, prism) * fracture * beat * .18;
  return color;
}

vec3 electronicScene(vec2 p, vec2 uv, float t) {
  float bass = uBands.x;
  float mid = uBands.y;
  float treble = uBands.z;
  float pitch = uMotion.y;
  float hit = uMotion.w;
  vec3 color = vec3(0.);

  vec2 chamber = p;
  chamber.x += floor(hit * 4.) * .003;
  float digitalFog = fbm(chamber * vec2(2.4, 3.8) + vec2(-t * .06, t * .025));
  color += mix(uPrimary, uSecondary, smoothstep(.32, .75, digitalFog))
    * smoothstep(.48, .86, digitalFog) * (.06 + mid * .09);
  for (int gate = 0; gate < 7; gate++) {
    float fi = float(gate);
    float depth = fract(fi / 7. + t * .035);
    vec2 center = vec2(.35 + depth * .58, -.03 + depth * .14);
    vec2 size = vec2(.58 - depth * .49, .42 - depth * .34);
    float frame = boxLine(chamber - center, size, .004 + (1. - depth) * .002);
    vec3 gateColor = mod(fi, 3.) < 1. ? uSecondary : uPrimary;
    color += gateColor * frame * (.09 + mid * .16) * (1. - depth * .45);
  }

  float scan = .5 + .5 * sin(uv.y * uResolution.y * .5);
  color += uPrimary * scan * (.014 + treble * .034);

  vec2 dataGrid = uv * vec2(72., 38.);
  dataGrid.x -= t * (2. + mid * 4.);
  vec2 dataId = floor(dataGrid);
  vec2 dataLocal = fract(dataGrid) - .5;
  float dataSeed = hash21(dataId);
  float dash = smoothstep(.48, .12, abs(dataLocal.x))
    * smoothstep(.045, .006, abs(dataLocal.y))
    * step(.78, dataSeed);
  color += (dataSeed > .94 ? uAccent : uPrimary) * dash * (.14 + treble * .44);

  float horizonY = mix(-.38, .38, pitch);
  float horizon = lineGlow(p.y - horizonY, .0025 + hit * .002);
  color += mix(uPrimary, uAccent, hit) * horizon * (.026 + hit * .065);

  float faultBand = smoothstep(.04, 0., abs(p.y - sin(t * .7) * .3)) * hit;
  color.r += faultBand * .09;
  color.b += faultBand * .14;
  color *= .82 + bass * .3;
  return color;
}

void main() {
  float aspect = uResolution.x / max(1., uResolution.y);
  vec2 p = vUv - .5;
  p.x *= aspect;
  float t = uTime;

  vec3 color;
  if (uGenre == 1) {
    color = rockScene(p, vUv, t);
  } else if (uGenre == 2) {
    color = reggaetonScene(p, vUv, t);
  } else if (uGenre == 3) {
    color = folkScene(p, vUv, t);
  } else if (uGenre == 4) {
    color = discoScene(p, vUv, t);
  } else if (uGenre == 5) {
    color = electronicScene(p, vUv, t);
  } else {
    color = popScene(p, vUv, t);
  }

  float lyricQuiet = smoothstep(.08, .52, length(p * vec2(.78, 1.35)));
  color *= mix(.64, 1., lyricQuiet);
  color *= 1.45 + uBands.w * .62 + uInstrumental * .22;
  color = color / (.72 + color);
  float vignette = smoothstep(1.1, .24, length(p * vec2(.72, 1.)));
  color *= .48 + vignette * .52;
  fragColor = vec4(color, .98);
}`;

const GENRE_INDEX: Record<StageFrame['genre'], number> = {
  pop: 0,
  rock: 1,
  reggaeton: 2,
  folk: 3,
  disco: 4,
  electronic: 5,
};

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[Karaoke VFX] Shader compilation failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function parseColor(value: string): [number, number, number] {
  const normalized = value.trim().replace('#', '');
  const hex = normalized.length === 3
    ? normalized.split('').map(character => character + character).join('')
    : normalized.slice(0, 6);
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed)) return [1, 1, 1];
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  ];
}

export function createStageGlRenderer(canvas: HTMLCanvasElement): StageGlRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[Karaoke VFX] Program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, 'uResolution');
  const time = gl.getUniformLocation(program, 'uTime');
  const primary = gl.getUniformLocation(program, 'uPrimary');
  const secondary = gl.getUniformLocation(program, 'uSecondary');
  const accent = gl.getUniformLocation(program, 'uAccent');
  const bands = gl.getUniformLocation(program, 'uBands');
  const motion = gl.getUniformLocation(program, 'uMotion');
  const instrumental = gl.getUniformLocation(program, 'uInstrumental');
  const genre = gl.getUniformLocation(program, 'uGenre');

  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  return {
    render(frame) {
      const primaryColor = parseColor(frame.palette.primary);
      const secondaryColor = parseColor(frame.palette.secondary);
      const accentColor = parseColor(frame.palette.accent);
      gl.viewport(0, 0, frame.width, frame.height);
      gl.useProgram(program);
      gl.uniform2f(resolution, frame.width, frame.height);
      gl.uniform1f(time, frame.time / 1000);
      gl.uniform3f(primary, ...primaryColor);
      gl.uniform3f(secondary, ...secondaryColor);
      gl.uniform3f(accent, ...accentColor);
      gl.uniform4f(
        bands,
        frame.audio.bass,
        frame.audio.mid,
        frame.audio.treble,
        frame.audio.level,
      );
      gl.uniform4f(
        motion,
        frame.audio.vocal,
        frame.audio.pitch,
        frame.audio.beat,
        frame.audio.hit,
      );
      gl.uniform1f(instrumental, frame.audio.instrumental);
      gl.uniform1i(genre, GENRE_INDEX[frame.genre]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
