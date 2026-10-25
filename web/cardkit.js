// 轉卡機的卡片：圓角薄片（正面、背面各一張貼圖）＋白色卡邊（toon 描邊由 machine.js 加）
// 閃卡 shader：uMode 0＝一般、1＝金箔（一道金光掃過）、2＝彩虹（隨角度、時間流動的七彩）
import * as THREE from 'three';

export const CARD_W = 0.19; // 公尺（剛好塞進出卡口 0.209 寬的細縫）
export const CARD_H = CARD_W / 0.686; // 卡片 59 × 86 mm 的比例
export const CARD_D = 0.003;

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
uniform sampler2D photo; uniform sampler2D depthMap; uniform float uLayered; uniform vec4 uWin; uniform float uDepth;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vVo;
void main(){
  vec4 c = texture2D(map, vUv);
  vec3 col;
  bool inWin = uLayered > 0.5 && vUv.x > uWin.x && vUv.x < uWin.z && vUv.y > uWin.y && vUv.y < uWin.w;
  if (inWin && c.a < 0.5) {
    // 3D 照片（像 iPhone 的空間照片）：圖片在框的後面，主體在前、背景退後；卡片一斜，背景比主體多位移
    vec2 w = (vUv - uWin.xy) / (uWin.zw - uWin.xy);
    vec3 V = normalize(vVo);
    vec2 par = V.xy / max(V.z, 0.3);
    // h：0.75＝背景退到後面、−0.25＝主體浮出卡面一點（像 iPhone 空間照片的主體往前跳）
    float h = 0.75 - texture2D(depthMap, w).r;
    vec2 p = w - par * uDepth * h;
    h = 0.75 - texture2D(depthMap, p).r;
    p = w - par * uDepth * h;
    p = (p - 0.5) / 1.1 + 0.5; // 放大一點，斜著看邊緣也不露底
    col = texture2D(photo, clamp(p, 0.002, 0.998)).rgb;
    float e = min(min(w.x, 1. - w.x), min(w.y, 1. - w.y));
    col *= mix(0.7, 1.0, smoothstep(0.0, 0.05, e)); // 窗的內緣有一圈影子（凹進去的感覺）
  } else {
    if (c.a < 0.5) discard;
    col = c.rgb;
  }
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
      photo: { value: null }, depthMap: { value: null }, uLayered: { value: 0 }, uWin: { value: new THREE.Vector4() }, uDepth: { value: 0.13 },
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
    fm.uniforms.depthMap.value = layers.depth;
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
      fm.uniforms.photo.value?.dispose();
      fm.uniforms.depthMap.value?.dispose();
      fm.dispose();
      bm.dispose();
    },
  };
  return g;
}

export function stepCards(time) {
  for (const m of live) m.uniforms.uTime.value = time;
}
