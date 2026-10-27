import {
  ShaderMaterial, Mesh, BufferGeometry, Float32BufferAttribute, Matrix4,
  Vector3, Color, OrthographicCamera, Scene, BackSide,
} from 'three';

const vert = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4(position.xy, 0.99999, 1.0);',
  '}',
].join('\n');

const frag = [
  'uniform mat4 uProjInv;',
  'uniform mat4 uCamWorld;',
  'uniform vec3 uSunDir;',
  'uniform vec3 uUp;',
  'uniform float uAtmo;',
  'uniform float uTime;',
  'uniform float uDusk;',
  'uniform vec3 uHorizon;',
  'uniform vec3 uZenith;',
  'uniform vec3 uSpace;',
  'varying vec2 vUv;',
  '',
  'float hash(vec3 p) {',
  '  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));',
  '  p *= 17.0;',
  '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
  '}',
  'float hash2(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);',
  '}',
  'float noise2(vec2 p) {',
  '  vec2 i = floor(p); vec2 f = fract(p);',
  '  f = f*f*(3.0-2.0*f);',
  '  float a = hash2(i); float b = hash2(i+vec2(1.0,0.0));',
  '  float c = hash2(i+vec2(0.0,1.0)); float d = hash2(i+vec2(1.0,1.0));',
  '  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);',
  '}',
  'float fbm(vec2 p) {',
  '  float v = 0.0; float a = 0.5;',
  '  for (int i=0;i<5;i++) { v += a*noise2(p); p*=2.03; a*=0.5; }',
  '  return v;',
  '}',
  '',
  'void main() {',
  '  vec2 ndc = vUv * 2.0 - 1.0;',
  '  vec4 view = uProjInv * vec4(ndc, 1.0, 1.0);',
  '  vec3 vdir = normalize(view.xyz / view.w);',
  '  vec3 dir = normalize(mat3(uCamWorld) * vdir);',
  '  vec3 up = normalize(uUp);',
  '  float y = clamp(dot(dir, up), -1.0, 1.0);',
  '  float h = pow(1.0 - clamp(y, 0.0, 1.0), 10.0);',
  '  vec3 day = mix(uZenith, uHorizon, h);',
  '  float sunDot = max(dot(dir, uSunDir), 0.0);',
  '  vec3 sunWarm = vec3(1.0, 0.62, 0.32);',
  '  day += sunWarm * pow(sunDot, 22.0) * 0.45 * uAtmo;',
  '  day += vec3(1.0, 0.84, 0.55) * pow(sunDot, 5.0) * 0.18 * uAtmo;',
  '  float dusk = uDusk * smoothstep(0.02, 0.6, h) * smoothstep(-0.1, 0.5, sunDot);',
  '  day = mix(day, vec3(1.0, 0.58, 0.38), dusk * 0.35);',
  '',
  '  // clouds',
  '  vec3 east = normalize(cross(vec3(0.0,1.0,0.0), up) + vec3(0.001,0.0,0.0));',
  '  vec3 north = cross(up, east);',
  '  vec2 cloudUv = vec2(dot(dir,east), dot(dir,north)) / (abs(y) + 0.28) * 0.75 + vec2(uTime * 0.0009, uTime * 0.0004);',
  '  float cloud = fbm(cloudUv * 1.4);',
  '  cloud = smoothstep(0.54, 0.72, cloud);',
  '  cloud *= smoothstep(-0.03, 0.12, y) * uAtmo;',
  '  day = mix(day, vec3(1.0, 0.99, 0.96), cloud * 0.72);',
  '',
  '  // stars',
  '  float star = 0.0;',
  '  vec3 sd = dir * 350.0;',
  '  float s1 = hash(floor(sd));',
  '  if (s1 > 0.975) star += smoothstep(0.975, 1.0, s1) * 1.8;',
  '  vec3 sd2 = dir * 820.0 + 13.0;',
  '  float s2 = hash(floor(sd2));',
  '  if (s2 > 0.988) star += smoothstep(0.988, 1.0, s2) * 1.1;',
  '  float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + s1 * 30.0);',
  '  vec3 starCol = mix(vec3(0.72,0.82,1.0), vec3(1.0,0.88,0.7), hash(floor(sd * 0.3))) * star * twinkle;',
  '',
  '  float spaceMix = 1.0 - smoothstep(0.0, 1.0, uAtmo);',
  '  vec3 space = uSpace + starCol * (0.25 + spaceMix * 0.9);',
  '  vec3 col = mix(space, day, uAtmo);',
  '',
  '  // sun disk',
  '  float cosSun = dot(dir, uSunDir);',
  '  float disk = smoothstep(0.99965, 0.99985, cosSun);',
  '  float glow = pow(max(cosSun, 0.0), 180.0);',
  '  col += vec3(1.0, 0.92, 0.7) * disk * 1.6;',
  '  col += vec3(1.0, 0.66, 0.32) * glow * 0.55;',
  '',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

export interface SkyState {
  atmo: number;
  sunDir: Vector3;
  up: Vector3;
  time: number;
  dusk: number;
  horizon: Color;
  zenith: Color;
  space: Color;
}

export class SkyDome {
  scene = new Scene();
  camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  material: ShaderMaterial;
  mesh: Mesh;
  state: SkyState = {
    atmo: 1,
    sunDir: new Vector3(0.5, 0.8, 0.2).normalize(),
    up: new Vector3(0, 1, 0),
    time: 0,
    dusk: 0,
    horizon: new Color(0xb9ecff),
    zenith: new Color(0x5aaee6),
    space: new Color(0x0a1024),
  };

  constructor() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uProjInv: { value: new Matrix4() },
        uCamWorld: { value: new Matrix4() },
        uSunDir: { value: new Vector3(0.5, 0.8, 0.2) },
        uUp: { value: new Vector3(0, 1, 0) },
        uAtmo: { value: 1 },
        uTime: { value: 0 },
        uDusk: { value: 0 },
        uHorizon: { value: new Color(0xb9ecff) },
        uZenith: { value: new Color(0x5aaee6) },
        uSpace: { value: new Color(0x0a1024) },
      },
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  set(state: Partial<SkyState>): void {
    Object.assign(this.state, state);
    const u = this.material.uniforms;
    u.uSunDir.value.copy(this.state.sunDir);
    u.uUp.value.copy(this.state.up);
    u.uAtmo.value = this.state.atmo;
    u.uTime.value = this.state.time;
    u.uDusk.value = this.state.dusk;
    u.uHorizon.value.copy(this.state.horizon);
    u.uZenith.value.copy(this.state.zenith);
    u.uSpace.value.copy(this.state.space);
  }

  updateCamera(camera: { projectionMatrix: Matrix4; matrixWorld: Matrix4 }): void {
    this.material.uniforms.uProjInv.value.copy(camera.projectionMatrix).invert();
    this.material.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  }
}

export function skyForAltitude(body: { atmosphere: { height: number; color: number } | null }, altitude: number): { atmo: number; horizon: Color; zenith: Color; space: Color; dusk: number } {
  if (!body.atmosphere) {
    return { atmo: 0, horizon: new Color(0x1a2038), zenith: new Color(0x070b16), space: new Color(0x05070f), dusk: 0 };
  }
  const a = Math.max(0, Math.min(1, 1 - altitude / (body.atmosphere.height * 1.05)));
  const t = Math.pow(a, 0.7);
  return {
    atmo: t,
    horizon: new Color(0xb9ecff).lerp(new Color(0x26365f), 1 - t),
    zenith: new Color(0x4d9fe0).lerp(new Color(0x070b1a), 1 - t),
    space: new Color(0x05070f),
    dusk: Math.max(0, 1 - altitude / 6000) * 0.25,
  };
}
