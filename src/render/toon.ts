import {
  Color, Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry,
  Vector3, AdditiveBlending, CanvasTexture, SRGBColorSpace, BackSide, FrontSide,
} from 'three';
import type { Side } from 'three';

export const PALETTE = {
  cream: 0xfff4dc,
  paper: 0xfffbf0,
  ink: 0x3c2f2b,
  coral: 0xff806a,
  coralDark: 0xe2675c,
  orange: 0xffb13c,
  teal: 0x54c8c2,
  tealDark: 0x2f9e9e,
  mint: 0xaae8c1,
  green: 0x63c97a,
  sky: 0x9edcff,
  skyDeep: 0x4fa8e8,
  lavender: 0xc8b6f0,
  plum: 0x77658f,
  yellow: 0xffe27a,
  metal: 0xc9d3dc,
  metalDark: 0x7f8f9e,
  glass: 0x8fe6e0,
  shadow: 0x3a2f39,
  white: 0xffffff,
  grey: 0xb9c2c9,
};

export const glowUniforms = {
  uSunDir: { value: new Vector3(0.55, 0.78, 0.3).normalize() },
  uTime: { value: 0 },
  uAmbient: { value: new Color(0xb7c4df) },
  uFogColor: { value: new Color(0xb9e8f5) },
  uFogNear: { value: 9000 },
  uFogFar: { value: 42000 },
};

export interface ToonOptions {
  color?: number;
  shade?: number;
  rim?: number;
  rimColor?: number;
  spec?: number;
  specColor?: number;
  opacity?: number;
  transparent?: boolean;
  side?: Side;
  vertexColors?: boolean;
  map?: CanvasTexture | null;
  emissive?: number;
  fog?: boolean;
  outline?: boolean;
  outlineColor?: number;
  outlineScale?: number;
  flatShading?: boolean;
}

const VERT = [
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'varying vec3 vNormalW;',
  'varying vec3 vViewW;',
  'varying vec3 vWorld;',
  'varying vec2 vUv;',
  'varying vec3 vColorV;',
  'void main() {',
  '  vUv = uv;',
  '  vColorV = vec3(1.0);',
  '  #ifdef USE_COLOR',
  '    vColorV = color;',
  '  #endif',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWorld = wp.xyz;',
  '  vNormalW = normalize(mat3(modelMatrix) * normal);',
  '  vViewW = cameraPosition - wp.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '  #include <logdepthbuf_vertex>',
  '}',
].join('\n');

const FRAG = [
  '#include <logdepthbuf_pars_fragment>',
  'uniform vec3 uColor;',
  'uniform vec3 uShade;',
  'uniform vec3 uRimColor;',
  'uniform float uRim;',
  'uniform float uSpec;',
  'uniform vec3 uSpecColor;',
  'uniform float uOpacity;',
  'uniform vec3 uSunDir;',
  'uniform vec3 uAmbient;',
  'uniform vec3 uFogColor;',
  'uniform float uFogNear;',
  'uniform float uFogFar;',
  'uniform float uUseFog;',
  'uniform float uUseMap;',
  'uniform sampler2D uMap;',
  'uniform float uEmissive;',
  'varying vec3 vNormalW;',
  'varying vec3 vViewW;',
  'varying vec3 vWorld;',
  'varying vec2 vUv;',
  'varying vec3 vColorV;',
  'void main() {',
  '  vec3 N = normalize(vNormalW);',
  '  vec3 V = normalize(vViewW);',
  '  float ndl = dot(N, uSunDir);',
  '  float band0 = smoothstep(-0.18, -0.02, ndl);',
  '  float band1 = smoothstep(0.18, 0.32, ndl);',
  '  float band2 = smoothstep(0.58, 0.72, ndl);',
  '  float light = band0 * 0.38 + band1 * 0.34 + band2 * 0.28;',
  '  vec3 base = uColor * vColorV;',
  '  if (uUseMap > 0.5) base *= texture2D(uMap, vUv).rgb;',
  '  vec3 shadeCol = mix(base * 0.70, uShade, 0.24);',
  '  vec3 col = mix(shadeCol, base, light);',
  '  col += uAmbient * base * 0.16;',
  '  float fill = smoothstep(-0.15, 0.75, dot(N, V));',
  '  col += base * fill * 0.20;',
  '  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4) * uRim;',
  '  col += uRimColor * rim;',
  '  vec3 H = normalize(uSunDir + V);',
  '  float s = pow(max(dot(N, H), 0.0), 42.0) * uSpec;',
  '  s = floor(s * 5.0) / 5.0;',
  '  col += uSpecColor * s;',
  '  col += uColor * uEmissive;',
  '  float dist = distance(cameraPosition, vWorld);',
  '  float fog = smoothstep(uFogNear, uFogFar, dist) * uUseFog;',
  '  col = mix(col, uFogColor, fog);',
  '  gl_FragColor = vec4(col, uOpacity);',
  '  #include <logdepthbuf_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

export function createToonMaterial(opts: ToonOptions = {}): ShaderMaterial {
  const mat = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(opts.color ?? PALETTE.cream) },
      uShade: { value: new Color(opts.shade ?? 0xb9aecb) },
      uRimColor: { value: new Color(opts.rimColor ?? 0xffe9c9) },
      uRim: { value: opts.rim ?? 0.22 },
      uSpec: { value: opts.spec ?? 0.0 },
      uSpecColor: { value: new Color(opts.specColor ?? 0xffffff) },
      uOpacity: { value: opts.opacity ?? 1 },
      uSunDir: glowUniforms.uSunDir,
      uAmbient: glowUniforms.uAmbient,
      uFogColor: glowUniforms.uFogColor,
      uFogNear: glowUniforms.uFogNear,
      uFogFar: glowUniforms.uFogFar,
      uUseFog: { value: opts.fog ? 1 : 0 },
      uUseMap: { value: opts.map ? 1 : 0 },
      uMap: { value: opts.map ?? null },
      uEmissive: { value: opts.emissive ?? 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: !!opts.vertexColors,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? FrontSide,
    depthWrite: !opts.transparent,
  });
  return mat;
}

export function addOutline(mesh: Mesh, scale = 1.008, color = PALETTE.shadow): Mesh {
  const geo = mesh.geometry.clone();
  const mat = new MeshBasicMaterial({ color, side: BackSide });
  const outline = new Mesh(geo, mat);
  outline.scale.setScalar(scale);
  outline.renderOrder = -1;
  mesh.add(outline);
  return mesh;
}

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function makeSoftDiscTexture(color = 'rgba(255,255,255,1)', edge = 'rgba(255,255,255,0)'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  g.addColorStop(0, color);
  g.addColorStop(0.62, color);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function makeDecalTexture(text: string, accent = '#FF806A'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = accent;
  ctx.font = '800 76px "Baloo 2", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 118);
  ctx.fillStyle = '#3C2F2B';
  ctx.font = '700 28px "Nunito", sans-serif';
  ctx.fillText('CAT SPACE AGENCY', 256, 170);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(256, 212, 22, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.8 + i * 0.36;
    ctx.beginPath();
    ctx.ellipse(256 + Math.cos(a) * 31, 212 + Math.sin(a) * 24, 7, 9, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { AdditiveBlending, SphereGeometry };
