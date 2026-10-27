import {
  Mesh, ShaderMaterial, SphereGeometry, Color, Vector3, Group, BackSide,
  AdditiveBlending, DoubleSide, TorusGeometry, RingGeometry, Sprite, SpriteMaterial,
  CanvasTexture, SRGBColorSpace,
} from 'three';
import type { Body } from '../game/bodies';
import { makeGlowTexture } from './toon';

const vert = [
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'varying vec3 vLocal;',
  'varying vec3 vNormalW;',
  'varying vec3 vWorld;',
  'void main() {',
  '  vLocal = normalize(position);',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWorld = wp.xyz;',
  '  vNormalW = normalize(mat3(modelMatrix) * normal);',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '  #include <logdepthbuf_vertex>',
  '}',
].join('\n');

const frag = [
  '#include <logdepthbuf_pars_fragment>',
  'uniform vec3 uPrimary;',
  'uniform vec3 uSecondary;',
  'uniform vec3 uAccent;',
  'uniform vec3 uOcean;',
  'uniform vec3 uIce;',
  'uniform vec3 uSunDir;',
  'uniform float uSeed;',
  'uniform float uTime;',
  'uniform float uSun;',
  'uniform float uGas;',
  'uniform float uAtmo;',
  'varying vec3 vLocal;',
  'varying vec3 vNormalW;',
  'varying vec3 vWorld;',
  '',
  'float hash3(vec3 p) {',
  '  p = fract(p * 0.1031);',
  '  p += dot(p, p.yzx + 33.33);',
  '  return fract((p.x + p.y) * p.z);',
  '}',
  'float noise3(vec3 p) {',
  '  vec3 i = floor(p); vec3 f = fract(p);',
  '  f = f*f*(3.0-2.0*f);',
  '  float n000=hash3(i), n100=hash3(i+vec3(1,0,0)), n010=hash3(i+vec3(0,1,0)), n110=hash3(i+vec3(1,1,0));',
  '  float n001=hash3(i+vec3(0,0,1)), n101=hash3(i+vec3(1,0,1)), n011=hash3(i+vec3(0,1,1)), n111=hash3(i+vec3(1,1,1));',
  '  float nx00=mix(n000,n100,f.x), nx10=mix(n010,n110,f.x);',
  '  float nx01=mix(n001,n101,f.x), nx11=mix(n011,n111,f.x);',
  '  return mix(mix(nx00,nx10,f.y), mix(nx01,nx11,f.y), f.z);',
  '}',
  'float fbm3(vec3 p) {',
  '  float v=0.0, a=0.5;',
  '  for(int i=0;i<5;i++){ v+=a*noise3(p); p*=2.07; a*=0.5; }',
  '  return v;',
  '}',
  '',
  'void main() {',
  '  vec3 p = normalize(vLocal);',
  '  vec3 N = normalize(vNormalW);',
  '  float ndl = dot(N, uSunDir);',
  '  float b0 = smoothstep(-0.15, 0.0, ndl);',
  '  float b1 = smoothstep(0.18, 0.3, ndl);',
  '  float b2 = smoothstep(0.6, 0.72, ndl);',
  '  float light = b0*0.38 + b1*0.34 + b2*0.28;',
  '  float seaLevel = 0.0;',
  '  vec3 surf;',
  '  float spec = 0.0;',
  '  if (uSun > 0.5) {',
  '    float n = fbm3(p*4.0 + uSeed);',
  '    float flick = 0.92 + 0.08*sin(uTime*0.1 + p.y*12.0);',
  '    surf = mix(uAccent, uPrimary, smoothstep(0.25,0.7,n)) * flick;',
  '    surf += vec3(1.0,0.9,0.55) * smoothstep(0.6,0.8,n) * 0.25;',
  '    float limb = pow(1.0 - abs(dot(N, normalize(cameraPosition - vWorld))), 2.0);',
  '    surf += vec3(1.0,0.6,0.2) * limb * 0.35;',
  '  } else if (uGas > 0.5) {',
  '    float band = sin(p.y*17.0 + fbm3(p*3.0 + uSeed)*3.0 + sin(p.x*4.0)*0.5);',
  '    float band2 = sin(p.y*29.0 - p.x*6.0 + fbm3(p*5.0)*2.0);',
  '    surf = mix(uSecondary, uPrimary, smoothstep(-0.4,0.5,band));',
  '    surf = mix(surf, uAccent, smoothstep(0.3,0.9,band2)*0.32);',
  '    surf = mix(surf, uIce, smoothstep(0.86,0.98,abs(p.y))*0.6);',
  '  } else {',
  '    float n = fbm3(p*3.1 + uSeed);',
  '    float n2 = fbm3(p*7.0 - uSeed*0.3);',
  '    float launchLand = exp(-pow(acos(clamp(dot(p, vec3(1.0,0.0,0.0)), -1.0, 1.0)) / 0.30, 2.0));',
  '    float cont = smoothstep(0.43, 0.52, n + n2*0.14 + launchLand*0.14);',
  '    float detail = smoothstep(0.55, 0.72, n2);',
  '    surf = mix(uOcean, uPrimary, cont);',
  '    surf = mix(surf, uSecondary, cont*detail*0.65);',
  '    surf = mix(surf, uAccent, cont * smoothstep(0.62,0.82,n) * 0.5);',
  '    float ice = smoothstep(0.79, 0.92, abs(p.y) + (n2-0.5)*0.12);',
  '    surf = mix(surf, uIce, ice);',
  '    seaLevel = 1.0 - cont;',
  '    vec3 H = normalize(uSunDir + normalize(cameraPosition - vWorld));',
  '    spec = pow(max(dot(N,H),0.0), 55.0) * seaLevel * 0.8;',
  '  }',
  '  vec3 col = mix(surf * 0.55, surf, light);',
  '  col += uPrimary * 0.06;',
  '  col += vec3(1.0,0.95,0.82) * spec;',
  '  float rim = pow(1.0 - clamp(dot(N, normalize(cameraPosition - vWorld)),0.0,1.0), 3.0);',
  '  col += mix(uIce, vec3(0.6,0.85,1.0), 0.4) * rim * 0.28 * uAtmo;',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <logdepthbuf_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

const cloudFrag = [
  '#include <logdepthbuf_pars_fragment>',
  'uniform float uTime;',
  'uniform vec3 uSunDir;',
  'uniform float uSeed;',
  'uniform vec3 uCloud;',
  'varying vec3 vLocal;',
  'varying vec3 vNormalW;',
  'varying vec3 vWorld;',
  'float hash3(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }',
  'float noise3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);',
  '  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));',
  '  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));',
  '  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z); }',
  'float fbm3(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise3(p);p*=2.1;a*=0.5;} return v; }',
  'void main(){',
  '  vec3 p=normalize(vLocal);',
  '  float n=fbm3(p*4.2 + vec3(uTime*0.0012,0.0,uSeed));',
  '  float a=smoothstep(0.47,0.64,n);',
  '  float ndl=dot(normalize(vNormalW),uSunDir);',
  '  float lit=smoothstep(-0.1,0.25,ndl)*0.5+0.5;',
  '  vec3 col=mix(uCloud*0.55,uCloud,lit);',
  '  col += vec3(1.0,0.95,0.8)*pow(max(ndl,0.0),8.0)*0.12;',
  '  gl_FragColor=vec4(col, a*0.72);',
  '  #include <logdepthbuf_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

const atmoFrag = [
  '#include <logdepthbuf_pars_fragment>',
  'uniform vec3 uColor;',
  'uniform vec3 uSunDir;',
  'varying vec3 vNormalW;',
  'varying vec3 vWorld;',
  'void main(){',
  '  vec3 N=normalize(vNormalW);',
  '  vec3 V=normalize(cameraPosition-vWorld);',
  '  float fres=pow(1.0-clamp(abs(dot(N,V)),0.0,1.0),2.5);',
  '  float sun=max(dot(N,uSunDir),0.0);',
  '  float a=fres*(0.35+sun*0.65);',
  '  gl_FragColor=vec4(uColor, a);',
  '  #include <logdepthbuf_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

export class PlanetView {
  body: Body;
  group = new Group();
  surface: Mesh;
  clouds: Mesh | null = null;
  atmosphere: Mesh | null = null;
  ring: Mesh | null = null;
  glow: Sprite | null = null;
  private surfaceMat: ShaderMaterial;
  private cloudMat: ShaderMaterial | null = null;
  private atmoMat: ShaderMaterial | null = null;
  private scale = 1;
  private distance = 0;

  constructor(body: Body) {
    this.body = body;
    const seg = body.id === 'sol' ? 64 : (body.id === 'verdant' ? 96 : 128);
    const geo = new SphereGeometry(body.radius, seg, seg / 2);
    const c = body.appearance;
    this.surfaceMat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uPrimary: { value: new Color(c.primary) },
        uSecondary: { value: new Color(c.secondary) },
        uAccent: { value: new Color(c.accent) },
        uOcean: { value: new Color(c.ocean) },
        uIce: { value: new Color(c.ice) },
        uSunDir: { value: new Vector3(0.5, 0.8, 0.2) },
        uSeed: { value: (body.terrainSeed % 97) * 0.37 },
        uTime: { value: 0 },
        uSun: { value: body.id === 'sol' ? 1 : 0 },
        uGas: { value: body.id === 'verdant' ? 1 : 0 },
        uAtmo: { value: body.atmosphere ? 1 : 0.25 },
      },
    });
    this.surface = new Mesh(geo, this.surfaceMat);
    this.surface.rotation.y = 0;
    this.group.add(this.surface);

    if (body.atmosphere && body.id !== 'sol') {
      const cloudGeo = new SphereGeometry(body.radius * 1.008, seg, seg / 2);
      this.cloudMat = new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: cloudFrag,
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: new Vector3(0.5, 0.8, 0.2) },
          uSeed: { value: (body.terrainSeed % 53) * 0.7 },
          uCloud: { value: new Color(c.cloud) },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      this.clouds = new Mesh(cloudGeo, this.cloudMat);
      this.clouds.rotation.y = 1.1;
      this.group.add(this.clouds);

      const atmoGeo = new SphereGeometry(body.radius * 1.035, 64, 32);
      this.atmoMat = new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: atmoFrag,
        uniforms: {
          uColor: { value: new Color(c.atmosphere) },
          uSunDir: { value: new Vector3(0.5, 0.8, 0.2) },
        },
        transparent: true,
        depthWrite: false,
        side: BackSide,
        blending: AdditiveBlending,
      });
      this.atmosphere = new Mesh(atmoGeo, this.atmoMat);
      this.group.add(this.atmosphere);
    }

    if (body.id === 'verdant') {
      const ringGeo = new RingGeometry(body.radius * 1.35, body.radius * 2.2, 96);
      const ringMat = new ShaderMaterial({
        vertexShader: vert,
        fragmentShader: [
          'varying vec3 vLocal;',
          'varying vec3 vWorld;',
          'uniform vec3 uColor;',
          'void main(){',
          ' float r = length(vLocal.xy);',
          ' float a = 0.5 + 0.5*sin(r*180.0);',
          ' gl_FragColor = vec4(uColor, a*0.35);',
          '}',
        ].join('\n'),
        uniforms: { uColor: { value: new Color(c.accent) } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      this.ring = new Mesh(ringGeo, ringMat);
      this.ring.rotation.x = Math.PI * 0.52;
      this.group.add(this.ring);
    }

    if (body.id === 'sol') {
      const tex = makeGlowTexture('rgba(255,244,190,1)', 'rgba(255,160,50,0)');
      this.glow = new Sprite(new SpriteMaterial({ map: tex, color: new Color(0xffd36e), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
      this.glow.scale.setScalar(body.radius * 7);
      this.group.add(this.glow);
    }
  }

  update(shipPos: Vector3, sunDir: Vector3, t: number, cameraDist: number, nearAltitude: number): void {
    const bs = this.body.globalState(t);
    const rel = bs.pos.clone().sub(shipPos);
    const dist = rel.length();
    this.distance = dist;
    const maxRender = 5.2e7;
    const s = dist > maxRender ? maxRender / dist : 1;
    this.scale = s;
    this.group.position.copy(rel).multiplyScalar(s);
    this.group.scale.setScalar(s);
    this.surface.rotation.y = this.body.rotationAngle(t);
    this.surfaceMat.uniforms.uSunDir.value.copy(sunDir);
    this.surfaceMat.uniforms.uTime.value = t;
    if (this.clouds && this.cloudMat) {
      this.clouds.rotation.y = this.body.rotationAngle(t) * 1.06 + 0.8;
      this.cloudMat.uniforms.uTime.value = t;
      this.cloudMat.uniforms.uSunDir.value.copy(sunDir);
      this.clouds.visible = nearAltitude > 45000;
    }
    if (this.atmosphere && this.atmoMat) {
      this.atmoMat.uniforms.uSunDir.value.copy(sunDir);
      this.atmosphere.visible = nearAltitude > 8000;
    }
    if (this.glow) {
      this.glow.material.opacity = 0.85;
    }
    // The surface sphere is hidden when the local terrain patch is doing the work.
    const hideSurface = this.body.id !== 'sol' && nearAltitude < 2500 && this.distance < this.body.radius * 1.2;
    this.surface.visible = !hideSurface;
    if (this.clouds) this.clouds.visible = this.clouds.visible && !hideSurface;
  }

  get scaleFactor(): number {
    return this.scale;
  }
}

export class PlanetSystem {
  views = new Map<string, PlanetView>();
  group = new Group();

  constructor(bodies: Body[]) {
    for (const b of bodies) {
      const v = new PlanetView(b);
      this.views.set(b.id, v);
      this.group.add(v.group);
    }
  }
}
