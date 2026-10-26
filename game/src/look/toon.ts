import {
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The cartoon look, adapted from D:\dnf\client\src\three\ink.ts: flat bands of light instead of
// smooth shading (a toon ramp), and a thick line round every silhouette drawn as the body's own
// mesh pushed out along its normals and shown from the back (the inverted hull). dnf's ink wash
// became bright flat colour here: the ramp is lighter and the shade is tinted by a sky-blue
// hemisphere light instead of going grey, and the one hard shadow comes from the sun.

export const INK = 0x1b2333;

/** Light in three bands: shade, half, lit. Lighter than dnf's ink ramp so colours stay bright. */
function ramp(): DataTexture {
  const t = new DataTexture(new Uint8Array([105, 190, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const RAMP = ramp();

/** RAMP's lookup with its two steps smoothed over a pixel on screen (ink.ts), so the band edges
 * do not crawl on curved surfaces as the camera orbits. */
const RAMP_AA = /* glsl */ `
uniform sampler2D gradientMap;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float x = dot( normal, lightDirection ) * 0.5 + 0.5;
  float fw = max( fwidth( x ), 1e-4 );
  float lo = texture2D( gradientMap, vec2( 1.0 / 6.0, 0.0 ) ).r;
  float mid = texture2D( gradientMap, vec2( 0.5, 0.0 ) ).r;
  float hi = texture2D( gradientMap, vec2( 5.0 / 6.0, 0.0 ) ).r;
  float a = smoothstep( 0.42 - fw, 0.42 + fw, x );
  float b = smoothstep( 0.62 - fw, 0.62 + fw, x );
  return vec3( mix( mix( lo, mid, a ), hi, b ) );
}
`;

function smoothRamp(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <gradientmap_pars_fragment>', RAMP_AA);
}

/** Hard sun glints and a bright rim, for ice: a Blinn highlight cut to a flat white spot, and
 * the edges facing away from the camera lifted towards white (a frosted, see-through edge). */
const GLINT = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  vec3 V = normalize( vViewPosition );
  vec3 H = normalize( directionalLights[ 0 ].direction + V );
  float s = pow( max( dot( normal, H ), 0.0 ), 90.0 );
  outgoingLight += vec3( 1.0 ) * smoothstep( 0.45, 0.55, s ) * 0.9;
  float rim = 1.0 - max( dot( normal, V ), 0.0 );
  outgoingLight = mix( outgoingLight, vec3( 0.93, 0.99, 1.0 ), smoothstep( 0.55, 0.85, rim ) * 0.55 );
  diffuseColor.a = mix( diffuseColor.a, 1.0, smoothstep( 0.4, 0.9, rim ) );
}
#endif
#include <opaque_fragment>
`;

export interface ToonOptions {
  color?: number;
  map?: Texture | null;
  vertexColors?: boolean;
  /** Ice: hard glints, a frosted rim and see-through faces. */
  glint?: boolean;
  opacity?: number;
}

export function toonMaterial(o: ToonOptions = {}): MeshToonMaterial {
  const m = new MeshToonMaterial({
    color: new Color(o.color ?? 0xffffff),
    map: o.map ?? null,
    gradientMap: RAMP,
    vertexColors: !!o.vertexColors,
  });
  if (o.opacity !== undefined && o.opacity < 1) {
    m.transparent = true;
    m.opacity = o.opacity;
  }
  const glint = !!o.glint;
  m.onBeforeCompile = (shader) => {
    smoothRamp(shader);
    if (glint) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', GLINT);
  };
  m.customProgramCacheKey = () => (glint ? 'toon-glint' : 'toon');
  return m;
}

/** The outline: the hull pushed out `width` (mesh units) along its normals, drawn from the back.
 * The push happens before the instance matrix, so one material serves instanced blocks too. */
export function outlineMaterial(width: number, color = INK): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color, side: BackSide });
  m.userData.width = { value: width };
  m.onBeforeCompile = function (this: Material, shader) {
    shader.uniforms.outline = this.userData.width;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float outline;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize( normal ) * outline;');
  };
  m.customProgramCacheKey = () => 'outline';
  return m;
}

/** A copy of `g` for the hull: positions only, welded so that every hard edge (a box's corner, a
 * cylinder's rim) gets one averaged normal and the pushed-out faces stay joined instead of
 * splitting apart and leaving gaps in the line. */
export function hullGeometry(g: BufferGeometry): BufferGeometry {
  const p = new BufferGeometry();
  p.setAttribute('position', g.getAttribute('position').clone());
  if (g.index) p.setIndex(g.index.clone());
  const w = mergeVertices(p, 1e-4);
  w.computeVertexNormals();
  return w;
}

/** Paints every vertex of `g` one colour (for merged, vertex-coloured batches). */
export function paint(g: BufferGeometry, color: number): BufferGeometry {
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
}
