// 轉卡機的卡片：圓角薄片（正面、背面各一張貼圖）＋白色卡邊（toon 描邊由 machine.js 加）
// 閃卡 shader：uMode 0＝一般、1＝金箔（一道金光掃過）、2＝彩虹（隨角度、時間流動的七彩）
import * as THREE from 'three';

export const CARD_W = 0.19; // 公尺（剛好塞進出卡口 0.209 寬的細縫）
export const CARD_H = CARD_W / 0.686; // 卡片 59 × 86 mm 的比例
export const CARD_D = 0.007; // 厚一點：斜的時候看得到卡邊（使用者 2026-10-25：「把卡牌的立體感加強」）

const live = new Set(); // 畫面上卡片的材質（每格更新 uTime）

let faceGeo = null;
let edgeGeo = null;
function geos() {
  if (faceGeo) return;
  const w = CARD_W;
  const h = CARD_H;
  const r = 0.012;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  faceGeo = new THREE.ShapeGeometry(s, 6);
  const pos = faceGeo.attributes.position;
  const uv = faceGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  edgeGeo = new THREE.ExtrudeGeometry(s, { depth: CARD_D, bevelEnabled: false, curveSegments: 6 });
  edgeGeo.translate(0, 0, -CARD_D / 2);
}

const VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vVo;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vVo = (inverse(modelMatrix) * vec4(cameraPosition, 1.)).xyz - position; // 卡片自己的座標裡，看過來的方向（卡面法線＝+Z）
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = `uniform sampler2D map; uniform float uMode; uniform float uTime; uniform float uWhite; uniform float uOpacity; uniform float uSil;
uniform sampler2D photo; uniform sampler2D bgPhoto; uniform sampler2D depthMap; uniform sampler2D overMap; uniform float uLayered; uniform vec4 uWin; uniform float uDepth;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vVo;
// 圖片的深度：0.85＝背景退到卡面後面、−0.5＝主體浮到卡面前面（像 iPhone 空間照片的主體往前跳）
float hgt(vec2 w) { return 0.85 - 1.35 * texture2D(depthMap, w).r; }
// 沿著視線往卡片裡面走（視差遮擋）：從最前面（−0.5）走到最後面（0.85），第一次走到「表面底下」的地方就是看到的點
//   之前只逼近三次，主體邊緣斜著看會有一條背景色的帶子；一步一步走＋最後一段內插就不會
vec3 march(vec2 z, vec2 d) {
  float pt = -0.5;
  float pd = pt - hgt(z - d * pt);
  if (pd >= 0.) return vec3(z - d * pt, pt);
  for (int i = 1; i <= 24; i++) {
    float t = -0.5 + 1.35 * float(i) / 24.;
    float dd = t - hgt(z - d * t);
    if (dd >= 0.) {
      float tt = mix(pt, t, pd / (pd - dd));
      return vec3(z - d * tt, tt);
    }
    pt = t;
    pd = dd;
  }
  return vec3(z - d * 0.85, 0.85);
}
void main(){
  vec4 c = texture2D(map, vUv);
  vec3 col;
  vec3 V = normalize(vVo);
  vec2 par = V.xy / max(V.z, 0.3); // 卡片斜多少（看過來的方向在卡面上的分量）
  vec2 span = uWin.zw - uWin.xy;
  vec2 w = (vUv - uWin.xy) / span;
  bool inWin = uLayered > 0.5 && w.x > 0. && w.x < 1. && w.y > 0. && w.y < 1.;
  // 最上層：稀有度章、星星、名字帶（浮在卡面上方，跟著反方向位移）
  vec4 ov = uLayered > 0.5 ? texture2D(overMap, vUv + par * 0.018) : vec4(0.);
  if (ov.a > 0.5) col = ov.rgb;
  else {
    // 主體跑出框：框的地方，如果主體位移過來、而且是「前面」的東西，就畫在框上面
    // 圖片放大 1.16 倍（斜著看邊緣也不露底）：深度圖、照片都用同一個放大後的座標，主體跟它的深度才對得齊
    float k = uDepth / 1.16;
    vec2 z = (w - 0.5) / 1.16 + 0.5;
    bool want = uLayered > 0.5 && ((inWin && c.a < 0.5) || (c.a >= 0.5 && z.x > -0.3 && z.x < 1.3 && z.y > -0.3 && z.y < 1.3));
    vec3 hit = want ? march(z, par * k) : vec3(0., 0., 1.);
    bool pop = want && c.a >= 0.5 && hit.z < -0.1 && hit.x > 0. && hit.x < 1. && hit.y > 0. && hit.y < 1.;
    if ((inWin && c.a < 0.5) || pop) {
      // 3D 照片：背景退後、主體浮出
      vec2 p = clamp(hit.xy, 0.002, 0.998);
      // 落在背景 → 用「主體補掉」的背景圖（不然斜的時候背景裡會再看到一次主體的邊）
      col = mix(texture2D(bgPhoto, p).rgb, texture2D(photo, p).rgb, smoothstep(0.4, 0.7, texture2D(depthMap, p).r));
      // 窗框落在圖片上的影子：往卡片斜的方向偏（凹進去的感覺）
      vec2 ws = w + par * 0.035;
      float e = min(min(ws.x, 1. - ws.x), min(ws.y, 1. - ws.y));
      if (!pop) col *= mix(0.55, 1.0, smoothstep(0.0, 0.07, e));
    } else {
      if (c.a < 0.5) discard;
      col = c.rgb;
    }
    // 浮起來的章、名字帶落在卡面上的影子
    if (uLayered > 0.5) col *= 1.0 - 0.38 * texture2D(overMap, vUv + par * 0.018 + vec2(-0.012, 0.016)).a;
  }
  // 卡面的光澤（像護貝過的卡）：一道柔光跟著傾斜滑過去
  float gl = exp(-pow(vUv.x * 0.8 + vUv.y * 0.6 - 0.7 + par.x * 1.1 - par.y * 0.8, 2.) * 60.);
  col += vec3(1.) * gl * 0.13; // 細一點、淡一點，不要把圖洗白
  float tilt = (1. - clamp(abs(dot(vN, vV)), 0., 1.)) * 4.;
  if (uMode > 0.5) {
    float band = pow(0.5 + 0.5 * sin((vUv.x * 1.3 - vUv.y) * 9. + uTime * 1.8 + tilt * 3.), 5.);
    if (uMode > 1.5) {
      vec3 rb = 0.5 + 0.5 * cos(6.2831 * (vUv.x * 0.8 + vUv.y * 1.2 + tilt + uTime * 0.12 + vec3(0., .33, .67)));
      col = mix(col, col * 0.65 + rb * 0.6, 0.3) + rb * band * 0.45;
    } else {
      col += vec3(1., .86, .45) * band * 0.5;
    }
  }
  if (uSil > 0.001) {
    // 剪影：整張變暗、四周亮一圈稀有度色（SSR 彩虹、SR 金、其他藍）
    float d = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
    float rim = smoothstep(0.08, 0.0, d);
    vec3 rc = uMode > 1.5 ? 0.5 + 0.5 * cos(6.2831 * (vUv.y * 1.5 + uTime * 0.5 + vec3(0., .33, .67)))
      : (uMode > 0.5 ? vec3(1., .82, .3) : vec3(.55, .75, 1.));
    col = mix(col, vec3(0.05, 0.06, 0.12) + rc * rim * 1.4, uSil);
  }
  col = mix(col, vec3(1.), uWhite);
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

function faceMat(tex, mode) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex }, uMode: { value: mode }, uTime: { value: 0 }, uWhite: { value: 0 }, uOpacity: { value: 1 }, uSil: { value: 0 },
      photo: { value: null }, bgPhoto: { value: null }, depthMap: { value: null }, overMap: { value: null }, uLayered: { value: 0 }, uWin: { value: new THREE.Vector4() }, uDepth: { value: 0.2 },
    },
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
  });
  live.add(m);
  return m;
}

export function cardTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 一張卡：front／back＝貼圖（back 是共用的，不跟著卡片丟掉）；mode＝閃卡種類
// layers＝{ photo, depth, win:[u0,v0,u1,v1] }：正面的圖片窗做 3D 視差
export function makeCard(frontTex, backTex, frontMode, backMode, edgeMat, layers = null) {
  geos();
  const g = new THREE.Group();
  const fm = faceMat(frontTex, frontMode);
  if (layers) {
    fm.uniforms.photo.value = layers.photo;
    fm.uniforms.bgPhoto.value = layers.bg || layers.photo;
    fm.uniforms.depthMap.value = layers.depth;
    fm.uniforms.overMap.value = layers.over;
    fm.uniforms.uWin.value.set(...layers.win);
    fm.uniforms.uLayered.value = 1;
  }
  const bm = faceMat(backTex, backMode);
  const front = new THREE.Mesh(faceGeo, fm);
  front.position.z = CARD_D / 2 + 0.0003;
  const back = new THREE.Mesh(faceGeo, bm);
  back.rotation.y = Math.PI;
  back.position.z = -CARD_D / 2 - 0.0003;
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.castShadow = true;
  front.renderOrder = back.renderOrder = 3;
  g.add(edge, front, back);
  g.userData = {
    card: true,
    edge,
    setBack(tex, mode) {
      bm.uniforms.map.value = tex;
      bm.uniforms.uMode.value = mode;
    },
    setWhite(k) {
      fm.uniforms.uWhite.value = bm.uniforms.uWhite.value = k;
    },
    setSil(k) {
      fm.uniforms.uSil.value = k;
    },
    setOpacity(k) {
      fm.uniforms.uOpacity.value = bm.uniforms.uOpacity.value = k;
      if (!edge.userData.own) {
        // 卡邊材質是大家共用的 → 要淡出時先複製一份給自己
        edge.material = edge.material.clone();
        edge.material.transparent = true;
        edge.userData.own = true;
      }
      edge.material.opacity = k;
      const line = edge.getObjectByName('outline');
      if (line?.material.uniforms?.uOpacity) {
        if (!line.userData.own) {
          line.material = line.material.clone();
          line.material.transparent = true;
          line.userData.own = true;
        }
        line.material.uniforms.uOpacity.value = k;
      }
    },
    dispose() {
      live.delete(fm);
      live.delete(bm);
      fm.uniforms.map.value?.dispose();
      if (fm.uniforms.bgPhoto.value !== fm.uniforms.photo.value) fm.uniforms.bgPhoto.value?.dispose();
      fm.uniforms.photo.value?.dispose();
      fm.uniforms.depthMap.value?.dispose();
      fm.uniforms.overMap.value?.dispose();
      fm.dispose();
      bm.dispose();
    },
  };
  return g;
}

export function stepCards(time) {
  for (const m of live) m.uniforms.uTime.value = time;
}
