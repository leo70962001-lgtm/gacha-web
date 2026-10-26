// 轉卡機的卡片：圓角薄片（正面、背面各一張貼圖）＋白色卡邊（toon 描邊由 machine.js 加）
// 閃卡 shader（使用者 2026-10-25：「卡片把卡片的效果強化 參考寶可夢卡的作法」— 照 pokemon-cards-css 的分層做法）
//   uMode 0＝一般卡（只有反光）、1＝ホロ（只有圖片窗的背景是虹色雷射＋直條紋，主體不閃）、
//   2＝フルアート（整張斜格紋理＋虹光）、3＝レインボーレア＋金（整張亮粉、虹色、金框）
//   每種都疊一層跟著光點走的反光（overlay），光點＝卡片斜的方向
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
// 寶可夢卡雷射的六色（sunpillar：hsl 2/53/93/176/228/283°）
vec3 sun(float x) {
  x = fract(x) * 6.;
  vec3 a = vec3(1., .48, .46), b = vec3(1., .93, .38), c = vec3(.66, 1., .38), d = vec3(.52, 1., .97), e = vec3(.48, .58, 1.), f = vec3(.85, .46, 1.);
  float t = fract(x);
  t = t * t * (3. - 2. * t);
  if (x < 1.) return mix(a, b, t);
  if (x < 2.) return mix(b, c, t);
  if (x < 3.) return mix(c, d, t);
  if (x < 4.) return mix(d, e, t);
  if (x < 5.) return mix(e, f, t);
  return mix(f, a, t);
}
vec3 sunK(float x) { return clamp((sun(x) - 0.5) * 2.2 + 0.5, 0., 1.); } // contrast(2.2)：粉彩六色變鮮豔
// 雷射箔透過油墨：圖的亮度 × 虹色（照片是不透明的，只用 dodge 的話綠色的背景還是綠色）
vec3 foilTint(vec3 col, vec3 rb, float k) { float l = dot(col, vec3(.3, .59, .11)); return mix(col, rb * (0.2 + 1.25 * l), clamp(k, 0., 1.)); }
vec3 dodge(vec3 b, vec3 s) { return min(vec3(1.), b / max(vec3(0.02), 1. - s)); } // mix-blend-mode: color-dodge
vec3 overlay3(vec3 b, vec3 s) { return mix(2. * b * s, 1. - 2. * (1. - b) * (1. - s), step(0.5, b)); }
vec3 contrastSat(vec3 c, float k, float sat) { c = (c - 0.5) * k + 0.5; float l = dot(c, vec3(.299, .587, .114)); return clamp(mix(vec3(l), c, sat), 0., 1.); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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
  float sw = 0.; // 主體（白）／背景（黑）
  float inArt = 0.; // 圖片窗（不是框）
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
      sw = smoothstep(0.4, 0.7, texture2D(depthMap, p).r);
      inArt = 1.;
      col = mix(texture2D(bgPhoto, p).rgb, texture2D(photo, p).rgb, sw);
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
  // ---- 閃卡（pokemon-cards-css：shine＝虹色×紋理 用 color-dodge 疊上去，glare＝跟著光點的 overlay）----
  float ovm = step(0.5, ov.a); // 章、名字帶不閃
  float frame = (1. - inArt) * (1. - ovm);
  vec2 ptr = 0.5 + vec2(par.x, par.y) * 0.85 + vec2(sin(uTime * 0.4), cos(uTime * 0.33)) * 0.04; // 光點（卡片往哪斜，光就滑到哪）
  float fc = clamp(length(par) * 1.7, 0., 1.); // 離中間多遠＝多斜（越斜越亮）
  float spot = 1. - smoothstep(0.0, 0.85, distance(vUv * vec2(0.686, 1.), ptr * vec2(0.686, 1.)));
  float I = 0.3 + 0.7 * fc;
  if (uMode > 0.5 && uMode < 1.5) {
    // ホロ（regular holo）：110° 的六色雷射（400% 大、斜的時候反方向滑）× 直的細掃描線 × 兩組會干涉的直條（3%）
    float t = dot(vUv, vec2(0.94, -0.34)) * 2.2 - par.x * 2.6 + par.y * 3.5;
    vec3 rb = sunK(t);
    float scan = mix(0.5, 0.85, step(0.5, fract(vUv.x * 260.)));
    float bars = 0.6 + 0.4 * sin((vUv.x + par.x * 0.55 + vUv.y * 0.12) * 209.) * sin((vUv.x - par.x * 0.3 - vUv.y * 0.2) * 150.);
    vec3 sh = contrastSat(rb * scan * bars, 1.1, 1.25) * (0.45 + 0.55 * spot);
    float wgt = inArt * (1. - sw);
    col = foilTint(col, rb, (0.25 + 0.35 * spot) * I * wgt * (0.6 + 0.4 * bars));
    col = dodge(col, sh * 0.7 * I * wgt) + sh * 0.12 * I * wgt; // 暗的地方 dodge 不太亮 → 再加一點
  } else if (uMode > 1.5 && uMode < 2.5) {
    // フルアート（V、テクスチャ）：±45° 交叉的細斜線（菱格）＋ 133° 虹光，整張都有；主體淡一點；再加一層細細的指紋狀紋理
    float d1 = abs(sin((vUv.x * 0.686 + vUv.y) * 150. + par.x * 9.));
    float d2 = abs(sin((vUv.x * 0.686 - vUv.y) * 150. - par.y * 9.));
    float lat = smoothstep(0.22, 0.0, min(d1, d2)); // 交叉的細線（亮）
    float etch = 0.5 + 0.5 * sin(length((vUv - vec2(0.3, 0.7)) * vec2(0.686, 1.)) * 420. + par.x * 6.);
    vec3 rb = sunK(dot(vUv, vec2(0.68, 0.73)) * 1.8 + par.x * 2.4 - par.y * 1.8 + uTime * 0.02);
    vec3 sh = rb * (0.3 + 0.7 * lat) * (0.8 + 0.2 * etch) * (0.4 + 0.6 * spot);
    float wgt = (inArt * (1. - 0.75 * sw) + frame) * (1. - ovm);
    col = foilTint(col, rb, (0.22 + 0.3 * spot + 0.25 * lat) * I * wgt);
    col = dodge(col, sh * 0.7 * I * wgt) + sh * 0.1 * I * wgt;
  } else if (uMode > 2.5) {
    // レインボーレア＋ゴールド：-30° 虹色（跟著光點半速滑）soft-light 上色 → 亮粉（每格一顆，斜到對的角度才亮）color-dodge；框變金
    // uMode 3＝金框、4＝彩虹不加金框、5＝銀箔（不上虹色、框變銀）— 4、5 只有卡背的「加工」會用到
    float silver = step(4.5, uMode);
    vec3 rb = mix(sunK(dot(vUv, vec2(0.5, 0.87)) * 1.7 + par.x * 1.2 - par.y * 0.9 + uTime * 0.03), vec3(0.92, 0.95, 1.), silver);
    float wgt = 1. - ovm;
    col = foilTint(col, rb, (0.3 + 0.3 * spot + 0.15 * fc) * wgt * (1. - 0.55 * sw * inArt) * (1. - frame)); // 虹色上色（主體淡一點）
    col = dodge(col, rb * (0.25 + 0.45 * spot) * I * wgt * (1. - 0.5 * sw * inArt));
    if (frame > 0.5 && uMode < 3.5) {
      float lum = dot(col, vec3(.3, .59, .11));
      vec3 gold = mix(vec3(.55, .33, .05), vec3(1., .86, .45), smoothstep(0.15, 0.9, lum + 0.35 * spot));
      col = mix(col, gold, 0.65);
    }
    if (frame > 0.5 && silver > 0.5) {
      float lum = dot(col, vec3(.3, .59, .11));
      col = mix(col, mix(vec3(.34, .37, .44), vec3(.96, .97, 1.), smoothstep(0.25, 1.15, lum + 0.3 * spot)), 0.45); // 銀：亮的地方才白，保留圖案的明暗
    }
    vec2 cell = vUv * vec2(120., 175.);
    vec2 id = floor(cell);
    vec2 f = fract(cell) - 0.5;
    float h1 = hash(id), h2 = hash(id + 7.3), h3 = hash(id + 19.1);
    float tw = sin(h1 * 40. + par.x * (18. + 30. * h2) + par.y * (18. + 30. * h3) + uTime * 0.6);
    float g = smoothstep(0.9, 1., tw) * smoothstep(0.42, 0.0, length(f)) * step(0.4, h2) * (1. - 0.65 * sw * inArt);
    vec3 gc = silver > 0.5 ? vec3(1.) : frame > 0.5 && uMode < 3.5 ? vec3(1., .9, .55) : sun(h3 + par.x * 0.5);
    col = dodge(col, gc * g * (0.5 + 0.5 * spot) * wgt);
    col += gc * g * 0.55 * wgt;
  }
  // 反光（glare）：光點附近白、遠的地方暗一點，overlay 疊上去 — 每張卡都有（一般卡只有這個）
  float gd = distance(vUv * vec2(0.686, 1.), ptr * vec2(0.686, 1.));
  float gv = mix(1., 0., smoothstep(0.08, 0.95, gd));
  float ga = mix(0.8, 0.45, smoothstep(0.1, 0.9, gd));
  col = mix(col, overlay3(col, vec3(gv)), ga * (0.18 + 0.22 * fc));
  if (uSil > 0.001) {
    // 剪影：整張變暗、四周亮一圈稀有度色（SSR 彩虹、SR 金、其他藍）
    float d = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
    float rim = smoothstep(0.08, 0.0, d);
    vec3 rc = uMode > 2.5 ? 0.5 + 0.5 * cos(6.2831 * (vUv.y * 1.5 + uTime * 0.5 + vec3(0., .33, .67)))
      : (uMode > 1.5 ? vec3(1., .82, .3) : vec3(.55, .75, 1.));
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
