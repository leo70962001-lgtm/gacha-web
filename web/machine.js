// 3D 轉蛋機：模型（Blender → assets/gacha.glb）、窗內扭蛋物理、投幣、把手、出蛋、開蛋特效
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { sfx } from './sfx.js';
import { RARITY, drawLid, drawPrice, drawArrow, drawLabel, drawCard, drawSide, drawBoard, drawCardBack, CARD_PX, CARD_WIN, priceText } from './decor.js';
import { drawSign, drawPanelLabel, drawFolded, drawSlipBack, omiFontsReady } from './omikuji.js';
import { makeCard, cardTex, stepCards, CARD_H, CARD_W } from './cardkit.js';
import { brightSpots } from './holo.js';
import { t } from './i18n.js';
import { Spectacle, TIERS } from './fx.js';

// ---- 量測值（公尺；three.js 座標：Y 向上、+Z 朝機台正面）----
// 都是在 Blender 用射線打出來的（blender/build_glb.py、docs/README.md）
export const CAP_R = 0.065; // 扭蛋半徑（模型裡是 0.113，縮小才放得進出口）
const SRC_CAP_R = 0.113;
const WIN = { x: 0.345, back: -0.118, front: 0.405, top: 1.262 }; // 透明窗內的空間
// 窗內底部：中間平（y 0.724），往前、往後各一個斜坡 → 三個平面，扭蛋要在平面上方（n·p ≥ d + R）
const PLANES = [
  { n: new THREE.Vector3(0, 1, 0), d: 0.724 },
  { n: new THREE.Vector3(0, 0.7973, -0.6036), d: 0.48513 },
  { n: new THREE.Vector3(0, 0.7695, 0.6387), d: 0.53794 },
];
export const SLOT = new THREE.Vector3(0.2, 0.6, 0.35); // 投幣口
const HANDLE_C = new THREE.Vector3(0, 0.4822, 0.3836);
const EXIT = { x: -0.15, floor: 0.0666, z0: 0.2, z1: 0.272, lip: 0.357 }; // 出口凹槽
const FIN_MODE = { holo: 1, texture: 2, gold: 3, rainbow: 4, silver: 5, none: 0 }; // 表面加工 → cardkit 的 uMode
const FRONT = 0.3575; // 機身正面
const HOLE = { x: -0.15, z: 0.06 }; // 窗內底部的出蛋孔（正上方就是出口）
const DISC = { x: 0, z: 0.06 }; // 轉盤中心（跟著把手轉）
const MAX_PILE = 300; // 畫面上最多放幾顆

// 兩種機台的位置資料（機台座標：Y 上、+Z 正面，公尺）
//   capsule＝clatter.blend（blender/build_glb.py）；card＝clatter-1.blend 轉卡機（blender/build_card_glb.py、measure_card.py）
const SPECS = {
  capsule: {
    slot: SLOT,
    slotFront: FRONT,
    handleC: HANDLE_C,
    handleAxis: 'z',
    restYaw: -0.32,
    box: { x: [-0.36, 0.36], y: [0, 1.37], z: [-0.45, 0.43] },
    lidLight: new THREE.Vector3(0, 1.2, 0.2),
    exitLight: new THREE.Vector3(EXIT.x, 0.2, 0.3),
    spark: { x: [-0.3, 0.3], y: [0.8, 1.1], z: [-0.05, 0.3] },
  },
  card: {
    // 投幣口＝投幣板最上面那條直的細縫（x 0.199..0.207、y 0.758..0.863，板面 z 0.433）
    //   中間那顆圓的是按鈕、下面短縫是退幣口（使用者 2026-10-25 截圖指出，原本誤放在圓鈕上）
    slot: new THREE.Vector3(0.203, 0.8105, 0.425),
    slotFront: 0.433,
    slotRect: { w: 0.03, h: 0.125, t: 0.012 }, // 提示框：直的細縫 → 方框（使用者 2026-10-25：「換成方框」）
    handleC: new THREE.Vector3(0.4201, 0.4298, 0), // 右側面的旋鈕（繞 X 軸轉）
    handleAxis: 'x',
    restYaw: -0.5, // 多轉一點，看得到右側的旋鈕（使用者 2026-10-25：旋鈕要看得出轉的方向）
    box: { x: [-0.357, 0.488], y: [0, 1.365], z: [-0.454, 0.526] },
    lidLight: new THREE.Vector3(-0.09, 0.9, 0.7),
    exitLight: new THREE.Vector3(0, 0.45, 0.68),
    spark: { x: [-0.27, 0.08], y: [0.6, 1.2], z: [0.44, 0.5] },
    // 出卡口：細縫 x −0.107..0.102、y 0.389..0.397；卡片躺著（卡面朝下）從機身裡滑出來，露出前框約 11 cm
    exit: { x: -0.0025, y: 0.393, zIn: 0.3, zOut: 0.5 },
  },
  // おみくじ箱（使用者 2026-11-21 自己做的 omikuji.blend；blender/build_omikuji_glb.py、measure_omikuji.py；three 的 z＝−Blender y）
  //   左邊玻璃箱（上面玻璃有圓洞，手伸進去抽）、右邊香油錢的木格柵（硬幣從上面投進縫裡）、後面立一塊看板
  omikuji: {
    slot: new THREE.Vector3(0.409, 0.75, -0.0065), // 格柵正中間那條縫（縫的中心 Blender y 0.0065）
    slotTop: true, // 從上面投
    slotRect: { w: 0.312, h: 0.625, t: 0.014 }, // 提示框圍住整片格柵（躺平）
    slotHitBox: { w: 0.32, h: 0.06, d: 0.64 },
    handleC: new THREE.Vector3(-0.194, 0.743, 0), // 「把手」＝上面玻璃的圓洞（在洞上畫圈＝攪籤）
    handleAxis: 'y',
    restYaw: -0.3,
    camDir: new THREE.Vector3(0, 0.62, 1), // 鏡頭高一點，看得到洞口跟玻璃裡的籤
    box: { x: [-0.621, 0.621], y: [0, 1.487], z: [-0.408, 0.408] },
    lidLight: new THREE.Vector3(-0.19, 0.42, 0.1),
    exitLight: new THREE.Vector3(-0.194, 0.98, 0.06),
    spark: { x: [-0.5, 0.1], y: [0.12, 0.5], z: [-0.3, 0.3] },
    hole: { x: -0.194, y: 0.743, z: 0, r: 0.176 },
    inner: { x: [-0.578, 0.18], z: [-0.355, 0.355], floor: 0.0506, top: 0.716 }, // 玻璃箱裡面（籤堆的範圍）
  },
};
// おみくじ箱的木頭顏色（主題色 → 白木、朱塗り…；木紋貼圖＝Poly Haven ash_veneer，web/assets/tex/wood_ash.webp）
export const OMI_WOOD = {
  red: { body: '#d0533a', sign: '#c34a33' }, // 朱塗り
  white: { body: '#f7d9a0', sign: '#f2d299' }, // 白木（三峰神社那台）
  yellow: { body: '#eaa951', sign: '#e09d45' }, // 飴色（ニス塗り）
  blue: { body: '#6f8fb8', sign: '#6584ad' },
  mint: { body: '#8fc4a9', sign: '#84b99d' },
  pink: { body: '#eeb3bf', sign: '#e7a7b4' },
  black: { body: '#43372f', sign: '#3b3029' }, // 黒漆
};
// 折好的籤（窗裡那堆、拿出來的那張）：橫的小紙包，打開後是 SLIP3.w × SLIP3.h 的長條
const SLIP3 = { w: 0.15, h: 0.35, n: 4, t: 0.004, pile: 0.6 }; // n 折；t＝窗裡紙包的厚度（使用者 2026-11-21「厚度薄一些」：1.2 cm → 4 mm）；pile＝窗裡的籤是拿出來那張的幾倍大
const MAX_SLIPS = 220;
const OMI_CAP = 0.8; // 籤裝在轉蛋裡（使用者 2026-11-21：「可以讓用戶選要不要用圓的轉蛋」）：轉蛋是扭蛋機那顆的 0.8 倍

// 扭蛋大小：顆數少就用原尺寸，多了就縮小，讓它們大約裝到窗的六成高
function capRadius(n) {
  return Math.min(CAP_R, Math.cbrt(0.01755 / Math.max(1, n)));
}
// 窗內某個前後位置（z）的底部高度：中間平、前後斜坡
function floorY(z) {
  return Math.max(0.724, 0.724 + 0.757 * (z - 0.15), 0.724 + 0.83 * (-0.03 - z));
}
function cellKey(p, inv, dx, dy, dz) {
  return Math.floor((p.x + 1) * inv) + dx + 128 * (Math.floor(p.y * inv) + dy + 128 * (Math.floor((p.z + 1) * inv) + dz));
}

export const THEMES = {
  red: { body: '#d8262c', lid: '#f3f1ec', handle: '#f3f1ec' },
  white: { body: '#efeee9', lid: '#d8262c', handle: '#2f6bdb' },
  yellow: { body: '#f6c514', lid: '#f3f1ec', handle: '#f3f1ec' },
  blue: { body: '#2a63d4', lid: '#f3f1ec', handle: '#ffd23f' },
  mint: { body: '#43c2a8', lid: '#f3f1ec', handle: '#ff7a59' },
  pink: { body: '#f290b5', lid: '#ffffff', handle: '#5fb8ea' },
  black: { body: '#2a2b31', lid: '#d8262c', handle: '#f3f1ec' },
};
const CAP_COLORS = ['#e8423b', '#f6b91a', '#2f7fe0', '#36c18f', '#ef6fa8', '#f08a24', '#8a5cd6', '#4cc3e6'];
const INK = '#1c2340'; // 描線顏色＝Gemini 貼圖的深藍線

// ---- Toon（卡通渲染）----
// 明暗色階（N·L 從 -1 到 1 分四格）：背光面（N·L<0）直射光＝0，跟「被擋住的影子」是同一個暗色。
// 2026-10-22 查證：原本背光面還有 35% 直射光，陰影貼圖在明暗交界附近時有時無，
// 同一個側面紅色從 85 到 197 都有（貼紙看起來比機身亮、斑駁）。改成這樣後背光面只剩環境光，一種暗色。
// 受光面：0–0.5 半影、0.5 以上全亮；NearestFilter 讓色階是硬邊
const AMB = 1.75; // 環境光（暗面的亮度）
const KEY = 1.6; // 主光
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 140, 140, 140, 255, 255, 255, 255, 255]), 4, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// 描邊：把網格沿法線往外推一點、只畫背面（inverted hull）
// 硬邊的地方法線是分開的，推出去會裂開 → 描邊用的幾何先合併頂點、重算平滑法線
const outlineMat = (w) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(INK) }, uW: { value: w }, uOpacity: { value: 1 } },
    vertexShader: `uniform float uW;
      void main(){ vec4 p = vec4(position + normalize(normal) * uW, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity;
      void main(){ gl_FragColor = vec4(uColor, uOpacity);
      #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  });

function hullGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

// DecalGeometry 的結果只留「面向貼紙」的三角形（法線跟貼紙方向的內積 > min）：投得深的時候不會印到背面、垂直的側壁
//   順便把 v 上下翻：貼紙圖是 ImageBitmap，WebGL 不管 flipY → 不翻的話貼上去是上下顛倒的（使用者 2026-10-29：「貼紙貼到機器上反了」）
function facing(geo, n, min) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const P = [];
  const N = [];
  const U = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += nor.getX(i + k) * n.x + nor.getY(i + k) * n.y + nor.getZ(i + k) * n.z;
    if (d / 3 < min) continue;
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      N.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
      U.push(uv.getX(i + k), 1 - uv.getY(i + k));
    }
  }
  if (!P.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}

// 貼紙可以貼的零件（順序固定：存的時候記編號）：模型的網格（描邊、貼紙本身除外）＋印刷的面板
function stickables(scene, decals) {
  const list = [];
  scene.traverse((o) => o.isMesh && o.name !== 'outline' && o.name !== 'sticker' && list.push(o));
  return list.concat(Object.values(decals));
}

function addOutline(mesh, w, cache) {
  let geo = cache?.get(mesh.geometry);
  if (!geo) {
    geo = hullGeometry(mesh.geometry);
    cache?.set(mesh.geometry, geo);
  }
  const o = new THREE.Mesh(geo, outlineMat(w));
  o.name = 'outline';
  mesh.add(o);
  return o;
}

// 透明塑膠（扭蛋上半、透明窗）：邊緣一圈深藍線＋斜角的白色色帶＋一點硬高光
function toonGlass(tint, alpha, rim) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tint) },
      uLine: { value: new THREE.Color(INK) },
      uAlpha: { value: alpha },
      uRim: { value: rim },
      uOpacity: { value: 1 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 p = vec4(position, 1.0); vec3 nn = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; nn = mat3(instanceMatrix) * nn;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * nn); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uTint, uLine; uniform float uAlpha, uRim, uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main(){ vec3 n = normalize(vN); vec3 v = normalize(vV);
        float f = 1.0 - abs(dot(n, v));
        float rim = step(1.0 - uRim, f);
        float band = step(0.5, f) * 0.4;
        vec3 L = normalize(vec3(-0.45, 0.75, 0.5));
        float spec = step(0.97, dot(reflect(-L, n), v));
        vec3 col = mix(uTint, vec3(1.0), band + spec);
        col = mix(col, uLine, rim);
        float a = max(uAlpha + band * 0.6 + spec, rim);
        gl_FragColor = vec4(col, a * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}


// 黃金扭蛋（SR、SSR）：matcap＝把「球從各個方向看起來的顏色」畫成一張圖
// 卡通金屬：分層的金色硬邊、左上高光、右下反光；SSR 外圈再加彩虹光澤
function goldMatcap(rainbow) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3500';
  g.fillRect(0, 0, S, S);
  const disc = (x, y, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x * S, y * S, r * S, 0, Math.PI * 2);
    g.fill();
  };
  disc(0.5, 0.5, 0.5, '#8a5508');
  disc(0.47, 0.46, 0.43, '#c3820f');
  disc(0.44, 0.42, 0.35, '#eaa924');
  disc(0.4, 0.37, 0.25, '#ffd24a');
  disc(0.36, 0.32, 0.13, '#fff1b3');
  // 右下的反光（金屬特有的邊緣亮光）
  g.strokeStyle = '#ffd86e';
  g.lineWidth = S * 0.035;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.44, Math.PI * 0.1, Math.PI * 0.42);
  g.stroke();
  // 硬高光
  g.save();
  g.translate(S * 0.33, S * 0.28);
  g.rotate(-0.6);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(0, 0, S * 0.075, S * 0.035, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (rainbow) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    const cg = g.createConicGradient ? g.createConicGradient(0, S / 2, S / 2) : null;
    if (cg) {
      ['#ff4d6d', '#ffb347', '#fff275', '#5cff9d', '#4dc3ff', '#b36bff', '#ff4d6d'].forEach((col, i, a) => cg.addColorStop(i / (a.length - 1), col));
      g.strokeStyle = cg;
    } else g.strokeStyle = '#ff9fe0';
    g.lineWidth = S * 0.09;
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.45, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => {
    const c = 1.7;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
};
const rnd = (a, b) => a + Math.random() * (b - a);

export class Machine {
  constructor(host, opts = {}) {
    this.host = host;
    this.cb = opts; // onSlot, onHandleLocked, onTick, onTurned, onExitCapsule, onOpenCapsule
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // toon：顏色照原樣，不做電影色調
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.className = 'gl';
    host.prepend(r.domElement);

    const s = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
    this.ramp = toonRamp();
    // 暗面 ≈ 環境 0.56、半影 0.84、亮面 1.07（three.js 的漫射要除以 π）
    this.ambient = new THREE.AmbientLight(0xffffff, AMB);
    s.add(this.ambient);
    const key = (this.key = new THREE.DirectionalLight(0xffffff, KEY));
    key.position.set(-1.6, 3.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.2;
    key.shadow.camera.right = 1.2;
    key.shadow.camera.top = 1.8;
    key.shadow.camera.bottom = -0.4;
    key.shadow.camera.far = 8;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2;
    s.add(key);

    // 地板＝背景色（不受光）＋只畫影子的一層 → 地板和背景接得起來
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0xdce6ec });
    const floor = (this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), this.floorMat));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    // 關燈用的暗幕：畫在最遠處，只蓋住背景（機台、地板、特效都在它前面）
    this.dimmer = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.99999, 1.0); }',
        fragmentShader: 'uniform float uA; void main(){ gl_FragColor = vec4(0.024, 0.035, 0.075, uA); }',
        transparent: true,
        depthWrite: false,
      }),
    );
    this.dimmer.frustumCulled = false;
    this.dimmer.renderOrder = -100;
    s.add(this.dimmer);
    this.shadowMat = new THREE.ShadowMaterial({ color: new THREE.Color(INK), opacity: 0.2 });
    const catcher = new THREE.Mesh(new THREE.CircleGeometry(4, 48), this.shadowMat);
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.001;
    catcher.receiveShadow = true;
    s.add(catcher);
    s.fog = new THREE.Fog(0xdce6ec, 5, 13);
    s.background = new THREE.Color(0xdce6ec);

    this.root = new THREE.Group(); // 整台機器（拖曳可以轉角度）
    s.add(this.root);
    this.kind = 'capsule';
    this.kinds = {}; // capsule／card：各自的模型群組、把手、投幣口、貼紙
    this.spec = SPECS.capsule;
    this.fx = new THREE.Group(); // 開蛋特效（跟著鏡頭，不跟機器轉）
    s.add(this.fx);

    this.pile = [];
    this.tweens = [];
    this.yaw = -0.32;
    this.yawTarget = -0.32;
    this.restYaw = -0.32;
    this.idleT = 0;
    this.handleAngle = 0;
    this.handleEnabled = false;
    this.slotHint = false;
    this.exitCap = null;
    this.openCap = null;
    this.shakeT = 0;
    this.time = 0;
    this.acc = 0;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    this._bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this._frame());
  }

  // ---------- 載入 ----------
  async load(base = './assets/') {
    this.base = base;
    // 模型＝gacha.glb 的 base64 文字（artifact 不提供 .glb 檔案類型）
    const glbBytes = fetch(base + 'gacha.b64.txt')
      .then((r) => {
        if (!r.ok) throw new Error('model ' + r.status);
        return r.text();
      })
      .then((t) => Uint8Array.from(atob(t.trim()), (c) => c.charCodeAt(0)).buffer);
    const [gltf, aoBody, aoLid, aoHandle] = await Promise.all([
      glbBytes.then((buf) => new GLTFLoader().parseAsync(buf, base)),
      this._tex(base + 'ao_body.jpg'),
      this._tex(base + 'ao_lid.jpg'),
      this._tex(base + 'ao_handle.jpg'),
    ]);
    this.art = {};
    const artNames = ['side', 'banner', 'badge', 'card', 'strip'];
    await Promise.all(
      artNames.map((n) =>
        loadImage(base + 'tex/' + n + '.webp')
          .then((im) => (this.art[n] = im))
          .catch(() => {}),
      ),
    );

    // 全部用 MeshToonMaterial（三階色帶）；AO 只留一點，免得破壞平塗感
    const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: this.ramp, aoMapIntensity: 0.35, ...o });
    const m = (this.mats = {
      body: toon({ aoMap: aoBody }),
      lid: toon({ aoMap: aoLid }),
      handle: toon({ aoMap: aoHandle, emissive: 0x000000 }),
      dark: toon({ color: 0x23283a, aoMap: aoBody }),
      metal: toon({ color: 0xc9d1dc, aoMap: aoBody }),
      glass: toonGlass('#dff2ff', 0.06, 0.06),
      capClear: toonGlass('#ffffff', 0.18, 0.16),
      coin: toon({ color: 0xf2b630 }),
    });
    this.capMats = CAP_COLORS.map((c) => toon({ color: c }));
    this.capRare = [null, null, new THREE.MeshMatcapMaterial({ matcap: goldMatcap(false) }), new THREE.MeshMatcapMaterial({ matcap: goldMatcap(true) })];
    this.hullCache = new Map();

    const byMat = { M_Body: m.body, M_Lid: m.lid, M_Handle: m.handle, M_ExitDark: m.dark, M_Metal: m.metal };
    const meshes = [];
    gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
    for (const o of meshes) {
      const name = o.material.name;
      if (name === 'M_CapClear') this.capTopGeo = o.geometry.clone().scale(CAP_R / SRC_CAP_R, CAP_R / SRC_CAP_R, CAP_R / SRC_CAP_R);
      else if (name === 'M_CapColor') this.capBotGeo = o.geometry.clone().scale(CAP_R / SRC_CAP_R, CAP_R / SRC_CAP_R, CAP_R / SRC_CAP_R);
      else if (name === 'M_Coin') this.coinGeo = o.geometry.clone();
    }
    for (const o of meshes) {
      const name = o.material.name;
      if (name.startsWith('M_Cap') || name === 'M_Coin') {
        o.removeFromParent();
        continue;
      }
      if (name === 'M_Window') {
        o.material = m.glass;
        o.renderOrder = 10;
        this.windowMesh = o;
        continue;
      }
      o.material = byMat[name] || m.body;
      o.castShadow = true;
      o.receiveShadow = true;
      addOutline(o, name === 'M_Handle' ? 0.005 : 0.0045, this.hullCache);
      if (name === 'M_Handle') this.handle = o;
    }
    const capG = (this._dg = new THREE.Group()); // 扭蛋機（換成轉卡機時整組藏起來）
    this.root.add(capG);
    capG.add(gltf.scene);
    this.handleBase = this.handle.rotation.z;
    this._addSlot(SPECS.capsule);
    // 前兆用：窗頂的燈
    this.lidLight = new THREE.PointLight(0xffffff, 0, 1.6, 1.5);
    this.lidLight.position.set(0, 1.2, 0.2);
    this.root.add(this.lidLight);
    // 出口內的光（稀有扭蛋）
    this.exitLight = new THREE.PointLight(0xffffff, 0, 0.9, 2);
    this.exitLight.position.set(EXIT.x, 0.2, 0.3);
    this.root.add(this.exitLight);

    this._buildDecals();
    this.show = new Spectacle(this);
    this._buildPile();
    this.stickTargets = { capsule: stickables(gltf.scene, this.decals) };
    this.kinds.capsule = { group: capG, handle: this.handle, handleBase: this.handleBase, slotHit: this.slotHit, slotRing: this.slotRing, decals: this.decals, mats: this.mats };
    this._dg = null;
    this.loaded = true;
  }

  // 投幣口：點擊判定用的隱形球＋提示光圈（放進正在蓋的那台機台的群組）
  _addSlot(sp) {
    const hb = sp.slotHitBox;
    this.slotHit = new THREE.Mesh(hb ? new THREE.BoxGeometry(hb.w, hb.h, hb.d) : new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.slotHit.position.copy(sp.slot);
    this._dg.add(this.slotHit);
    this.slotRing = new THREE.Mesh(
      sp.slotRect ? rectFrame(sp.slotRect) : new THREE.RingGeometry(0.056, 0.078, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.slotRing.userData.pulse = sp.slotRect ? 0.12 : 0.25;
    if (sp.slotTop) {
      this.slotRing.position.set(sp.slot.x, 0.766, sp.slot.z); // 躺在格柵上面（框頂 0.763）
      this.slotRing.rotation.x = -Math.PI / 2;
    } else this.slotRing.position.set(sp.slot.x, sp.slot.y, sp.slotFront + 0.004);
    this._dg.add(this.slotRing);
  }

  // ---------- 轉卡機 ----------
  // 第一次切到轉卡機才載入（card.b64.txt＋AO＋卡背、側面圖）
  async _loadCard() {
    const base = this.base;
    const glb = fetch(base + 'card.b64.txt')
      .then((r) => {
        if (!r.ok) throw new Error('card model ' + r.status);
        return r.text();
      })
      .then((t) => Uint8Array.from(atob(t.trim()), (c) => c.charCodeAt(0)).buffer);
    const [gltf, aoBody, aoLid, aoKnob] = await Promise.all([
      glb.then((buf) => new GLTFLoader().parseAsync(buf, base)),
      this._tex(base + 'ao_card_body.jpg'),
      this._tex(base + 'ao_card_lid.jpg'),
      this._tex(base + 'ao_card_knob.jpg'),
    ]);
    await Promise.all(
      ['cardback', 'cside'].map((n) =>
        loadImage(base + 'tex/' + n + '.webp')
          .then((im) => (this.art[n] = im))
          .catch(() => {}),
      ),
    );
    const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: this.ramp, aoMapIntensity: 0.35, ...o });
    const cm = {
      body: toon({ aoMap: aoBody }),
      plain: toon({}), // 背板沒有烘 AO
      frame: toon({ aoMap: aoBody }), // 窗框：上蓋色
      lid: toon({ aoMap: aoLid }),
      handle: toon({ aoMap: aoKnob, emissive: 0x000000 }),
      dark: toon({ color: 0x23283a, aoMap: aoBody }),
      metal: toon({ color: 0xc9d1dc, aoMap: aoBody }),
      board: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    this.cmats = cm;
    const cardG = (this._dg = new THREE.Group());
    cardG.visible = false;
    this.root.add(cardG);
    const part = (o) => {
      for (let p = o; p; p = p.parent) if (/^(CardBody|CardLid|CardBack|CardGlass|Knob)/.test(p.name)) return p.name.match(/^(CardBody|CardLid|CardBack|CardGlass|Knob)/)[1];
      return '';
    };
    const meshes = [];
    gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
    let knob = null;
    for (const o of meshes) {
      const pn = part(o);
      const mn = o.material.name;
      if (pn === 'CardGlass') {
        o.material = this.mats.glass;
        o.renderOrder = 10;
        continue;
      }
      o.material =
        pn === 'Knob' ? cm.handle
        : pn === 'CardLid' ? cm.lid
        : pn === 'CardBack' ? cm.plain
        : { M_Lid: cm.frame, M_Metal: cm.metal, M_ExitDark: cm.dark, M_Board: cm.board }[mn] || cm.body;
      o.castShadow = true;
      o.receiveShadow = true;
      if (mn !== 'M_Board') addOutline(o, pn === 'Knob' ? 0.005 : 0.0045, this.hullCache);
      if (pn === 'Knob') knob = o;
    }
    cardG.add(gltf.scene);
    // 旋鈕：Blender 裡原點放在中心 → 繞自己的 X 軸轉；若匯出時包了一層節點，就轉那層
    const handle = knob.parent && /^Knob/.test(knob.parent.name) && knob.parent !== gltf.scene ? knob.parent : knob;
    // 旋鈕維持原本模型的樣子（使用者 2026-10-25：「模型不要改變」→ 拿掉後加的握把、黃點）
    const keep = { handle: this.handle, handleBase: this.handleBase, slotHit: this.slotHit, slotRing: this.slotRing, decals: this.decals };
    this.handle = handle;
    this.handleBase = handle.rotation.x;
    this._addSlot(SPECS.card);
    this._buildCardDecals();
    // 卡背（N/R 一般、SR 金、SSR 彩虹）與卡邊
    this.backTex = [0, 0, 2, 3].map((tier) => cardTex(drawCardBack(this.art.cardback, tier)));
    this.cardEdge = toon({ color: 0xffffff });
    // 卡邊（厚度）：金的加工＝金邊、ホロ／テクスチャ／レインボー／銀＝銀邊（使用者 2026-11-20：SAR 閃卡的金屬卡邊）
    this.cardEdgeGold = toon({ color: 0xd9b04e });
    this.cardEdgeSilver = toon({ color: 0xc3cad6 });
    this.stickTargets.card = stickables(gltf.scene, this.decals);
    this.kinds.card = { group: cardG, handle, handleBase: this.handleBase, slotHit: this.slotHit, slotRing: this.slotRing, decals: this.decals, mats: cm };
    Object.assign(this, keep); // 目前還是扭蛋機，setKind 再切
    this._dg = null;
    if (this.themeKey) this.setTheme(this.themeKey);
  }

  _buildCardDecals() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const F = 0.5275; // 下段正面
    this.decals = {
      lid: this._decal(0.7, 0.088, V(0, 1.317, 0.4275)),
      price: this._decal(0.15, 0.15, V(-0.225, 0.2, F)),
      arrow: this._decal(0.42, 0.42, V(0.3535, 0.4298, 0), Math.PI / 2),
      exit: this._decal(0.12, 0.06, V(0.19, 0.395, F)),
      board: this._decal(0.387, 0.694, V(-0.0925, 0.889, 0.4232)),
      sideL: this._decal(0.78, 0.55, V(-0.3535, 0.93, 0.005), -Math.PI / 2),
      sideR: this._decal(0.78, 0.55, V(0.3535, 0.93, 0.005), Math.PI / 2),
    };
    // 台紙不受光（像有背光）
    this.decals.board.material = new THREE.MeshBasicMaterial({ transparent: true });
    this.decals.board.receiveShadow = false;
    const shine = document.createElement('canvas');
    shine.width = 300;
    shine.height = 540;
    const sg = shine.getContext('2d');
    sg.fillStyle = 'rgba(255,255,255,0.5)';
    sg.beginPath();
    sg.moveTo(60, 0);
    sg.lineTo(120, 0);
    sg.lineTo(20, 540);
    sg.lineTo(-40, 540);
    sg.fill();
    sg.fillStyle = 'rgba(255,255,255,0.32)';
    sg.beginPath();
    sg.moveTo(150, 0);
    sg.lineTo(175, 0);
    sg.lineTo(75, 540);
    sg.lineTo(50, 540);
    sg.fill();
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.387, 0.694), new THREE.MeshBasicMaterial({ map: canvasTex(shine), transparent: true, depthWrite: false }));
    sh.position.set(-0.0925, 0.889, 0.4352);
    sh.renderOrder = 12;
    this._dg.add(sh);
    // 轉的動畫（模型不動，使用者 2026-10-25：「模型不變但是要有轉的動畫」）：
    //   旋鈕表面外圈兩道白色動線，跟著旋鈕轉、轉越快越亮；旁邊的弧形箭頭也跟著轉（_setHandle）
    const fx = new THREE.Group();
    fx.position.set(0.4905, 0.4298, 0); // 旋鈕表面（x 0.488）外面一點，面向 +X
    fx.rotation.set(0, Math.PI / 2, 0);
    for (const [r0, r1, start] of [[0.126, 0.141, 0.2], [0.146, 0.158, Math.PI + 0.6]]) {
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 32, 1, start, 1.7),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      );
      arc.renderOrder = 13;
      fx.add(arc);
    }
    this._dg.add(fx);
    this.turnFx = fx;
  }

  // 換機台種類：第一次換到轉卡機／おみくじ會先載入模型
  async setKind(kind) {
    kind = kind === 'card' || kind === 'omikuji' ? kind : 'capsule';
    if (!this.loaded) return;
    if (kind === 'card' && !this.kinds.card) {
      this._cardP = this._cardP || this._loadCard();
      await this._cardP;
    }
    if (kind === 'omikuji' && !this.kinds.omikuji) {
      this._omiP = this._omiP || this._loadOmikuji();
      await this._omiP;
    }
    if (this.kind === kind) return;
    this.clearCapsules();
    this.kind = kind;
    this.spec = SPECS[kind];
    const k = this.kinds[kind];
    for (const [n, o] of Object.entries(this.kinds)) o.group.visible = n === kind;
    // 窗裡的扭蛋掛在 root 下（不在扭蛋機的群組裡）→ 別的機台要藏起來
    for (const m of [this.pileBot, this.pileTop, this.pileLine]) if (m) m.visible = kind === 'capsule';
    this.handle = k.handle;
    this.handleBase = k.handleBase;
    this.slotHit = k.slotHit;
    this.slotRing = k.slotRing;
    this.decals = k.decals;
    this.handleAngle = 0;
    this.restYaw = this.yawTarget = this.yaw = this.spec.restYaw;
    this.lidLight.position.copy(this.spec.lidLight);
    this.exitLight.position.copy(this.spec.exitLight);
    this.refreshLabels();
    this._frameCamera();
  }

  // ---------- おみくじ箱 ----------
  // 第一次切到おみくじ才載入（omikuji.b64.txt＋AO＋木紋）
  async _loadOmikuji() {
    const base = this.base;
    const glb = fetch(base + 'omikuji.b64.txt')
      .then((r) => {
        if (!r.ok) throw new Error('omikuji model ' + r.status);
        return r.text();
      })
      .then((t) => Uint8Array.from(atob(t.trim()), (c) => c.charCodeAt(0)).buffer);
    const [gltf, aoBody, aoSign, aoFloor, wood] = await Promise.all([
      glb.then((buf) => new GLTFLoader().parseAsync(buf, base)),
      this._tex(base + 'ao_omi_body.jpg'),
      this._tex(base + 'ao_omi_sign.jpg'),
      this._tex(base + 'ao_omi_floor.jpg'),
      new THREE.TextureLoader().loadAsync(base + 'tex/wood_ash.webp'),
      omiFontsReady(),
    ]);
    // 木紋：第二組 UV（WoodUV，1 UV＝1 公尺，紋路順著每個面比較長的那一邊）
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.channel = 1;
    wood.anisotropy = 4;
    wood.flipY = false;
    const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: this.ramp, aoMapIntensity: 0.4, ...o });
    const om = {
      body: toon({ aoMap: aoBody, map: wood }),
      sign: toon({ aoMap: aoSign, map: wood }),
      floor: toon({ aoMap: aoFloor, map: wood }),
      dark: toon({ color: 0x1d1713, aoMap: aoBody }),
      paper: new THREE.MeshBasicMaterial({ color: 0xf7f2e6 }),
    };
    this.omats = om;
    const omiG = (this._dg = new THREE.Group());
    omiG.visible = false;
    this.root.add(omiG);
    const part = (o) => {
      for (let p = o; p; p = p.parent) {
        const m = /^(OmiBody|OmiFloor|OmiGlass|OmiSign|OmiPaper)/.exec(p.name);
        if (m) return m[1];
      }
      return '';
    };
    const meshes = [];
    gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
    for (const o of meshes) {
      const pn = part(o);
      const mn = o.material.name;
      if (pn === 'OmiGlass') {
        o.material = this.mats.glass;
        o.renderOrder = 10;
        continue;
      }
      o.material = pn === 'OmiPaper' ? om.paper : pn === 'OmiSign' ? om.sign : pn === 'OmiFloor' ? om.floor : mn === 'M_ExitDark' ? om.dark : om.body;
      o.castShadow = pn !== 'OmiPaper';
      o.receiveShadow = true;
      if (pn === 'OmiBody' || pn === 'OmiSign') addOutline(o, 0.0045, this.hullCache);
    }
    omiG.add(gltf.scene);
    const keep = { handle: this.handle, handleBase: this.handleBase, slotHit: this.slotHit, slotRing: this.slotRing, decals: this.decals };
    const sp = SPECS.omikuji;
    // 「把手」＝圓洞：看不見的圓柱（點、拖的判定），真正會轉的是洞旁邊的弧形箭頭
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(sp.hole.r + 0.03, sp.hole.r + 0.03, 0.12, 24), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(sp.hole.x, sp.hole.y + 0.02, sp.hole.z);
    omiG.add(hit);
    this.handle = hit;
    this.handleBase = 0;
    this._addSlot(sp);
    this._buildOmiDecals();
    om.handle = this.decals.arrow.material; // 可以攪的時候箭頭發光（_frame 的 handle.emissive）
    this._buildSlipPile(omiG);
    this.slipBackTex = canvasTex(drawSlipBack());
    this.stickTargets.omikuji = stickables(gltf.scene, this.decals);
    this.kinds.omikuji = { group: omiG, handle: hit, handleBase: 0, slotHit: this.slotHit, slotRing: this.slotRing, decals: this.decals, mats: om };
    Object.assign(this, keep);
    this._dg = null;
    if (this.themeKey) this.setTheme(this.themeKey);
  }

  _buildOmiDecals() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const sp = SPECS.omikuji;
    const F = 0.3955; // 右邊木板的正面（Blender y −0.394）
    this.decals = {
      board: this._decal(0.928, 0.652, V(0.0003, 1.125, -0.3515)), // 看板的紙（polySurface36）
      label: this._decal(0.2, 0.52, V(0.411, 0.33, F)), // 紅字「おみくじ」
      price: this._decal(0.13, 0.13, V(0.411, 0.64, F)),
      arrow: this._decal(0.5, 0.5, V(sp.hole.x, sp.hole.y + 0.0015, sp.hole.z)), // 圓洞周圍的弧形箭頭（躺在玻璃上）
    };
    this.decals.arrow.rotation.set(-Math.PI / 2, 0, 0);
    // 圓洞的邊：玻璃是透明的，洞要畫一圈線才看得出來（跟描邊同色）
    const rim = new THREE.Mesh(new THREE.RingGeometry(sp.hole.r - 0.004, sp.hole.r + 0.004, 72), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.85, depthWrite: false }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(sp.hole.x, sp.hole.y + 0.001, sp.hole.z);
    rim.renderOrder = 11;
    this._dg.add(rim);
    this.decals.arrow.material.depthWrite = false;
    this.decals.arrow.renderOrder = 11;
    // 看板的紙不受光（不然落在看板框的影子裡）
    this.decals.board.material = new THREE.MeshBasicMaterial({ transparent: true });
    this.decals.board.receiveShadow = false;
    // 正面玻璃的斜反光
    const shine = document.createElement('canvas');
    shine.width = 512;
    shine.height = 420;
    const sg = shine.getContext('2d');
    sg.fillStyle = 'rgba(255,255,255,0.45)';
    sg.beginPath();
    sg.moveTo(330, 0);
    sg.lineTo(390, 0);
    sg.lineTo(290, 420);
    sg.lineTo(230, 420);
    sg.fill();
    sg.fillStyle = 'rgba(255,255,255,0.3)';
    sg.beginPath();
    sg.moveTo(420, 0);
    sg.lineTo(440, 0);
    sg.lineTo(340, 420);
    sg.lineTo(320, 420);
    sg.fill();
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.765, 0.648), new THREE.MeshBasicMaterial({ map: canvasTex(shine), transparent: true, depthWrite: false }));
    sh.position.set(-0.1886, 0.3932, 0.3875);
    sh.renderOrder = 12;
    this._dg.add(sh);
  }

  // 玻璃箱裡的籤：一張一張折好的小紙包，InstancedMesh 兩層（紙、描邊）
  //   位置用固定亂數排一堆（中間高、四周低），多的時候堆得高；抽走一張＝拿掉洞口下面最上面那張
  _buildSlipPile(group) {
    const w = SLIP3.w * SLIP3.pile;
    const h = (SLIP3.h / SLIP3.n) * SLIP3.pile;
    const geo = new THREE.BoxGeometry(w, h, SLIP3.t);
    const tex = (this.foldTex = canvasTex(drawFolded()));
    const mat = new THREE.MeshToonMaterial({ gradientMap: this.ramp, map: tex });
    this.slipBody = new THREE.InstancedMesh(geo, mat, MAX_SLIPS);
    this.slipLine = new THREE.InstancedMesh(hullGeometry(geo), outlineMat(0.0016), MAX_SLIPS);
    for (const m of [this.slipBody, this.slipLine]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(m);
    }
    this.slipBody.castShadow = true;
    this.slipBody.receiveShadow = true;
    this.slipBody.setColorAt(0, _c.set('#ffffff'));
    this.omiCapBot = new THREE.InstancedMesh(this.capBotGeo, new THREE.MeshToonMaterial({ gradientMap: this.ramp }), MAX_SLIPS);
    this.omiCapTop = new THREE.InstancedMesh(this.capTopGeo, this.mats.capClear, MAX_SLIPS);
    this.omiCapTop.renderOrder = 2;
    this.omiCapLine = new THREE.InstancedMesh(hullGeometry(this.capBotGeo), outlineMat(0.0028), MAX_SLIPS);
    for (const m of [this.omiCapBot, this.omiCapTop, this.omiCapLine]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(m);
    }
    this.omiCapBot.castShadow = true;
    this.omiCapBot.setColorAt(0, _c.set(CAP_COLORS[0]));
    this.omiWrap = 'fold';
    this.slips = [];
    this.slipTotal = 0;
    this.omiStir = 0;
  }

  // 籤堆：count＝剩幾張、total＝原本幾張（決定堆多高；抽的過程中不重排）
  _setSlipPile(count, total) {
    const n = Math.min(count, MAX_SLIPS);
    const T = Math.min(Math.max(total, count), MAX_SLIPS);
    this._pileArgs = [count, total];
    if (T !== this.slipTotal || n > this.slips.length) {
      this.slipTotal = T;
      this.slips = (this.omiWrap === 'capsule' ? this._heapCaps(T) : this._heapSlips(T)).slice(0, n);
    } else if (n < this.slips.length) this.slips.length = n; // 拿掉最上面的
    this._syncSlips(true);
  }

  // 籤的樣子：fold＝折好的紙（預設）、capsule＝裝在圓的轉蛋裡 → 換了就整堆重排
  setOmiWrap(w) {
    w = w === 'capsule' ? 'capsule' : 'fold';
    if (w === this.omiWrap) return;
    this.omiWrap = w;
    this.slipTotal = -1;
    if (this._pileArgs && this.kind === 'omikuji') this._setSlipPile(...this._pileArgs);
  }

  // 轉蛋一層一層排（每層錯開半顆），沒排滿的那層從中間往外放（看起來像堆起來的）
  _heapCaps(N) {
    const I = SPECS.omikuji.inner;
    const R = CAP_R * OMI_CAP;
    let seed = 777;
    const rr = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cx = (I.x[0] + I.x[1]) / 2;
    const out = [];
    for (let layer = 0; out.length < N && layer < 12; layer++) {
      const y = I.floor + R + layer * R * 1.72;
      if (y > I.top - R) break;
      const off = layer % 2 ? R : 0;
      const cells = [];
      for (let x = I.x[0] + R + 0.004 + off; x <= I.x[1] - R; x += R * 2.06) for (let z = I.z[0] + R + 0.004 + off; z <= I.z[1] - R; z += R * 2.06) cells.push([x, z]);
      cells.sort((a, b) => Math.hypot(a[0] - cx, a[1]) - Math.hypot(b[0] - cx, b[1]) + (rr() - 0.5) * 0.05);
      for (const [x, z] of cells) {
        if (out.length >= N) break;
        out.push({ p: new THREE.Vector3(x + (rr() - 0.5) * 0.012, y, z + (rr() - 0.5) * 0.012), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rr() * 6.28, rr() * 6.28, rr() * 6.28)), ph: rr() * 6.28, tint: rr(), col: Math.floor(rr() * CAP_COLORS.length) });
      }
    }
    return out;
  }

  // 籤堆（使用者 2026-11-21：「浮起來的地方修正」）：一張一張丟進箱子，每張落到碰到箱底或下面的籤為止
  //   （之前高度是亂數 → 很多張浮在半空，立著的那些又插進箱底）
  _heapSlips(N) {
    const I = SPECS.omikuji.inner;
    let seed = 12345;
    const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cx = (I.x[0] + I.x[1]) / 2;
    const hx = (I.x[1] - I.x[0]) / 2 - 0.04;
    const hz = (I.z[1] - I.z[0]) / 2 - 0.04;
    const out = [];
    for (let i = 0; i < N; i++) {
      // 中間多、四周少（兩個亂數相加＝三角分布）→ 堆起來中間高
      const x = cx + (R() + R() - 1) * hx;
      const z = (R() + R() - 1) * hz;
      // 躺著順著下面的坡度；少數幾張斜靠（多翹一點）
      const lean = R() < 0.08 ? (0.2 + R() * 0.2) * (R() < 0.5 ? 1 : -1) : (R() - 0.5) * 0.1;
      out.push({ p: new THREE.Vector3(x, 0, z), x0: x, z0: z, q: new THREE.Quaternion(), yaw: R() * Math.PI * 2, lean, roll: (R() - 0.5) * 0.1, ph: R() * 6.28, tint: R(), ord: i });
    }
    this._settleSlips(out);
    return out;
  }

  // 照丟進去的順序重新放一次（拿走一張以後也重算 → 原本壓在它上面的籤掉下來，不會浮著）
  //   8 mm 的高度圖：先量籤四個邊底下多高 → 順著坡度躺（最多 35°）→ 取底面每一點「下面有多高」的最大值當落點 → 把它的上面寫回高度圖
  _settleSlips(P) {
    const I = SPECS.omikuji.inner;
    const G = 0.008;
    const nx = Math.ceil((I.x[1] - I.x[0]) / G) + 1;
    const nz = Math.ceil((I.z[1] - I.z[0]) / G) + 1;
    const hm = new Float32Array(nx * nz).fill(I.floor);
    const at = (x, z) => {
      const i = Math.round((x - I.x[0]) / G);
      const k = Math.round((z - I.z[0]) / G);
      return i < 0 || k < 0 || i >= nx || k >= nz ? -1 : k * nx + i;
    };
    const hAt = (x, z) => {
      const k = at(x, z);
      return k < 0 ? I.floor : hm[k];
    };
    const w = SLIP3.w * SLIP3.pile;
    const h = (SLIP3.h / SLIP3.n) * SLIP3.pile;
    if (!this._slipPts) {
      // 紙包的上下兩面各取 11×7 個點（間隔比格子小，才不會有縫讓下一張陷進去）
      this._slipPts = [];
      for (const t of [-SLIP3.t / 2, SLIP3.t / 2]) for (let a = 0; a <= 10; a++) for (let b = 0; b <= 6; b++) this._slipPts.push(new THREE.Vector3((a / 10 - 0.5) * w, (b / 6 - 0.5) * h, t));
      this._slipD = this._slipPts.map(() => new THREE.Vector3());
    }
    const pts = this._slipPts;
    const d = this._slipD;
    const up = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const M = new THREE.Matrix4();
    // 一條邊底下的最高點（沿著邊取 5 點）
    const edge = (x, z, ex, ez, sx, sz, len) => {
      let m = -Infinity;
      for (let t = -0.5; t <= 0.5001; t += 0.25) m = Math.max(m, hAt(x + ex + sx * len * t, z + ez + sz * len * t));
      return m;
    };
    P.sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    const k = Math.tan(0.25); // 坡度最多 14°（紙會滑下去，不會一直疊陡）
    const half = Math.hypot(w, h) / 2;
    const qq = new THREE.Quaternion();
    const ks = new Int32Array(pts.length);
    // 放在 (x, z) 的話：順著坡度的角度 → qq，落點 → 回傳 y（不寫進高度圖）
    const tryAt = (c, x, z) => {
      const cy = Math.cos(c.yaw);
      const sy = Math.sin(c.yaw);
      const ax = [cy, -sy];
      const ay = [sy, cy];
      const hA = edge(x, z, (ax[0] * w) / 2, (ax[1] * w) / 2, ay[0], ay[1], h);
      const hB = edge(x, z, (-ax[0] * w) / 2, (-ax[1] * w) / 2, ay[0], ay[1], h);
      const hC = edge(x, z, (ay[0] * h) / 2, (ay[1] * h) / 2, ax[0], ax[1], w);
      const hD = edge(x, z, (-ay[0] * h) / 2, (-ay[1] * h) / 2, ax[0], ax[1], w);
      const gx = THREE.MathUtils.clamp((hA - hB) / w, -k, k) + Math.tan(c.roll);
      const gy = THREE.MathUtils.clamp((hC - hD) / h, -k, k) + Math.tan(c.lean);
      u.set(ax[0], gx, ax[1]).normalize();
      v.set(ay[0], gy, ay[1]).normalize();
      n.crossVectors(u, v).normalize();
      if (n.dot(up) < 0) {
        // 要保持右手座標（只翻 n 會變成鏡像，轉出來的角度是亂的）→ 一起翻 v
        v.negate();
        n.negate();
      }
      v.crossVectors(n, u).normalize();
      qq.setFromRotationMatrix(M.makeBasis(u, v, n));
      let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
      pts.forEach((p, j) => {
        d[j].copy(p).applyQuaternion(qq);
        x0 = Math.min(x0, d[j].x);
        x1 = Math.max(x1, d[j].x);
        z0 = Math.min(z0, d[j].z);
        z1 = Math.max(z1, d[j].z);
      });
      // 整張都要在玻璃箱裡
      x = THREE.MathUtils.clamp(x, I.x[0] + 0.006 - x0, I.x[1] - 0.006 - x1);
      z = THREE.MathUtils.clamp(z, I.z[0] + 0.006 - z0, I.z[1] - 0.006 - z1);
      let y = -Infinity;
      d.forEach((p, j) => {
        ks[j] = at(x + p.x, z + p.z);
        y = Math.max(y, (ks[j] < 0 ? I.floor : hm[ks[j]]) - p.y);
      });
      return { x, z, y };
    };
    for (const c of P) {
      if (c.yaw == null) continue;
      // 每次都從丟進去的位置算（重算幾次結果都一樣，只有原本壓在拿走那張上面的會動）
      const x = THREE.MathUtils.clamp(c.x0 ?? c.p.x, I.x[0] + half, I.x[1] - half);
      const z = THREE.MathUtils.clamp(c.z0 ?? c.p.z, I.z[0] + half, I.z[1] - half);
      // 附近試 7 個位置，選落點最低的（＝滑到低的地方，堆起來是平緩的小山）
      let best = null;
      for (let t = 0; t < 7; t++) {
        const a = c.ord * 2.39996 + t * 0.8976;
        const r = t ? 0.035 : 0;
        const o = tryAt(c, x + Math.cos(a) * r, z + Math.sin(a) * r);
        if (!best || o.y < best.y - 0.002) best = o;
      }
      const o = tryAt(c, best.x, best.z); // 重算一次（qq、d、ks 是這個位置的）
      c.q.copy(qq);
      c.p.set(o.x, o.y + 0.0004, o.z);
      d.forEach((p, j) => {
        if (ks[j] >= 0) hm[ks[j]] = Math.max(hm[ks[j]], c.p.y + p.y);
      });
    }
    return P;
  }

  _syncSlips(colors = false) {
    if (!this.slipBody) return;
    const P = this.slips;
    const n = P.length;
    const caps = this.omiWrap === 'capsule';
    const k = caps ? OMI_CAP : 1;
    const s = this.omiStir;
    const hole = SPECS.omikuji.hole;
    for (let i = 0; i < n; i++) {
      const c = P[i];
      if (s > 0.002) {
        // 手在洞下面攪：靠近洞口、上層的籤晃得比較大
        const near = Math.max(0, 1 - Math.hypot(c.p.x - hole.x, c.p.z - hole.z) / 0.36) * Math.min(1, (c.p.y - 0.05) / 0.12 + 0.3);
        const a = s * near;
        _v1.set(Math.sin(this.time * 9 + c.ph) * 0.02 * a, Math.abs(Math.sin(this.time * 7 + c.ph)) * 0.025 * a, Math.cos(this.time * 8 + c.ph * 1.3) * 0.02 * a).add(c.p);
        _q.setFromEuler(_e.set(Math.sin(this.time * 6 + c.ph) * 0.4 * a, Math.sin(this.time * 5 + c.ph) * 0.8 * a, 0)).premultiply(c.q);
        _m.compose(_v1, _q, _s.set(k, k, k));
      } else _m.compose(c.p, c.q, _s.set(k, k, k));
      if (caps) {
        this.omiCapBot.setMatrixAt(i, _m);
        this.omiCapTop.setMatrixAt(i, _m);
        this.omiCapLine.setMatrixAt(i, _m);
        if (colors) this.omiCapBot.setColorAt(i, _c.set(CAP_COLORS[c.col ?? 0]));
      } else {
        this.slipBody.setMatrixAt(i, _m);
        this.slipLine.setMatrixAt(i, _m);
        if (colors) this.slipBody.setColorAt(i, _c.set(c.tint < 0.12 ? '#fde6e6' : c.tint < 0.2 ? '#fff3d6' : c.tint < 0.85 ? '#ffffff' : '#f4f1ea'));
      }
    }
    for (const m of [this.slipBody, this.slipLine]) {
      m.count = caps ? 0 : n;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const m of [this.omiCapBot, this.omiCapTop, this.omiCapLine]) {
      m.count = caps ? n : 0;
      m.instanceMatrix.needsUpdate = true;
    }
    if (colors && this.slipBody.instanceColor) this.slipBody.instanceColor.needsUpdate = true;
    if (colors && this.omiCapBot.instanceColor) this.omiCapBot.instanceColor.needsUpdate = true;
  }

  // 從籤堆裡拿一張：洞口正下方、比較上面的那張 → 回傳它的位置、角度
  _takeSlip() {
    const P = this.slips;
    const hole = SPECS.omikuji.hole;
    let best = -1;
    let score = Infinity;
    P.forEach((c, i) => {
      const s = Math.hypot(c.p.x - hole.x, c.p.z - hole.z) - c.p.y * 1.5;
      if (s < score) (score = s), (best = i);
    });
    if (best < 0) return { p: new THREE.Vector3(hole.x, 0.12, hole.z), q: new THREE.Quaternion() };
    const [c] = P.splice(best, 1);
    if (this.omiWrap !== 'capsule') this._settleSlips(P); // 壓在它上面的掉下來
    this._syncSlips(true);
    return c;
  }

  // 一張籤：n 段直的紙（每段上緣是摺線），正面＝籤紙（app 畫好的 canvas），背面＝和紙的反面
  //   折起來＝每一段相對上一段轉 ±(π−ε)（像手風琴）；正面的字在打開的時候才淡入（折著看不到內容）
  _makeSlip(front, rarity) {
    const { w: W, h: Ht, n: N } = SLIP3;
    const ph = Ht / N;
    const tex = front ? canvasTex(front) : null;
    if (tex) tex.anisotropy = 8;
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    const mats = [];
    const pivots = [];
    let parent = inner;
    for (let i = 0; i < N; i++) {
      const pv = new THREE.Group();
      pv.position.set(0, i === 0 ? ph / 2 : -ph, 0);
      parent.add(pv);
      const v0 = 1 - (i + 1) / N;
      const v1 = 1 - i / N;
      const geo = new THREE.PlaneGeometry(W, ph);
      geo.translate(0, -ph / 2, 0);
      const uv = geo.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * (v1 - v0));
      const fm = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, foldMap: { value: this.foldTex }, uV: { value: new THREE.Vector2(v0, v1) }, uShow: { value: 0 }, uOpacity: { value: 1 }, uWhite: { value: 0 }, uHas: { value: tex ? 1 : 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map, foldMap; uniform vec2 uV; uniform float uShow, uOpacity, uWhite, uHas; varying vec2 vUv;
          void main(){ vec3 t = uHas > 0.5 ? texture2D(map, vUv).rgb : vec3(0.985, 0.965, 0.92);
            // 折著的時候：外面那一面是紙包的印刷（紅框＋御神籤）
            vec3 closed = texture2D(foldMap, vec2(vUv.x, (vUv.y - uV.x) / (uV.y - uV.x))).rgb;
            vec3 col = mix(closed, t, uShow);
            col = mix(col, vec3(1.0), uWhite);
            gl_FragColor = vec4(col, uOpacity);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        side: THREE.FrontSide,
      });
      const faceM = new THREE.Mesh(geo, fm);
      faceM.renderOrder = 6;
      const bm = new THREE.MeshToonMaterial({ gradientMap: this.ramp, map: this.slipBackTex, transparent: true });
      const backM = new THREE.Mesh(geo, bm);
      backM.rotation.y = Math.PI;
      backM.renderOrder = 6;
      backM.castShadow = true;
      pv.add(faceM, backM);
      mats.push(fm, bm);
      pivots.push(pv);
      parent = pv;
    }
    const U = (root.userData = {
      slip: true,
      card: true, // fx.charge：光在後面、左右晃（不整個轉，免得先看到內容）
      pivots,
      inner,
      mats,
      fold: 1,
      setFold(f) {
        // f＝1 全折、0 全開；從上往下一段一段打開
        U.fold = f;
        const e = 0.035;
        for (let i = 1; i < N; i++) {
          const k = THREE.MathUtils.clamp(f * (N - 1) - (N - 1 - i), 0, 1);
          // 第 1 段折到第 0 段後面、第 2 段再往後…：最外面朝鏡頭的是第 0 段的正面（紙包的印刷）
          pivots[i].rotation.x = (i % 2 ? 1 : -1) * (Math.PI - e) * k;
          pivots[i].position.z = (i % 2 ? -1 : 1) * 0.0012 * k;
        }
        // 打開時整張往上移，讓它一直在畫面中間
        inner.position.y = (ph * (N - 1) * (1 - f)) / 2;
      },
      setShow(v) {
        for (let i = 0; i < N; i++) mats[i * 2].uniforms.uShow.value = THREE.MathUtils.clamp(v * (N + 1) - i, 0, 1);
      },
      setOpacity(o) {
        for (const m of mats) {
          if (m.uniforms) m.uniforms.uOpacity.value = o;
          else m.opacity = o;
        }
        if (U.cap && o < 1) U.cap.visible = o > 0.5; // 轉蛋（10 連格子裡淡出時）
      },
      setWhite(v) {
        for (const m of mats) if (m.uniforms) m.uniforms.uWhite.value = v;
      },
      setSil() {},
      dispose() {
        tex?.dispose();
        for (const m of mats) m.dispose();
        for (const pv of pivots) for (const ch of pv.children) ch.geometry?.dispose?.();
      },
    });
    U.setFold(1);
    if (this.omiWrap === 'capsule') {
      const cap = this._makeCapsule(this.capMats[Math.floor(Math.random() * this.capMats.length)]);
      cap.scale.setScalar(1.05);
      root.add(cap);
      U.cap = cap;
      inner.scale.setScalar(0.62); // 紙包縮小放進轉蛋裡
    }
    if (rarity >= 2) this.show?.addGlints(root, rarity === 3 ? 5 : 3, true);
    return root;
  }

  // 打開轉蛋：上下兩半往外飛、淡掉，裡面的紙包長回原本大小
  _popSlipCap(g, dur = 0.55) {
    const U = g.userData;
    const cap = U.cap;
    if (!cap) return Promise.resolve();
    U.cap = null;
    const { top, bot } = cap.userData;
    const ft = this._fadeable(top);
    const fb = this._fadeable(bot);
    const t0 = top.position.clone();
    const b0 = bot.position.clone();
    sfx.pop();
    return this.tween(dur, (k) => {
      const e = ease.out(k);
      top.position.copy(t0).add(_v2.set(0, 0.12 * e, 0.03 * e));
      top.rotation.set(-1.3 * e, 0, -0.6 * e);
      bot.position.copy(b0).add(_v2.set(0, -0.12 * e * e, 0.02 * e));
      bot.rotation.set(0.9 * e, 0, 0.5 * e);
      ft(k);
      fb(k);
      U.inner.scale.setScalar(0.62 + 0.38 * e);
    }).then(() => cap.removeFromParent());
  }

  // 出籤：手伸進去 → 一張籤從籤堆浮起來、穿過圓洞、停在洞口上方（輕輕飄）
  async _dispenseSlip(rarity, front) {
    const sp = SPECS.omikuji;
    const from = this._takeSlip();
    const g = this._makeSlip(front, rarity);
    g.scale.setScalar(SLIP3.pile);
    g.position.copy(from.p);
    g.quaternion.copy(from.q);
    this.root.add(g);
    const c = (this.exitCap = { g, rarity, fake: false, shown: rarity, slip: true });
    const q0 = g.quaternion.clone();
    const qUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42, 0.3, 0.06)); // 稍微朝上、朝鏡頭
    const p0 = from.p.clone();
    const p1 = new THREE.Vector3(sp.hole.x, sp.hole.y - 0.06, sp.hole.z);
    const p2 = new THREE.Vector3(sp.hole.x + 0.04, sp.hole.y + 0.3, sp.hole.z + 0.26); // 洞口上方、往前一點（看得清楚）
    sfx.slipOut();
    this.shakePile(0.6);
    await this.tween(1.05, (k) => {
      const e = ease.inOut(k);
      // 先往洞口下面靠，再一口氣拉上來
      if (e < 0.5) g.position.lerpVectors(p0, p1, e * 2);
      else g.position.lerpVectors(p1, p2, ease.out((e - 0.5) * 2));
      g.quaternion.slerpQuaternions(q0, qUp, Math.min(1, e * 1.4));
      g.scale.setScalar(SLIP3.pile + (2.1 - SLIP3.pile) * e);
    });
    this.wobble = 0.5;
    c.float = g.position.clone();
    c.fq = g.quaternion.clone();
    if (rarity >= 2) {
      this.exitLight.color.set(rarity === 3 ? '#fff0c0' : '#d9b8ff');
      this.exitGlow = rarity;
    }
  }

  // 10 連：一張一張從洞口拉出來 → 飛到格子（折著）
  _slipToGrid(i, n, rarity, front) {
    const sp = SPECS.omikuji;
    const from = this._takeSlip();
    const g = this._makeSlip(front, rarity);
    g.scale.setScalar(SLIP3.pile);
    g.position.copy(from.p);
    g.quaternion.copy(from.q);
    this.root.add(g);
    const c = { g, rarity, fake: false, shown: rarity, i, slip: true };
    g.userData.gridIdx = i;
    this.gridN = n;
    this.grid = this.grid || [];
    this.grid[i] = c;
    this.gridSlots = this.gridSlots || [];
    const p0 = from.p.clone();
    const p1 = new THREE.Vector3(sp.hole.x, sp.hole.y + 0.12, sp.hole.z);
    const q0 = g.quaternion.clone();
    sfx.slipOut();
    return this.tween(0.36, (k) => {
      g.position.lerpVectors(p0, p1, ease.out(k));
      g.quaternion.slerpQuaternions(q0, new THREE.Quaternion(), k);
    }).then(() => {
      if (this.grid[i] !== c) return this._dropObj(g);
      const fromW = g.getWorldPosition(new THREE.Vector3());
      const qW = g.getWorldQuaternion(new THREE.Quaternion());
      const s0 = g.getWorldScale(new THREE.Vector3()).x;
      this.root.remove(g);
      this.fx.add(g);
      g.position.copy(fromW);
      g.quaternion.copy(qW);
      g.scale.setScalar(s0);
      const slot = this._gridSlot(i, n);
      this.gridSlots[i] = slot;
      const mid = fromW.clone().lerp(slot.pos, 0.5).add(new THREE.Vector3(0, 0.22, 0));
      const qTo = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.2, 0.05)));
      return this.tween(0.45, (k) => {
        const e = ease.out(k);
        const a = fromW.clone().lerp(mid, e);
        const b = mid.clone().lerp(slot.pos, e);
        g.position.copy(a.lerp(b, e));
        g.quaternion.slerpQuaternions(qW, qTo, e);
        g.scale.setScalar(s0 + (slot.scale - s0) * e);
      }).then(() => {
        const s = this.gridSlots[i];
        if (!s || this.grid[i] !== c) return;
        c.home = s.pos.clone();
        c.q = g.quaternion.clone();
        g.position.copy(s.pos);
        g.scale.setScalar(s.scale);
        g.userData.s0 = s.scale;
        if (rarity >= 2) this.show.gridGlow(c, rarity);
      });
    });
  }

  // 打開籤：照吉凶跑演出（大吉＝SSR 的集氣、大凶＝SR 的紫光），最後一段一段攤開
  async _unfoldSlip(c) {
    const g = c.g;
    const r = c.rarity;
    const T = TIERS[r];
    const home = c.home;
    const U = g.userData;
    if (c.glow) {
      c.glow.removeFromParent();
      c.glow = null;
    }
    if (T.dim) this.setDim(T.dim, r >= 2 ? 0.6 : 0.3);
    if (T.charge) await this.show.charge(c, home, r);
    else {
      sfx.shake();
      await this.tween(this.reduced ? 0.2 : T.shake, (k) => {
        const a = Math.sin(k * 38) * (0.06 + r * 0.03) * k;
        g.position.set(home.x + Math.sin(k * 45) * 0.006 * k, home.y, home.z);
        g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_z, a));
      });
    }
    if (r >= 2 && !this.reduced) {
      U.setWhite(1);
      sfx.hitstop?.();
      await this.after(r === 3 ? 0.28 : 0.14);
      U.setWhite(0);
    }
    if (r >= 2) {
      this.punch(r === 3 ? 7 : 4);
      this.wobble = 2;
    }
    this.show.burst(r, home);
    this.cb.onBurst?.(r);
    if (U.cap) await this._popSlipCap(g); // 轉蛋：殼先開，紙包再攤開
    // 攤開：正對鏡頭、放大到畫面高度的六成多，從上往下一段一段打開，字跟著淡入
    const q0 = g.quaternion.clone();
    const qTo = this.camera.quaternion.clone();
    const s0 = g.scale.x;
    const H = 2 * this.camera.position.distanceTo(home) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = Math.min((H * 0.66) / SLIP3.h, (H * this.camera.aspect * 0.8) / SLIP3.w);
    const dur = this.reduced ? 0.3 : [0.9, 1.0, 1.2, 1.35][r];
    let lastSeg = -1;
    await this.tween(dur, (k) => {
      const e = ease.inOut(k);
      U.setFold(1 - e);
      U.setShow(e);
      const seg = Math.floor(e * (SLIP3.n - 1) + 0.15);
      if (seg !== lastSeg && seg < SLIP3.n) {
        lastSeg = seg;
        sfx.unfold(seg);
      }
      g.quaternion.slerpQuaternions(q0, qTo, ease.out(Math.min(1, k * 1.6)));
      g.position.copy(home);
      g.scale.setScalar(s0 + (fit - s0) * e);
    });
    U.setShow(1);
    c.q = g.quaternion.clone();
    U.baseQ = c.q.clone();
    this.revealed = c;
    await this.after(this.reduced ? 0.3 : Math.max(0.3, T.reveal - dur));
    this.show.persist(r, home);
  }

  // 開店頁「▶ 預覽」：在鏡頭前放一次這個稀有度的演出（含店家選的特殊演出）
  previewFx(r) {
    if (!this.loaded || this._previewing) return;
    this._previewing = true;
    const at = this._inFront(1.2, -0.02);
    this.setDim(TIERS[r].dim, 0.4);
    this.show.burst(r, at);
    this.after(3.2, () => {
      this.setDim(0, 0.8);
      this.show.endPersist?.();
      this._previewing = false;
    });
  }

  // 10 連：N、R 的籤在格子裡啵一下 → 換成吉凶的小牌（revealInGrid）
  _slipPopInGrid(c, i, card) {
    const g = c.g;
    sfx.unfold(1);
    this.show.miniBurst(c.rarity, c.home);
    this.grid[i] = null;
    if (card) this.after(0.12).then(() => this.revealInGrid(i, card));
    const s0 = g.scale.x;
    return this.tween(0.35, (k) => {
      g.scale.setScalar(s0 * (1 + 0.3 * k));
      g.userData.setOpacity(1 - k);
    }).then(() => this._dropObj(g));
  }

  // 卡片：正面＝這次抽到的獎品（app 畫好的 canvas），背面＝shown 等級的卡背（SSR 可能先裝成金卡）
  // front＝drawCardLayers 的三層（圖片窗做 3D 視差）或一張平面 canvas
  _makeCard(front, rarity, shown) {
    // 正面：N 一般、R ホロ、SR／SSR 照店家選的表面加工（cardkit.js）；カード工房的卡自己選了（front.fin）就用它
    const fm = front?.fin ? (FIN_MODE[front.fin] ?? rarity) : (this.frontModes?.[rarity] ?? rarity);
    const bm = this.backModes?.[shown] ?? (shown >= 3 ? 3 : shown === 2 ? 2 : 0);
    let layers = null;
    let face = front;
    if (front?.frame) {
      face = front.frame;
      const { w: W, h: H } = CARD_PX;
      const { x, y, w, h } = CARD_WIN;
      const depth = cardTex(front.depth);
      depth.colorSpace = THREE.NoColorSpace;
      layers = { photo: cardTex(front.photo), bg: front.bg ? cardTex(front.bg) : null, depth, over: cardTex(front.over), win: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H], framed: !!front.framed };
    }
    const edge = fm === 3 ? this.cardEdgeGold : fm > 0 ? this.cardEdgeSilver : this.cardEdge;
    const g = makeCard(cardTex(face || drawCardBack(null, 0)), this.backTex[shown], fm, bm, edge || this.cardEdge, layers, rarity);
    addOutline(g.userData.edge, 0.0024, this.hullCache);
    // 亮點星芒：正面的放在圖上最亮的幾個點（holo.js 的 brightSpots，跟 CSS 閃卡同一套），背面照舊隨便放
    let pts = null;
    if (front?.photo && rarity >= 2) {
      const [u0, v0, u1, v1] = layers.win;
      pts = brightSpots(front.photo, rarity === 3 ? 5 : 3).map((p) => ({ x: (u0 + p.x * (u1 - u0) - 0.5) * CARD_W, y: (v1 - p.y * (v1 - v0) - 0.5) * CARD_H }));
    }
    if (shown >= 2) this.show.addGlints(g, shown === 3 ? 6 : 4, true, pts);
    g.userData.upgrade = () => {
      g.userData.setBack(this.backTex[3], this.backModes?.[3] ?? 3);
      this.show.addGlints(g, 3, true);
    };
    return g;
  }

  // 店家選的 SR／SSR 表面加工 → 3D 卡面的閃光（cardkit uMode）
  setFrontFinish(fin) {
    this.frontModes = [0, 1, FIN_MODE[fin?.sr] ?? 2, FIN_MODE[fin?.ssr] ?? 3];
  }

  // 店家自訂的卡背（decor.drawCardBack 的 back）→ 重做 4 個稀有度的卡背貼圖（已經發出去的卡不變）
  setCardBack(back) {
    const key = back ? `${back.key || ''}|${back.text || ''}|${back.color || ''}|${back.sr || ''}|${back.ssr || ''}` : '';
    if (key === this.backKey || !this.art) return;
    this.backKey = key;
    this.backTex = [0, 0, 2, 3].map((tier) => cardTex(drawCardBack(this.art.cardback, tier, back)));
    // 加工 → 卡背的 3D 閃光（cardkit uMode）：金箔＝金框亮粉、彩虹＝彩虹亮粉、雷射＝斜格虹光、銀箔＝銀色亮粉、不加工＝沒有
    const MODE = { gold: 3, rainbow: 4, holo: 2, silver: 5, none: 0 };
    this.backModes = [0, 0, MODE[back?.sr || 'gold'] ?? 3, MODE[back?.ssr || 'rainbow'] ?? 4];
  }

  _dropObj(g) {
    g.removeFromParent();
    g.userData.dispose?.();
  }

  // 翻開的那張卡（單抽）：關掉結果卡時收掉
  dismissShown() {
    const c = this.revealed;
    if (!c) return;
    this.revealed = null;
    const g = c.g;
    const s0 = g.scale.x;
    this.tween(0.35, (k) => {
      g.scale.setScalar(s0 * (1 - 0.3 * k));
      g.userData.setOpacity?.(1 - k);
    }).then(() => this._dropObj(g));
  }

  _tex(url) {
    return new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.flipY = false; // glTF 的 UV 原點在左上
      return t;
    });
  }

  // ---------- 外觀 ----------
  setTheme(key) {
    const t = THEMES[key] || THEMES.red;
    this.theme = t;
    this.themeKey = key;
    if (!this.loaded) return;
    this.mats.body.color.set(t.body);
    this.mats.lid.color.set(t.lid);
    this.mats.handle.color.set(t.handle);
    const cm = this.cmats;
    if (cm) {
      cm.body.color.set(t.body);
      cm.plain.color.set(t.body);
      cm.frame.color.set(t.lid);
      cm.lid.color.set(t.lid);
      cm.handle.color.set(t.handle);
    }
    this._applyOmiWood();
  }

  // おみくじ箱：店家自己調的木頭顏色（沒有就照主題色）
  setOmiWood(c) {
    this.omiWoodC = /^#[0-9a-f]{6}$/i.test(c || '') ? c : '';
    this._applyOmiWood();
  }

  _applyOmiWood() {
    const om = this.omats;
    if (!om) return;
    const w = OMI_WOOD[this.themeKey] || OMI_WOOD.white;
    const body = this.omiWoodC || w.body;
    om.body.color.set(body);
    om.floor.color.set(body);
    om.sign.color.set(this.omiWoodC ? _c.set(body).multiplyScalar(0.94).getStyle() : w.sign);
  }

  // 介面主題（亮／暗）的舞台顏色；賣家選了背景就以背景為主
  setStage(bg, floor) {
    this.themeBg = new THREE.Color(bg);
    this.themeFloor = new THREE.Color(floor);
    this._applyBackground();
  }

  // ---------- 背景（壁紙） ----------
  // bg：{ k: 'preset', id } / { k: 'color', c } / { k: 'img' }；image：預設場景或自己的圖（已經處理好的 Image／Canvas）
  setBackground(bg, image = null) {
    this.bg = bg || { k: 'preset', id: 'plain' };
    if (this.bgTex) this.bgTex.dispose();
    this.bgTex = null;
    if (image) {
      this.bgTex = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image);
      this.bgTex.colorSpace = THREE.SRGBColorSpace;
      this.bgTex.needsUpdate = true;
    }
    this._applyBackground();
  }

  _applyBackground() {
    if (!this.themeBg) return;
    const bg = this.bg || { k: 'preset', id: 'plain' };
    if (this.bgTex) {
      // 圖片背景：照螢幕比例裁切填滿；地板不畫，只留影子
      this.scene.background = this.bgTex;
      this.floor.visible = false;
      this._fitBg();
    } else {
      const c = bg.k === 'color' ? new THREE.Color(bg.c) : this.themeBg.clone();
      this.scene.background = c;
      this.stageBg = c.clone();
      this.stageFloor = bg.k === 'color' ? c.clone().multiplyScalar(0.92) : this.themeFloor.clone();
      this.scene.fog.color.copy(c);
      this.floor.visible = true;
      this.floorMat.color.copy(this.stageFloor);
    }
    if (this.dim) this.dimTween = { from: this.dim, to: this.dim, t: 0, dur: 0.01 };
  }

  _fitBg() {
    const t = this.bgTex;
    const im = t?.image;
    if (!im) return;
    const A = this.camera.aspect;
    const I = (im.width || 1) / (im.height || 1);
    if (A > I) {
      t.repeat.set(1, I / A);
      t.offset.set(0, (1 - I / A) / 2);
    } else {
      t.repeat.set(A / I, 1);
      t.offset.set((1 - A / I) / 2, 0);
    }
  }

  _decal(w, h, pos, rotY = 0) {
    const mat = new THREE.MeshToonMaterial({ gradientMap: this.ramp, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    (this._dg || this.root).add(mesh);
    return mesh;
  }

  _buildDecals() {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.decals = {
      lid: this._decal(0.66, 0.082, V(0, 1.319, 0.4225)),
      price: this._decal(0.13, 0.13, V(-0.272, 0.402, FRONT + 0.0015)),
      arrow: this._decal(0.46, 0.46, V(HANDLE_C.x, HANDLE_C.y, FRONT + 0.001)),
      exit: this._decal(0.1, 0.05, V(0.035, 0.272, FRONT + 0.0015)),
      ret: this._decal(0.1, 0.05, V(0.165, 0.218, FRONT + 0.0015)),
      card: this._decal(0.68, 0.45, V(0, 1.035, -0.117)),
      sideL: this._decal(0.66, 0.56, V(-0.3535, 0.37, -0.06), -Math.PI / 2),
      sideR: this._decal(0.66, 0.56, V(0.3535, 0.37, -0.06), Math.PI / 2),
      stripL: this._decal(0.24, 0.48, V(-0.3535, 0.99, -0.3), -Math.PI / 2),
      stripR: this._decal(0.24, 0.48, V(0.3535, 0.99, -0.3), Math.PI / 2),
    };
    // 台紙不受光（像有背光），不然整張落在上蓋的影子裡
    this.decals.card.material = new THREE.MeshBasicMaterial({ transparent: true });
    this.decals.card.receiveShadow = false;
    // 透明窗正面的兩道斜反光（動畫風的玻璃）
    const shine = document.createElement('canvas');
    shine.width = 512;
    shine.height = 400;
    const sg = shine.getContext('2d');
    sg.fillStyle = 'rgba(255,255,255,0.55)';
    sg.beginPath();
    sg.moveTo(70, 0);
    sg.lineTo(150, 0);
    sg.lineTo(40, 400);
    sg.lineTo(-40, 400);
    sg.fill();
    sg.fillStyle = 'rgba(255,255,255,0.35)';
    sg.beginPath();
    sg.moveTo(185, 0);
    sg.lineTo(215, 0);
    sg.lineTo(105, 400);
    sg.lineTo(75, 400);
    sg.fill();
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.54),
      new THREE.MeshBasicMaterial({ map: canvasTex(shine), transparent: true, depthWrite: false }),
    );
    sh.position.set(0, 0.99, 0.4235);
    sh.renderOrder = 12;
    (this._dg || this.root).add(sh);
    this.refreshLabels();
  }

  // 箭頭、取出口、退幣口的字（換語言時重畫）
  refreshLabels() {
    const set = (d, c) => {
      const old = this.decals[d].material.map;
      this.decals[d].material.map = canvasTex(c);
      this.decals[d].material.needsUpdate = true;
      if (old) old.dispose();
    };
    set('arrow', drawArrow());
    if (this.decals.exit) set('exit', drawLabel(t(this.kind === 'card' ? 'd.exitCard' : 'd.exit'), 'left'));
    if (this.decals.label) set('label', drawPanelLabel(this._omiCfg));
    if (this.decals.ret) set('ret', drawLabel(t('d.return'), 'down', '#2f6bdb'));
  }

  // 機台名稱、價錢、陣容改了 → 重畫貼紙與台紙（bimg＝台紙用的自己的圖，解碼好的）
  //   台紙上每個獎品的位置記在 _boardHit（開店頁點台紙上的獎品 → cb.onBoardItem）
  updateDecor(cfg, thumbs, bimg = null) {
    if (!this.loaded) return;
    const t = this.theme || THEMES.red;
    const set = (d, c) => {
      const old = this.decals[d].material.map;
      this.decals[d].material.map = canvasTex(c);
      this.decals[d].material.needsUpdate = true;
      if (old) old.dispose();
    };
    if (this.kind === 'omikuji') {
      this._omiCfg = cfg;
      set('board', drawSign(cfg, priceText(cfg.price), bimg)); // bimg＝店家自己的看板圖（解碼好的）
      set('price', drawPrice(cfg, this.art.badge));
      set('label', drawPanelLabel(cfg));
      this._boardCanvas = null;
      this._boardHit = null;
      for (const d of Object.values(this.decals)) d.material.needsUpdate = true;
      return;
    }
    set('lid', drawLid(cfg, t, this.art.banner));
    set('price', drawPrice(cfg, this.art.badge));
    if (this.kind === 'card') {
      const b = drawBoard(cfg, thumbs, bimg);
      set('board', b);
      this._boardCanvas = b; // 開店頁的台紙預覽也用這張
      this._boardHit = { mesh: this.decals.board, w: b.width, h: b.height, cells: b.cells };
      if (!this.kinds.card.sideDone) {
        const side = drawSide(this.art.cside || this.art.side, 780, 550, t);
        set('sideL', side);
        set('sideR', side);
        this.kinds.card.sideDone = true;
      }
      for (const d of Object.values(this.decals)) d.material.needsUpdate = true;
      return;
    }
    const b = drawCard(cfg, thumbs, this.art.card, bimg);
    set('card', b);
    this._boardCanvas = b;
    this._boardHit = { mesh: this.decals.card, w: b.width, h: b.height, cells: b.cells };
    if (!this._sideDone) {
      const side = drawSide(this.art.side, 768, 652, t);
      set('sideL', side);
      set('sideR', side);
      const strip = drawSide(this.art.strip || this.art.side, 256, 512, t);
      set('stripL', strip);
      set('stripR', strip);
      this._sideDone = true;
    }
    for (const d of Object.values(this.decals)) d.material.needsUpdate = true;
  }

  // ---------- 窗內扭蛋 ----------
  // 單顆扭蛋（出口、鏡頭前用）
  _makeCapsule(mat) {
    const g = new THREE.Group();
    const gold = mat.isMeshMatcapMaterial; // 黃金扭蛋：上下兩半都是金的
    const top = new THREE.Mesh(this.capTopGeo, gold ? mat : this.mats.capClear);
    const bot = new THREE.Mesh(this.capBotGeo, mat);
    top.renderOrder = 2;
    bot.castShadow = true;
    addOutline(bot, 0.0028, this.hullCache);
    if (gold) {
      top.castShadow = true;
      addOutline(top, 0.0028, this.hullCache);
      this.show?.addGlints(g, mat === this.capRare[3] ? 6 : 4);
    }
    g.add(top, bot);
    g.userData = { top, bot, gold };
    return g;
  }

  // 開殼時把兩半的材質換成可以淡出的複本（透明殼是自訂 shader，金殼是 matcap）
  _fadeable(m) {
    m.material = m.material.clone();
    m.material.transparent = true;
    const line = m.getObjectByName('outline');
    if (line) {
      line.material = line.material.clone();
      line.material.transparent = true;
    }
    return (k) => {
      if (m.material.uniforms) m.material.uniforms.uOpacity.value = 1 - k;
      else m.material.opacity = 1 - k;
      if (line) line.material.uniforms.uOpacity.value = 1 - k;
    };
  }

  // 窗內的扭蛋：顆數＝剩下的商品數（最多 MAX_PILE 顆）
  // 數量一多就一顆一顆畫太慢 → InstancedMesh 三層（彩色下半、透明上半、描邊），各一次 draw call
  _buildPile() {
    const N = MAX_PILE;
    this.pileBot = new THREE.InstancedMesh(this.capBotGeo, new THREE.MeshToonMaterial({ gradientMap: this.ramp }), N);
    this.pileBot.castShadow = true;
    this.pileTop = new THREE.InstancedMesh(this.capTopGeo, this.mats.capClear, N);
    this.pileTop.renderOrder = 2;
    this.pileLine = new THREE.InstancedMesh(hullGeometry(this.capBotGeo), outlineMat(0.0028), N);
    for (const m of [this.pileBot, this.pileTop, this.pileLine]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
    this.pileBot.setColorAt(0, _c.set(CAP_COLORS[0])); // 先建立 instanceColor
    this.capR = CAP_R;
    this.stirW = 0;
    this.wobble = 0;
    this._lastHA = 0;
    this._grid = new Map();
  }

  // count＝現在剩幾顆；total＝這台機器原本有幾顆（決定扭蛋大小，轉的過程中大小不變）
  setPile(count, total = count) {
    if (!this.loaded || this.kind === 'card') return;
    if (this.kind === 'omikuji') return this._setSlipPile(count, total);
    const n = Math.min(count, MAX_PILE);
    const r = capRadius(Math.min(Math.max(total, count), MAX_PILE));
    if (Math.abs(r - this.capR) > 1e-4 || !this.pile.length) {
      // 大小變了 → 全部重新排
      this.capR = r;
      this.pile = [];
      this._addCapsules(n);
      this._settle();
    } else if (n > this.pile.length) {
      this._addCapsules(n - this.pile.length);
      this._settle();
    } else if (n < this.pile.length) {
      // 拿掉最上面的
      this.pile.sort((a, b) => a.p.y - b.p.y);
      this.pile.length = n;
    }
    this.colorDirty = true;
    this._syncPile();
  }

  // 從目前最高的地方往上，一層一層排格點（避開斜坡）
  _addCapsules(k) {
    const R = this.capR;
    const step = R * 2.08;
    const y0 = this.pile.length ? Math.max(...this.pile.map((c) => c.p.y)) + step : PLANES[0].d + R + 0.002;
    let placed = 0;
    for (let layer = 0; placed < k && layer < 80; layer++) {
      const y = Math.min(y0 + layer * step, WIN.top - R);
      const off = layer % 2 ? R * 0.5 : 0; // 每層錯開半顆
      for (let x = -WIN.x + R + off; x <= WIN.x - R + 1e-6 && placed < k; x += step) {
        for (let z = WIN.back + R + off; z <= WIN.front - R + 1e-6 && placed < k; z += step) {
          const p = new THREE.Vector3(x + rnd(-0.003, 0.003), y, z + rnd(-0.003, 0.003));
          if (PLANES.some((pl) => pl.n.dot(p) < pl.d + R - 1e-4)) continue;
          this.pile.push({
            p,
            v: new THREE.Vector3(),
            q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.7, 0.7), rnd(0, 6.28), rnd(-0.7, 0.7))),
            col: (this.pile.length * 5 + 3) % CAP_COLORS.length,
            falling: false,
          });
          placed++;
        }
      }
    }
  }

  // 先讓它們落定，第一眼看到的就是堆好的樣子
  _settle() {
    const steps = this.pile.length > 150 ? 200 : 300;
    for (let i = 0; i < steps; i++) this._physics(1 / 120);
    for (const c of this.pile) c.v.set(0, 0, 0);
  }

  // 每轉 45°：轉盤的凹槽把底層扭蛋頂一下
  shakePile(k = 1) {
    if (this.kind === 'card') return;
    if (this.kind === 'omikuji') {
      this.omiShake = Math.min(1.5, (this.omiShake || 0) + k);
      return;
    }
    const R = this.capR;
    for (const c of this.pile) {
      if (c.falling) continue;
      const h = c.p.y - floorY(c.p.z);
      const near = h < R * 2.2 ? 1 : h < R * 4.5 ? 0.45 : 0.15; // 越底層頂得越大力
      c.v.x += rnd(-0.35, 0.35) * k * near;
      c.v.y += rnd(0.35, 0.9) * k * near;
      c.v.z += rnd(-0.3, 0.3) * k * near;
    }
  }

  _physics(dt) {
    const P = this.pile;
    if (!P.length) return;
    const R = this.capR;
    const stir = this.stirW;
    for (let i = P.length - 1; i >= 0; i--) {
      const c = P[i];
      c.v.y -= 9.8 * dt;
      if (c.falling) {
        // 從出蛋孔掉下去（掉進機身裡就看不到了）
        c.p.x += (HOLE.x - c.p.x) * Math.min(1, dt * 14);
        c.p.z += (HOLE.z - c.p.z) * Math.min(1, dt * 14);
        c.p.y += c.v.y * dt;
        if (c.p.y < PLANES[0].d - R * 3) {
          P.splice(i, 1);
          this.colorDirty = true;
        }
        continue;
      }
      c.v.multiplyScalar(0.998);
      // 轉盤：把手轉的時候，底層扭蛋跟著轉盤繞圈，偶爾被凹槽頂起來
      if (stir > 0.05 && c.p.y - floorY(c.p.z) < R * 1.9) {
        const rx = c.p.x - DISC.x;
        const rz = c.p.z - DISC.z;
        const rho = Math.hypot(rx, rz) + 1e-4;
        const tx = -rz / rho;
        const tz = rx / rho;
        const target = stir * Math.min(rho, 0.3);
        const vt = c.v.x * tx + c.v.z * tz;
        const k = Math.min(1, 12 * dt);
        c.v.x += tx * (target - vt) * k;
        c.v.z += tz * (target - vt) * k;
        if (Math.random() < stir * dt * 1.2) c.v.y += rnd(0.25, 0.6);
      }
      c.p.addScaledVector(c.v, dt);
    }
    const n = P.length;
    const inv = 1 / (2 * R);
    const grid = this._grid;
    for (let it = 0; it < 4; it++) {
      for (const c of P) {
        if (c.falling) continue;
        const p = c.p;
        const v = c.v;
        if (p.x < -WIN.x + R) (p.x = -WIN.x + R), v.x < 0 && (v.x *= -0.3);
        if (p.x > WIN.x - R) (p.x = WIN.x - R), v.x > 0 && (v.x *= -0.3);
        if (p.z < WIN.back + R) (p.z = WIN.back + R), v.z < 0 && (v.z *= -0.3);
        if (p.z > WIN.front - R) (p.z = WIN.front - R), v.z > 0 && (v.z *= -0.3);
        if (p.y > WIN.top - R) (p.y = WIN.top - R), v.y > 0 && (v.y *= -0.3);
        for (const pl of PLANES) {
          const pen = pl.d + R - pl.n.dot(p);
          if (pen > 0) {
            p.addScaledVector(pl.n, pen);
            const vn = v.dot(pl.n);
            if (vn < 0) v.addScaledVector(pl.n, -1.3 * vn);
            v.multiplyScalar(0.985); // 摩擦
          }
        }
      }
      // 空間格子：只檢查相鄰格子裡的扭蛋（幾百顆也不會慢）
      grid.clear();
      for (let i = 0; i < n; i++) {
        const c = P[i];
        if (c.falling) continue;
        const key = cellKey(c.p, inv, 0, 0, 0);
        const b = grid.get(key);
        if (b) b.push(i);
        else grid.set(key, [i]);
      }
      for (let i = 0; i < n; i++) {
        const a = P[i];
        if (a.falling) continue;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const b = grid.get(cellKey(a.p, inv, dx, dy, dz));
              if (!b) continue;
              for (const j of b) {
                if (j <= i) continue;
                const o = P[j];
                const d = _v1.subVectors(o.p, a.p);
                const dist = d.length();
                if (dist < 2 * R && dist > 1e-6) {
                  d.multiplyScalar(1 / dist);
                  const pen = (2 * R - dist) / 2;
                  a.p.addScaledVector(d, -pen);
                  o.p.addScaledVector(d, pen);
                  const vr = _v2.subVectors(o.v, a.v).dot(d);
                  if (vr < 0) {
                    const imp = -vr * 0.6;
                    a.v.addScaledVector(d, -imp);
                    o.v.addScaledVector(d, imp);
                  }
                }
              }
            }
      }
    }
    // 滾動：用水平速度推算轉動
    for (const c of P) {
      const sp = Math.hypot(c.v.x, c.v.z);
      if (sp > 1e-3) {
        _v1.set(c.v.z, 0, -c.v.x).normalize();
        _q.setFromAxisAngle(_v1, (sp * dt) / R);
        c.q.premultiply(_q);
      }
      if (!c.falling && c.v.lengthSq() < 0.0004) c.v.multiplyScalar(0.8); // 快停了就讓它停
    }
  }

  _syncPile() {
    if (!this.pileBot) return;
    const P = this.pile;
    const n = Math.min(P.length, MAX_PILE);
    const s = this.capR / CAP_R;
    _s.set(s, s, s);
    for (let i = 0; i < n; i++) {
      const c = P[i];
      _m.compose(c.p, c.q, _s);
      this.pileBot.setMatrixAt(i, _m);
      this.pileTop.setMatrixAt(i, _m);
      this.pileLine.setMatrixAt(i, _m);
      if (this.colorDirty) this.pileBot.setColorAt(i, _c.set(CAP_COLORS[c.col]));
    }
    for (const m of [this.pileBot, this.pileTop, this.pileLine]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.colorDirty) this.pileBot.instanceColor.needsUpdate = true;
    this.colorDirty = false;
  }

  // 出蛋：最靠近出蛋孔、最底層的那一顆真的從孔掉下去；回傳它的顏色
  _takeFromPile() {
    const P = this.pile;
    let best = -1;
    let score = Infinity;
    P.forEach((c, i) => {
      if (c.falling) return;
      const s = Math.hypot(c.p.x - HOLE.x, c.p.z - HOLE.z) + (c.p.y - floorY(c.p.z)) * 2;
      if (s < score) (score = s), (best = i);
    });
    if (best < 0) return null;
    const c = P[best];
    c.falling = true;
    c.v.set(0, -0.4, 0);
    // 旁邊的扭蛋被帶一下，往洞的方向滑
    for (const o of P) {
      if (o.falling) continue;
      const d = Math.hypot(o.p.x - c.p.x, o.p.z - c.p.z);
      if (d < this.capR * 4) {
        o.v.x += (c.p.x - o.p.x) * 2;
        o.v.z += (c.p.z - o.p.z) * 2;
      }
    }
    return c.col;
  }

  // ---------- 投幣 ----------
  slotScreen() {
    return this._toScreen(this.root.localToWorld(this.spec.slot.clone()));
  }

  setSlotHint(on) {
    this.slotHint = on;
  }

  // 從螢幕上的一點把硬幣丟進投幣口
  insertCoin(sx, sy) {
    const coin = new THREE.Mesh(this.coinGeo, this.mats.coin);
    coin.castShadow = true;
    addOutline(coin, 0.0018, this.hullCache);
    const sp = this.spec;
    const slotW = this.root.localToWorld(sp.slot.clone());
    const camD = this.camera.position.distanceTo(slotW);
    const start = this._fromScreen(sx, sy, camD * 0.72);
    const startL = this.root.worldToLocal(start.clone());
    this.root.add(coin);
    const front = sp.slotTop ? new THREE.Vector3(sp.slot.x, sp.slot.y + 0.08, sp.slot.z) : new THREE.Vector3(sp.slot.x, sp.slot.y, sp.slotFront + 0.06);
    const inside = sp.slotTop ? new THREE.Vector3(sp.slot.x, sp.slot.y - 0.07, sp.slot.z) : new THREE.Vector3(sp.slot.x, sp.slot.y, sp.slotFront - 0.05);
    const spin0 = rnd(2, 4);
    return this.tween(0.42, (k) => {
      const e = ease.inOut(k);
      coin.position.lerpVectors(startL, front, e);
      coin.position.y += Math.sin(k * Math.PI) * 0.08;
      // 硬幣立起來對準直的投幣孔
      if (sp.slotTop) coin.rotation.set((Math.PI / 2) * e + (1 - e) * 0.3, (1 - e) * spin0, 0); // 立起來對準橫的縫
      else coin.rotation.set(0, (1 - e) * spin0, (Math.PI / 2) * e + (1 - e) * 0.3);
    })
      .then(() => {
        sfx.coin(this.kind);
        return this.tween(0.16, (k) => coin.position.lerpVectors(front, inside, k));
      })
      .then(() => {
        this.root.remove(coin);
      });
  }

  // ---------- 把手 ----------
  setHandleEnabled(on) {
    this.handleEnabled = on;
    if (on) this.turnAcc = 0;
  }

  // 前兆：這次會出 SR／SSR 時，轉把手的同時窗裡的扭蛋發金光（SSR 彩虹），頂上的燈閃
  setForeshadow(level) {
    this.foreshadow = level;
    if (!level) this._pileMat().emissive.setRGB(0, 0, 0);
  }

  _pileMat() {
    if (this.kind === 'omikuji' && this.slipBody) return this.omiWrap === 'capsule' ? this.omiCapBot.material : this.slipBody.material;
    return this.pileBot.material;
  }

  _foreshadowFrame() {
    const lv = this.foreshadow;
    const turning = this.turning || this.dragHandle || this.quickTurning;
    const k = lv && turning ? 1 : 0;
    this.fsK = (this.fsK || 0) + (k - (this.fsK || 0)) * 0.12;
    const f = this.fsK;
    if (f < 0.01) {
      this.lidLight.intensity = 0;
      this._pileMat().emissive.setRGB(0, 0, 0);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
    const col = lv === 3 ? _c.setHSL((this.time * 0.6) % 1, 0.9, 0.6) : _c.set('#ffc93c');
    this._pileMat().emissive.copy(col).multiplyScalar(f * (0.25 + 0.35 * pulse));
    this.lidLight.color.copy(col);
    this.lidLight.intensity = f * (1.5 + 2.5 * pulse);
    const sb = this.spec.spark;
    if (lv === 3 && Math.random() < f * 0.5) this.show.riseSpark(this.root.localToWorld(new THREE.Vector3(rnd(...sb.x), rnd(...sb.y), rnd(...sb.z))));
  }

  _setHandle(a) {
    this.handleAngle = a;
    this.handle.rotation[this.spec.handleAxis] = this.handleBase - a; // 順時針（從把手那一面看）
    if (this.kind === 'card') {
      // 平的圓柱旋鈕轉了看不出來 → 弧形箭頭、動線跟著轉（都在旋鈕那一面的平面上轉）
      this.decals.arrow.rotation.z = -a;
      if (this.turnFx) this.turnFx.rotation.z = -a;
    }
    if (this.kind === 'omikuji') this.decals.arrow.rotation.z = -a; // 圓洞旁的箭頭跟著攪的方向轉
  }

  _handleTick(prev, next) {
    const step = Math.PI / 4;
    if (Math.floor(next / step) > Math.floor(prev / step)) {
      if (this.kind !== 'omikuji') sfx.tick();
      this.shakePile(0.35);
      this.wobble = 1; // 機台跟著抖一下
      this.cb.onTick?.(next / (Math.PI * 2));
      if (Math.floor(next / step) % 2 === 0) this.kind === 'omikuji' ? sfx.rustle() : sfx.rattle();
    }
  }

  // 「幫我轉」：自動轉一圈
  autoTurn() {
    if (!this.handleEnabled || this.turning) return;
    this.turning = true;
    const a0 = this.handleAngle;
    let prev = 0;
    return this.tween(1.4, (k) => {
      const t = ease.inOut(k) * Math.PI * 2;
      this._handleTick(prev, t);
      prev = t;
      this._setHandle(a0 + t);
    }).then(() => this._turned());
  }

  _turned() {
    this.turning = false;
    this.handleEnabled = false;
    this.dragHandle = null;
    this.cb.onTurned?.();
  }

  wiggleHandle() {
    const a0 = this.handleAngle;
    sfx.locked();
    return this.tween(0.32, (k) => this._setHandle(a0 + Math.sin(k * Math.PI * 4) * 0.06 * (1 - k)));
  }

  // ---------- 出蛋 ----------
  // rarity 決定扭蛋顏色：SR 銀色、SSR 金色（出口就先預告）
  dispense(rarity, front) {
    if (this.kind === 'card') return this._dispenseCard(rarity, front);
    if (this.kind === 'omikuji') return this._dispenseSlip(rarity, front);
    // 窗裡最靠近出蛋孔的那顆掉下去 → 出口出現同一個顏色的扭蛋（SR、SSR 換成銀色、金色）
    const col = this._takeFromPile();
    // SSR 一半機率先裝成銀色（像 SR），開蛋集氣時才升格成金蛋
    const fake = rarity === 3 && (this.forceFake ?? Math.random() < 0.5); // forceFake：測試用
    const shown = fake ? 2 : rarity;
    const mat = shown >= 2 ? this.capRare[shown] : this.capMats[col ?? Math.floor(Math.random() * this.capMats.length)];
    const g = this._makeCapsule(mat);
    const s = this.capR / CAP_R;
    g.scale.setScalar(s);
    g.position.set(EXIT.x, 0.42, EXIT.z0);
    g.quaternion.setFromEuler(new THREE.Euler(rnd(-1, 1), rnd(0, 6), rnd(-1, 1)));
    this.root.add(g);
    this.exitCap = { g, rarity, mat, fake };
    const floorY = EXIT.floor + this.capR;
    let y = 0.42;
    let vy = -0.4;
    let z = EXIT.z0;
    let bounces = 0;
    let t = -0.3; // 等窗裡那顆掉進機身
    return new Promise((resolve) => {
      this.tweens.push({
        step: (dt) => {
          t += dt;
          if (t < 0) return false;
          vy -= 9.8 * dt;
          y += vy * dt;
          if (y < floorY) {
            y = floorY;
            if (Math.abs(vy) > 0.25) {
              sfx.thud(Math.min(1, Math.abs(vy) / 2.4));
              bounces++;
            }
            vy = -vy * 0.36;
          }
          if (bounces > 0) z += (EXIT.z1 - z) * Math.min(1, dt * 5);
          const roll = _q.setFromAxisAngle(_x, (Math.abs(vy) * 0.2 + (EXIT.z1 - z) * 2) * dt * 8);
          g.quaternion.premultiply(roll);
          g.position.set(EXIT.x, y, z);
          if (t > 1.5) {
            g.position.set(EXIT.x, floorY, EXIT.z1);
            resolve();
            return true;
          }
          return false;
        },
      });
    }).then(() => {
      if (shown >= 2) {
        this.exitLight.color.set(shown === 3 ? '#fff0c0' : '#ffcf5a'); // 金色的光從出口透出來
        this.exitGlow = shown;
      }
    });
  }

  // 轉卡機：卡片從出卡口滑出來（卡面朝下躺著，上緣先出來）；SR、SSR 的卡背是金的、彩虹的（SSR 一半機率先裝成金卡）
  async _dispenseCard(rarity, front) {
    const fake = rarity === 3 && (this.forceFake ?? Math.random() < 0.5);
    const shown = fake ? 2 : rarity;
    const g = this._makeCard(front, rarity, shown);
    const E = this.spec.exit;
    g.rotation.set(Math.PI / 2, 0, 0);
    g.position.set(E.x, E.y, E.zIn);
    this.root.add(g);
    this.exitCap = { g, rarity, fake, shown, card: true };
    await this.after(0.15);
    sfx.cardOut();
    await this.tween(0.5, (k) => (g.position.z = E.zIn + (E.zOut - E.zIn) * ease.out(k)));
    this.wobble = 0.6;
    if (shown >= 2) {
      this.exitLight.color.set(shown === 3 ? '#fff0c0' : '#ffcf5a');
      this.exitGlow = shown;
    }
  }

  // 扭蛋從出口飛到鏡頭前
  liftCapsule() {
    const c = this.exitCap;
    if (!c) return Promise.resolve();
    this.exitGlow = 0;
    this.exitLight.intensity = 0;
    sfx.whoosh();
    const g = c.g;
    const from = g.getWorldPosition(new THREE.Vector3());
    const q0 = g.getWorldQuaternion(new THREE.Quaternion());
    const s0 = g.scale.x;
    this.root.remove(g);
    this.fx.add(g);
    g.position.copy(from);
    g.quaternion.copy(q0);
    const to = this._inFront(c.card ? 1.25 : 1.2, -0.02);
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.28, 0));
    const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.5, 0.12));
    // 讓開口（接縫）朝向鏡頭一點
    qTo.premultiply(new THREE.Quaternion().setFromUnitVectors(_y, this.camera.position.clone().sub(to).normalize().lerp(_y, 0.6).normalize()));
    if (c.slip) qTo.copy(this.camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0.25, 0.06))); // 籤：折好的紙包正對鏡頭
    if (c.card) {
      // 卡片立起來、卡背朝鏡頭（稍微斜一點）
      qTo.copy(this.camera.quaternion).multiply(_q.setFromAxisAngle(_y, Math.PI)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.22, 0.05)));
    }
    this.exitCap = null;
    this.openCap = c;
    return this.tween(0.75, (k) => {
      const e = ease.out(k);
      // 二次貝茲曲線
      const a = from.clone().lerp(mid, e);
      const b = mid.clone().lerp(to, e);
      g.position.copy(a.lerp(b, e));
      g.quaternion.slerpQuaternions(q0, qTo, e);
      const s1 = c.card || c.slip ? 1 : 1.15;
      g.scale.setScalar(s0 + (s1 - s0) * e); // 不管窗裡的扭蛋多小，拿到鏡頭前都一樣大
    }).then(() => {
      c.home = to.clone();
      c.q = g.quaternion.clone();
      if ((c.card || c.slip) && c.shown >= 1) this.show.gridGlow(c, c.shown);
    });
  }

  // 開蛋：依稀有度跑演出表（fx.js 的 TIERS）
  //   N/R：抖一抖就打開；SR/SSR：先變暗、集氣（SSR 可能升格），再爆開
  async openCapsule(prize = null) {
    const c = this.openCap;
    if (!c) return;
    this.openCap = null;
    const g = c.g;
    const r = c.rarity;
    const T = TIERS[r];
    const home = c.home;
    if (c.card) return this._flipCard(c);
    if (c.slip) return this._unfoldSlip(c);
    if (T.dim) this.setDim(T.dim, r >= 2 ? 0.6 : 0.3);
    if (T.charge) {
      await this.show.charge(c, home, r);
    } else {
      sfx.shake();
      await this.tween(this.reduced ? 0.2 : T.shake, (k) => {
        const a = Math.sin(k * 38) * (0.12 + r * 0.05) * k;
        g.position.set(home.x + Math.sin(k * 45) * 0.01 * k, home.y, home.z);
        g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_z, a));
      });
    }
    // 定格：扭蛋整顆變白、停一拍（SR 0.14 秒、SSR 0.28 秒）
    if (r >= 2 && !this.reduced) {
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const keep = [g.userData.top.material, g.userData.bot.material];
      g.userData.top.material = g.userData.bot.material = white;
      sfx.hitstop?.();
      await this.after(r === 3 ? 0.28 : 0.14);
      [g.userData.top.material, g.userData.bot.material] = keep;
    }
    sfx.pop();
    if (r >= 2) {
      this.punch(r === 3 ? 7 : 4);
      this.shakePile(r === 3 ? 3 : 2);
      this.wobble = 2;
    }
    const { top, bot } = g.userData;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
    const camR = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const t0 = top.position.clone();
    const b0 = bot.position.clone();
    const fadeTop = this._fadeable(top);
    const fadeBot = this._fadeable(bot);
    this.show.burst(r, home);
    this.cb.onBurst?.(r);
    if (prize) this._prizePop(prize, r, home, T.reveal);
    const upL = g.worldToLocal(home.clone().add(up)).sub(g.worldToLocal(home.clone()));
    const rL = g.worldToLocal(home.clone().add(camR)).sub(g.worldToLocal(home.clone()));
    const fly = 1 + r * 0.25; // 越稀有，殼飛得越遠
    this.tween(0.9 + r * 0.15, (k) => {
      const e = ease.out(k);
      top.position.copy(t0).addScaledVector(upL, 0.16 * e * fly).addScaledVector(rL, 0.1 * e * fly);
      top.rotation.set(-1.4 * e * fly, 0, -0.9 * e);
      bot.position.copy(b0).addScaledVector(upL, -0.2 * e * e * fly).addScaledVector(rL, -0.06 * e * fly);
      bot.rotation.set(0.9 * e * fly, 0, 0.6 * e);
      fadeTop(k);
      fadeBot(k);
    }).then(() => this.fx.remove(g));
    await this.after(this.reduced ? Math.min(T.reveal, 0.6) : T.reveal);
    this.show.persist(r, home);
  }

  // 開蛋的那一刻獎品從殼裡跳出來（使用者 2026-10-25：「強化轉蛋機把轉蛋的物品效果強化」）：
  //   正對鏡頭的獎品小卡（drawPrizeCard）從蛋的中心長出來、往上往前飛，越稀有轉越多圈；結果卡蓋上來時淡掉
  _prizePop(canvas, r, at, hold) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
    const w = 0.1 + r * 0.008;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * canvas.height) / canvas.width), mat);
    m.renderOrder = 20;
    this.scene.add(m);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const toCam = this.camera.position.clone().sub(at).normalize();
    const from = at.clone();
    const to = at.clone().addScaledVector(up, 0.05 + r * 0.012).addScaledVector(toCam, 0.1);
    const spins = [0, 1, 1, 2][r];
    const dur = this.reduced ? 0.25 : 0.6 + r * 0.12;
    const place = (k) => {
      m.position.lerpVectors(from, to, ease.out(k));
      m.quaternion.copy(this.camera.quaternion);
      m.rotateY((1 - ease.out(k)) * spins * Math.PI * 2);
      m.scale.setScalar(0.15 + 0.85 * ease.back(k));
    };
    place(0);
    this.tween(dur, place)
      .then(() => this.after(Math.max(0.15, hold - dur + 0.15)))
      .then(() => this.tween(0.3, (k) => (mat.opacity = 1 - k)))
      .then(() => {
        m.removeFromParent();
        m.geometry.dispose();
        mat.dispose();
        tex.dispose();
      });
  }

  // 翻卡：跟開蛋同一套演出（變暗、集氣、定格、爆光），最後卡片轉 180° 亮出正面
  //   參考：Hearthstone（蓋牌的稀有度光、越稀有爆得越大）、ポケポケ（用手滑開）、マスターデュエル（卡背顏色＝稀有度、金→虹的昇格）、
  //   原神／鳴潮（先給顏色的暗示、剪影再上色）、FGO（越稀有越華麗）
  //   N/R：抖一抖翻一面；SR/SSR：集氣 → 定格 → 爆光＋連轉 1–2 圈（正面是剪影）→ 停一拍 → 上色
  async _flipCard(c) {
    const g = c.g;
    const r = c.rarity;
    const T = TIERS[r];
    const home = c.home;
    const dir = this.flipDir || 1; // 滑的方向決定翻的方向
    this.flipDir = 1;
    if (c.glow) {
      c.glow.removeFromParent();
      c.glow = null;
    }
    if (T.dim) this.setDim(T.dim, r >= 2 ? 0.6 : 0.3);
    if (T.charge) await this.show.charge(c, home, r);
    else {
      sfx.shake();
      await this.tween(this.reduced ? 0.2 : T.shake, (k) => {
        const a = Math.sin(k * 38) * (0.08 + r * 0.04) * k;
        g.position.set(home.x + Math.sin(k * 45) * 0.008 * k, home.y, home.z);
        g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_z, a));
      });
    }
    if (r >= 2 && !this.reduced) {
      g.userData.setWhite(1); // 定格：整張變白停一拍
      sfx.hitstop?.();
      await this.after(r === 3 ? 0.28 : 0.14);
      g.userData.setWhite(0);
    }
    sfx.flip();
    if (r >= 2) {
      this.punch(r === 3 ? 7 : 4);
      this.wobble = 2;
    }
    this.show.burst(r, home);
    this.cb.onBurst?.(r);
    const spins = this.reduced ? 0 : [0, 0, 1, 2][r];
    const ang = Math.PI * (1 + 2 * spins) * dir;
    const dur = this.reduced ? 0.25 : [0.45, 0.5, 0.95, 1.3][r];
    const sil = r >= 2 && !this.reduced;
    if (sil) g.userData.setSil(1);
    const q0 = g.quaternion.clone();
    const s0 = g.scale.x;
    await this.tween(dur, (k) => {
      const e = spins ? 1 - Math.pow(1 - k, 4) : ease.out(k); // 連轉：一開始很快、最後慢慢停
      g.quaternion.copy(q0).multiply(_q.setFromAxisAngle(_y, ang * e));
      g.position.copy(home);
      g.scale.setScalar(s0 * (1 + 0.16 * Math.sin(k * Math.PI)));
    });
    c.q = g.quaternion.clone();
    let spent = dur;
    if (sil) {
      await this.after(0.24); // 剪影停一拍（邊光在轉）
      sfx.upgrade();
      this.show._coreFlash(home, '#ffffff', 0.4, 0.35);
      this.show._ring(home, r === 3 ? '#ffd54a' : '#c79bff', 0, 0.45, 0.5);
      await this.tween(0.3, (k) => g.userData.setSil(1 - k));
      spent += 0.54;
    } else g.userData.setSil(0);
    g.userData.baseQ = c.q.clone();
    this.revealed = c;
    await this.after(this.reduced ? 0.3 : Math.max(0.3, T.reveal - spent));
    this.show.persist(r, home);
  }

  // ---------- 10 連抽 ----------
  // 每顆：窗裡掉一顆 → 出口跳出 → 飛到鏡頭前的格子
  // 格子只排在上下 UI 之間那塊空間（不壓到名牌、提示卡）；欄數挑能讓扭蛋最大的（橫向多半 5×2、直向手機 2-3-3-2）
  _gridSlot(i, n) {
    const dist = 1.7;
    const H = this.host.clientHeight || 1;
    const { top = 0, bottom = 0, gridTop = top } = this.insets || {};
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfH = dist * tanV;
    const yTop = (1 - (2 * gridTop) / H) * halfH;
    const yBot = (-1 + (2 * bottom) / H) * halfH;
    const regionH = Math.max(0.2, yTop - yBot) * 0.94;
    const regionW = 2 * halfH * this.camera.aspect * 0.92;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const step = Math.min(0.24, regionW / cols, regionH / rows);
      if (!best || step > best.step + 1e-6) best = { rows, step };
    }
    const { rows, step } = best;
    // 每列幾顆：平均分，多的給中間的列；每列置中
    const counts = Array(rows).fill(Math.floor(n / rows));
    const mid = [...counts.keys()].sort((a, b) => Math.abs(a - (rows - 1) / 2) - Math.abs(b - (rows - 1) / 2));
    for (let k = 0; k < n % rows; k++) counts[mid[k]]++;
    let r = 0;
    let c = i;
    while (c >= counts[r]) c -= counts[r++];
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return {
      pos: this.camera.position.clone().addScaledVector(fwd, dist)
        .addScaledVector(right, (c - (counts[r] - 1) / 2) * step)
        .addScaledVector(up, ((rows - 1) / 2 - r) * step + (yTop + yBot) / 2),
      scale: this.kind === 'card' ? (step * 0.94) / CARD_H : this.kind === 'omikuji' ? (step * 0.9) / SLIP3.w : (step / (2 * CAP_R)) * 0.86,
      step,
    };
  }

  // 把手快轉一圈（10 連用）
  quickTurn(dur = 0.42) {
    const a0 = this.handleAngle;
    let prev = 0;
    this.quickTurning = true;
    setTimeout(() => (this.quickTurning = false), dur * 1000 + 200);
    return this.tween(dur, (k) => {
      const t = ease.inOut(k) * Math.PI * 2;
      this._handleTick(prev, t);
      prev = t;
      this._setHandle(a0 + t);
    });
  }

  // 出一顆、飛到第 i 格
  dispenseToGrid(i, n, rarity, front) {
    if (this.kind === 'card') return this._cardToGrid(i, n, rarity, front);
    if (this.kind === 'omikuji') return this._slipToGrid(i, n, rarity, front);
    const col = this._takeFromPile();
    const fake = rarity === 3 && (this.forceFake ?? Math.random() < 0.5);
    const shown = fake ? 2 : rarity;
    const mat = shown >= 2 ? this.capRare[shown] : this.capMats[col ?? Math.floor(Math.random() * this.capMats.length)];
    const g = this._makeCapsule(mat);
    const s0 = this.capR / CAP_R;
    g.scale.setScalar(s0);
    this.root.add(g);
    const floorY = EXIT.floor + this.capR;
    const c = { g, rarity, mat, fake, i };
    g.userData.gridIdx = i;
    this.gridN = n;
    this.grid = this.grid || [];
    this.grid[i] = c;
    this.gridSlots = this.gridSlots || [];
    // 1) 出口掉下來（快）
    return this.tween(0.32, (k) => {
      g.position.set(EXIT.x, 0.38 - (0.38 - floorY) * k * k, EXIT.z0 + (EXIT.z1 - EXIT.z0) * k);
      g.rotation.x += 0.2;
    })
      .then(() => {
        if (this.grid[i] !== c) return g.removeFromParent(); // 掉出來的途中格子被清掉了
        sfx.thud(0.6);
        // 2) 飛到格子
        const from = g.getWorldPosition(new THREE.Vector3());
        const q0 = g.getWorldQuaternion(new THREE.Quaternion());
        this.root.remove(g);
        this.fx.add(g);
        g.position.copy(from);
        g.quaternion.copy(q0);
        const slot = this._gridSlot(i, n);
        this.gridSlots[i] = slot;
        const mid = from.clone().lerp(slot.pos, 0.5).add(new THREE.Vector3(0, 0.25, 0));
        const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.3, 0.1));
        return this.tween(0.45, (k) => {
          const e = ease.out(k);
          const a = from.clone().lerp(mid, e);
          const b = mid.clone().lerp(slot.pos, e);
          g.position.copy(a.lerp(b, e));
          g.quaternion.slerpQuaternions(q0, qTo, e);
          g.scale.setScalar(s0 + (slot.scale - s0) * e);
        }).then(() => {
          const s = this.gridSlots[i]; // 飛的途中版面可能變了 → 用最新的格子
          if (!s || this.grid[i] !== c) return; // 飛的途中格子被清掉了（換機台、離開）
          c.home = s.pos.clone();
          c.q = g.quaternion.clone();
          g.position.copy(s.pos);
          g.scale.setScalar(s.scale);
          g.userData.s0 = s.scale;
          if (shown >= 2) this.show.gridGlow(c, shown);
        });
      });
  }

  // 轉卡機的 10 連：卡片從出卡口快速滑出 → 卡背朝前飛到格子
  _cardToGrid(i, n, rarity, front) {
    const fake = rarity === 3 && (this.forceFake ?? Math.random() < 0.5);
    const shown = fake ? 2 : rarity;
    const g = this._makeCard(front, rarity, shown);
    const E = this.spec.exit;
    g.rotation.set(Math.PI / 2, 0, 0);
    g.position.set(E.x, E.y, E.zIn);
    this.root.add(g);
    const c = { g, rarity, fake, shown, i, card: true };
    g.userData.gridIdx = i;
    this.gridN = n;
    this.grid = this.grid || [];
    this.grid[i] = c;
    this.gridSlots = this.gridSlots || [];
    sfx.cardOut();
    return this.tween(0.22, (k) => (g.position.z = E.zIn + (E.zOut - E.zIn) * ease.out(k))).then(() => {
      if (this.grid[i] !== c) return; // 滑出來的途中格子被清掉了（卡片已經丟掉）
      const from = g.getWorldPosition(new THREE.Vector3());
      const q0 = g.getWorldQuaternion(new THREE.Quaternion());
      this.root.remove(g);
      this.fx.add(g);
      g.position.copy(from);
      g.quaternion.copy(q0);
      const slot = this._gridSlot(i, n);
      this.gridSlots[i] = slot;
      const mid = from.clone().lerp(slot.pos, 0.5).add(new THREE.Vector3(0, 0.25, 0));
      const qTo = this.camera.quaternion.clone().multiply(_q.setFromAxisAngle(_y, Math.PI)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0.12, 0.03)));
      return this.tween(0.45, (k) => {
        const e = ease.out(k);
        const a = from.clone().lerp(mid, e);
        const b = mid.clone().lerp(slot.pos, e);
        g.position.copy(a.lerp(b, e));
        g.quaternion.slerpQuaternions(q0, qTo, e);
        g.scale.setScalar(1 + (slot.scale - 1) * e);
      }).then(() => {
        const s = this.gridSlots[i];
        if (!s || this.grid[i] !== c) return; // 飛的途中格子被清掉了
        c.home = s.pos.clone();
        c.q = g.quaternion.clone();
        g.position.copy(s.pos);
        g.scale.setScalar(s.scale);
        g.userData.s0 = s.scale;
        if (shown >= 1) this.show.gridGlow(c, shown); // 卡片：R 也亮（藍），像 Hearthstone 的蓋牌
      });
    });
  }

  // 卡片在格子裡翻開，之後就當「已開的小卡」（可以點來看結果卡）
  _flipInGrid(c, i) {
    const g = c.g;
    this.grid[i] = null;
    sfx.flip();
    this.show.miniBurst(c.rarity, c.home);
    if (c.glow) c.glow.removeFromParent();
    delete g.userData.gridIdx;
    g.userData.gridCard = i;
    this.gridCards = this.gridCards || [];
    this.gridCards[i] = g;
    const q0 = g.quaternion.clone();
    const s0 = g.userData.s0;
    delete g.userData.baseQ;
    return this.tween(0.45, (k) => {
      const e = ease.out(k);
      g.quaternion.copy(q0).multiply(_q.setFromAxisAngle(_y, Math.PI * e));
      g.position.copy(c.home);
      g.scale.setScalar(s0 * (1 + 0.18 * Math.sin(k * Math.PI)));
    }).then(() => (g.userData.baseQ = g.quaternion.clone()));
  }

  // 小開：普通扭蛋在格子裡直接啵開，殼飛開時翻出獎品小卡（card＝drawPrizeCard 的 canvas）
  popInGrid(i, card) {
    const c = this.grid?.[i];
    if (!c) return Promise.resolve();
    if (c.card) return this._flipInGrid(c, i);
    if (c.slip) return this._slipPopInGrid(c, i, card);
    if (card) this.after(0.12).then(() => this.revealInGrid(i, card));
    const g = c.g;
    const { top, bot } = g.userData;
    sfx.pop();
    this.show.miniBurst(c.rarity, c.home);
    const fadeTop = this._fadeable(top);
    const fadeBot = this._fadeable(bot);
    const t0 = top.position.clone();
    const b0 = bot.position.clone();
    this.grid[i] = null;
    return this.tween(0.45, (k) => {
      const e = ease.out(k);
      top.position.copy(t0).add(new THREE.Vector3(0, 0.09 * e, 0));
      top.rotation.set(-1.2 * e, 0, -0.7 * e);
      bot.position.copy(b0).add(new THREE.Vector3(0, -0.08 * e * e, 0));
      fadeTop(k);
      fadeBot(k);
    }).then(() => this.fx.remove(g));
  }

  // 大開：把最稀有的那顆移到中間，跑完整演出（跟單抽一樣）
  async openFromGrid(i, card) {
    const c = this.grid?.[i];
    if (!c) return;
    this.grid[i] = null;
    const g = c.g;
    const to = this._inFront(c.card ? 1.25 : 1.2, -0.02);
    const from = g.position.clone();
    const s0 = g.scale.x;
    const s1 = c.card || c.slip ? 1 : 1.15;
    if (c.glow) c.glow.removeFromParent();
    // 其他格子（扭蛋、已經開出來的卡）先縮起來，讓出舞台
    this._gridScale(i, false);
    await this.tween(0.55, (k) => {
      const e = ease.inOut(k);
      g.position.lerpVectors(from, to, e);
      g.scale.setScalar(s0 + (s1 - s0) * e);
    });
    c.home = to.clone();
    c.q = g.quaternion.clone();
    this.openCap = c;
    await this.openCapsule();
    if (c.card) {
      // 翻開的卡留在中間（結果卡蓋著）；restoreGrid 時縮回原本的格子
      this.revealed = null;
      delete g.userData.gridIdx;
      g.userData.gridCard = i;
      this.gridCards = this.gridCards || [];
      this.gridCards[i] = g;
      this.gridReturn = { g, i };
      delete g.userData.baseQ; // 回到格子後再記
    } else if (card) this.revealInGrid(i, card, true);
  }

  // 10 連：開放點格子裡的扭蛋（一顆一顆開）
  setGridPick(on) {
    this.gridPick = on;
    if (!on) this.gridHover = -1;
  }

  // 獎品小卡：在第 i 格翻面出現（hidden＝先縮著，等 restoreGrid 再長出來）
  revealInGrid(i, canvas, hidden = false) {
    const slot = this.gridSlots?.[i];
    if (!slot) return;
    const w = slot.step * 0.92;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * (canvas.height / canvas.width)),
      // 要寫深度：不然後畫的窗玻璃會蓋在卡片上（一層白霧）；圓角用 alphaTest 切掉
      new THREE.MeshBasicMaterial({ map: canvasTex(canvas), transparent: true, alphaTest: 0.5, toneMapped: false }),
    );
    m.renderOrder = 7;
    m.position.copy(slot.pos);
    m.quaternion.copy(this.camera.quaternion);
    m.userData.gridCard = i;
    m.userData.s0 = 1;
    this.fx.add(m);
    this.gridCards = this.gridCards || [];
    if (this.gridCards[i]) this._dropCard(this.gridCards[i]);
    this.gridCards[i] = m;
    if (hidden) return m.scale.setScalar(1e-4);
    const q0 = this.camera.quaternion.clone();
    this.tween(0.45, (k) => {
      const e = ease.back(k);
      m.quaternion.copy(q0).multiply(_q.setFromAxisAngle(_y, (1 - ease.out(k)) * Math.PI * 0.5));
      m.scale.setScalar(Math.max(1e-4, 0.3 + 0.7 * e));
    });
  }

  // 大開結束、關掉結果卡 → 其他格子長回來（轉卡機：剛翻開的那張回到自己的格子）
  restoreGrid() {
    if (this.revealed?.slip) this.dismissShown(); // 攤開的籤收掉，格子裡換成吉凶小牌
    const p = this.gridReturn;
    this.gridReturn = null;
    if (p && this.gridSlots[p.i]) {
      const s = this.gridSlots[p.i];
      p.g.position.copy(s.pos);
      p.g.quaternion.copy(this.camera.quaternion);
      p.g.userData.baseQ = this.camera.quaternion.clone();
      p.g.scale.setScalar(1e-4);
      p.g.userData.s0 = s.scale;
    }
    this._gridScale(-1, true);
  }

  _gridScale(except, grow) {
    const objs = [];
    (this.grid || []).forEach((c, j) => c && j !== except && objs.push(c.g));
    (this.gridCards || []).forEach((m, j) => m && j !== except && objs.push(m));
    for (const o of objs) {
      const a = o.scale.x;
      const b = grow ? o.userData.s0 ?? 1 : 1e-4;
      o.userData.scaling = true; // 這段時間格子的「輕輕跳」不改大小
      this.tween(grow ? 0.4 : 0.3, (k) => o.scale.setScalar(a + (b - a) * (grow ? ease.back(k) : ease.inOut(k)))).then(() => (o.userData.scaling = false));
    }
  }

  _dropCard(m) {
    if (m.userData.card) return this._dropObj(m); // 轉卡機的整張卡
    this.fx.remove(m);
    m.material.map.dispose();
    m.material.dispose();
    m.geometry.dispose();
  }

  clearGrid() {
    for (const c of this.grid || []) if (c) c.card || c.slip ? this._dropObj(c.g) : c.g.removeFromParent();
    if (this.revealed?.slip) {
      this._dropObj(this.revealed.g);
      this.revealed = null;
    }
    for (const m of this.gridCards || []) if (m) this._dropCard(m);
    this.grid = [];
    this.gridCards = [];
    this.gridSlots = [];
    this.gridN = 0;
    this.gridReturn = null;
  }

  // 版面變了（UI 高度、螢幕轉向）→ 格子重排，扭蛋跟小卡移到新位置
  _layoutGrid() {
    if (!this.gridN) return;
    for (let i = 0; i < this.gridN; i++) {
      const old = this.gridSlots[i];
      if (!old) continue;
      const slot = this._gridSlot(i, this.gridN);
      this.gridSlots[i] = slot;
      const k = slot.step / old.step;
      const c = this.grid[i];
      if (c?.home) {
        c.home.copy(slot.pos);
        c.g.position.copy(slot.pos);
        c.g.userData.s0 = slot.scale;
        if (!c.g.userData.scaling) c.g.scale.setScalar(slot.scale);
      }
      const m = this.gridCards?.[i];
      if (m) {
        m.position.copy(slot.pos);
        m.quaternion.copy(this.camera.quaternion);
        if (m.userData.baseQ) m.userData.baseQ.copy(this.camera.quaternion);
        m.userData.s0 *= k;
        m.scale.multiplyScalar(k);
      }
    }
  }

  // 鏡頭衝擊：視角先縮再彈回（看起來像往前撞一下）
  punch(deg) {
    const f0 = 30;
    this.tween(0.5, (k) => {
      const e = k < 0.18 ? k / 0.18 : 1 - ease.out((k - 0.18) / 0.82);
      this.camera.fov = f0 - deg * e;
      this.camera.updateProjectionMatrix();
    }).then(() => {
      this.camera.fov = f0;
      this.camera.updateProjectionMatrix();
    });
  }

  // 收掉還留在畫面上的扭蛋（換機台、補貨時）
  clearCapsules() {
    for (const c of [this.exitCap, this.openCap, this.revealed]) if (c) this._dropObj(c.g);
    this.exitCap = this.openCap = this.revealed = null;
    this.clearGrid?.();
    this.exitGlow = 0;
    this.exitLight.intensity = 0;
    this.setDim(0, 0.3);
  }

  // 場景變暗（SR、SSR 的「關燈」）：背景、地板、燈光一起降；特效是發光的，不受影響
  setDim(k, dur = 0.6) {
    const from = this.dim || 0;
    this.dimTween = { from, to: k, t: 0, dur: Math.max(0.01, dur) };
  }

  _applyDim(dt) {
    const d = this.dimTween;
    if (!d) return;
    d.t = Math.min(d.dur, d.t + dt);
    const e = ease.inOut(d.t / d.dur);
    this.dim = d.from + (d.to - d.from) * e;
    if (d.t >= d.dur) this.dimTween = null;
    const k = this.dim;
    const night = _c.set('#060913');
    this.dimmer.material.uniforms.uA.value = k * 0.92;
    if (this.stageFloor) this.floorMat.color.copy(this.stageFloor).lerp(night, k);
    this.ambient.intensity = AMB * (1 - 0.75 * k);
    this.key.intensity = KEY * (1 - 0.8 * k);
    (this.decals.card || this.decals.board).material.color.setScalar(1 - 0.7 * k); // 台紙（轉卡機是窗裡的直式台紙）
  }

  // ---------- 畫面與輸入 ----------
  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._frameCamera();
    this._fitBg();
    this._layoutGrid();
  }

  // ---------- 店家貼的貼紙（使用者 2026-10-26：「貼紙製作後可以貼在轉蛋機上」） ----------
  //   DecalGeometry 沿表面法線投影；附近的零件全部投一次（貼紙可以跨過面板跟機身），每片掛在那個零件底下（把手轉它也跟著轉）
  //   位置＝零件編號＋零件自己座標的點、法線 → 重新載入、換機台種類都貼得回原處
  pickSurface(e) {
    const list = this.stickTargets?.[this.kind];
    if (!this.loaded || !list) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.root.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(list, false)[0];
    if (!hit?.face) return null;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    return { k: this.kind, m: list.indexOf(hit.object), p: hit.object.worldToLocal(hit.point.clone()).toArray().map(r4), n: hit.face.normal.toArray().map(r4) };
  }

  // list：[{ k 機台種類, m 零件編號, p, n, s 大小（公尺）, r 角度（度）, bmp 貼紙圖 }]；跟上次一樣就不重做
  setStickers(list = []) {
    if (!this.loaded) return;
    this._stkList = list;
    const sig = this.kind + '|' + list.map((s) => [s.k, s.m, ...s.p, ...s.n, s.s, s.r, s.bmp ? s.bmp.width : 0, s.id].join(',')).join('|');
    if (sig === this._stkSig) return;
    this._stkSig = sig;
    for (const d of this._stkMeshes || []) {
      d.removeFromParent();
      d.geometry.dispose();
      d.material.dispose();
    }
    this._stkMeshes = [];
    const targets = this.stickTargets?.[this.kind] || [];
    this.root.updateMatrixWorld(true);
    this._stkTex = this._stkTex || new WeakMap();
    const sphere = new THREE.Sphere();
    for (const [si, s] of list.entries()) {
      const anchor = s.k === this.kind && targets[s.m];
      if (!anchor || !s.bmp) continue;
      let tex = this._stkTex.get(s.bmp);
      if (!tex) {
        tex = new THREE.Texture(s.bmp);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        this._stkTex.set(s.bmp, tex);
      }
      const p = anchor.localToWorld(new THREE.Vector3(...s.p));
      const n = new THREE.Vector3(...s.n).applyMatrix3(new THREE.Matrix3().getNormalMatrix(anchor.matrixWorld)).normalize();
      const o = new THREE.Object3D();
      o.position.copy(p);
      o.lookAt(p.clone().add(n));
      o.rotateZ((-(s.r || 0) * Math.PI) / 180);
      // 投影的深度：透明窗比機身凸出 4.75 cm → 大張貼在窗上、超出窗邊的部分要投得到後面的框（使用者 2026-10-27：「貼紙切掉了」）
      //   深一點（貼紙越大越深，最多前後各 15 cm），但只留面向貼紙的面（facing），不會印到玻璃背面、側壁
      const size = new THREE.Vector3(s.s, s.s, THREE.MathUtils.clamp(s.s * 1.2, 0.1, 0.3));
      for (const mesh of targets) {
        if (!mesh.visible || !mesh.geometry) continue;
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
        if (sphere.distanceToPoint(p) > s.s) continue; // 太遠的零件不用投
        const raw = new DecalGeometry(mesh, p, o.rotation, size);
        const geo = raw.getAttribute('position')?.count ? facing(raw, n, 0.3) : null;
        raw.dispose();
        if (!geo) continue;
        geo.applyMatrix4(mesh.matrixWorld.clone().invert());
        const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: this.ramp, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        const d = new THREE.Mesh(geo, mat);
        d.name = 'sticker';
        d.userData.stk = si; // 第幾張（拖曳移動用）
        d.renderOrder = mesh.material?.transparent ? (mesh.renderOrder || 0) + 1 : 4;
        d.receiveShadow = true;
        mesh.add(d);
        this._stkMeshes.push(d);
      }
    }
  }

  // 開店頁：按住貼紙拖 → 沿著機台表面移動（使用者 2026-10-27：「調整把貼紙貼到機器上後可以移動」）
  //   cb.stickerEdit()＝開店頁才是 true（買家不能動）；回傳按到的是第幾張
  //   手機上機台很小、貼紙只有指尖大 → 沒打中的話，離貼紙中心夠近（手指 30 px、滑鼠 16 px）也算按到
  _pickSticker(e) {
    if (!this.cb.stickerEdit?.() || !this._stkMeshes?.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this._stkMeshes, false)[0];
    if (hit) return hit.object.userData.stk;
    const tol = e.pointerType === 'touch' || e.pointerType === 'pen' ? 30 : 16;
    let best = null;
    let bd = Infinity;
    for (const [si, s] of (this._stkList || []).entries()) {
      if (s.k !== this.kind) continue;
      const c = this._stickerScreen(si);
      if (!c) continue;
      const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
      if (d < tol && d < bd) {
        bd = d;
        best = si;
      }
    }
    return best;
  }
  // 開店頁：點到的是台紙上的哪個獎品（cb.boardEdit()＝開店頁才是 true）；台紙在玻璃、扭蛋後面 → 只看台紙本身
  _pickBoardItem(e) {
    const b = this._boardHit;
    if (!this.cb.boardEdit?.() || !b?.cells?.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObject(b.mesh, false)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * b.w;
    const y = (1 - hit.uv.y) * b.h; // canvas 貼圖上下翻過（v＝1 是畫布的頂）
    const c = b.cells.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    return c ? c.i : null;
  }

  // 那張貼紙的中心在畫面上的哪裡（拖的時候手指跟中心的距離保持不變）
  _stickerScreen(si) {
    const s = this._stkList?.[si];
    const anchor = s && this.stickTargets?.[this.kind]?.[s.m];
    if (!anchor) return null;
    this.root.updateMatrixWorld(true);
    return this._toScreen(anchor.localToWorld(new THREE.Vector3(...s.p)));
  }

  // 貼貼紙模式：點到機台 → fn(位置)；點空白一樣拖曳轉機台看側面
  startStick(fn) {
    this.stickMode = fn;
    this.renderer.domElement.style.cursor = 'crosshair';
  }
  stopStick() {
    this.stickMode = null;
    this.renderer.domElement.style.cursor = '';
  }

  // 畫面上下被 UI 蓋住的高度（px）：機器要放在剩下的空間裡；gridTop＝10 連格子的上緣（連右上的價錢章都避開）
  setInsets(top, bottom, gridTop = top) {
    const o = this.insets;
    if (o && o.top === top && o.bottom === bottom && o.gridTop === gridTop) return;
    this.insets = { top, bottom, gridTop };
    this._frameCamera();
    this._layoutGrid();
  }

  // 逛機台的封面：暫時換成正方形畫面、上下沒有 UI，整台機器剛好入鏡拍一張，再換回原本的畫面（同一個 frame 裡，看不到閃）
  snapshot(size = 240) {
    const r = this.renderer;
    const insets = this.insets;
    const pr = r.getPixelRatio();
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.insets = { top: 0, bottom: 0, gridTop: 0 };
    this._frameCamera();
    this._fitBg();
    r.render(this.scene, this.camera);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(r.domElement, 0, 0, size, size);
    r.setPixelRatio(pr);
    this.insets = insets;
    this.resize();
    return c;
  }

  // 讓整台機器剛好入鏡：直式螢幕要退遠一點
  // 精準取景：把機台外框（8 個角，含預設的側轉角度）投影到畫面上，
  // 找出能塞進「上下 UI 之間那塊空間」的最近距離，再把它移到那塊空間的正中間
  _frameCamera() {
    const H = this.host.clientHeight || 1;
    const { top = 0, bottom = 0 } = this.insets || {};
    const yTop = 1 - (2 * top) / H; // 可用空間（NDC）
    const yBot = -1 + (2 * bottom) / H;
    const availH = Math.max(0.5, yTop - yBot) * 0.97;
    const availW = 2 * 0.88;
    const rot = new THREE.Matrix4().makeRotationY(this.restYaw ?? -0.32);
    const B = this.spec.box;
    const corners = [];
    for (const x of B.x) for (const y of B.y) for (const z of B.z) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(rot));
    const dir = (this.spec.camDir || new THREE.Vector3(0.0, 0.3, 1)).clone().normalize();
    const cx = new THREE.Vector3((B.x[0] + B.x[1]) / 2, 0, (B.z[0] + B.z[1]) / 2).applyMatrix4(rot);
    const target = new THREE.Vector3(cx.x, 0.66, cx.z);
    const cam = this.camera;
    const extent = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(cam);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      return { w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 };
    };
    let d = 3;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 1.2, hi = 14;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const e = extent(mid);
        if (e.h <= availH && e.w <= availW) hi = mid;
        else lo = mid;
      }
      d = hi;
      // 投影中心對準可用空間中心（中心偏上 → 鏡頭往上移，機器就往下）
      const e = extent(d);
      const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      target.y += (e.cy - (yTop + yBot) / 2) * d * tanV;
    }
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    this.camBase = cam.position.clone();
    this.camTarget = target;
  }


  _inFront(dist, down = 0) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return this.camera.position.clone().addScaledVector(fwd, dist).addScaledVector(up, down);
  }

  _toScreen(v) {
    const p = v.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  _fromScreen(x, y, dist) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.at(dist, new THREE.Vector3());
  }

  _pick(e) {
    if (!this.loaded) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const targets = [this.handle, this.slotHit];
    if (this.exitCap) targets.push(this.exitCap.g);
    if (this.openCap) targets.push(this.openCap.g);
    if (this.gridPick) {
      for (const c of this.grid || []) if (c?.home) targets.push(c.g);
      for (const m of this.gridCards || []) if (m) targets.push(m);
    }
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let o = hit.object;
    if (o === this.handle || o.parent === this.handle) return 'handle';
    if (o === this.slotHit) return 'slot';
    while (o.parent && o !== this.exitCap?.g && o !== this.openCap?.g && o.userData.gridIdx == null && o.userData.gridCard == null) o = o.parent;
    if (o.userData.gridCard != null) {
      this.pickIdx = o.userData.gridCard;
      return 'gridCard';
    }
    if (o.userData.gridIdx != null) {
      this.pickIdx = o.userData.gridIdx;
      return 'grid';
    }
    if (o === this.exitCap?.g) return 'exit';
    if (o === this.openCap?.g) return 'open';
    return null;
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // 手機長按不要跳選單（會打斷拖曳）
    // 陀螺儀：第一次拿到的角度當「正」，之後跟它比；慢慢回正，免得越飄越歪
    addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      const o = (this.gyro0 = this.gyro0 || { b: e.beta, g: e.gamma });
      o.b += (e.beta - o.b) * 0.01;
      o.g += (e.gamma - o.g) * 0.01;
      const c = (v) => Math.max(-1, Math.min(1, v));
      this.ptr = { x: c((e.gamma - o.g) / 18), y: c(-(e.beta - o.b) / 18) };
      this.gyro = true;
    });
    // iOS 要在使用者點畫面的那一刻請求陀螺儀權限
    el.addEventListener('pointerdown', () => {
      if (this._oriAsked || typeof DeviceOrientationEvent === 'undefined' || typeof DeviceOrientationEvent.requestPermission !== 'function') return;
      this._oriAsked = true;
      DeviceOrientationEvent.requestPermission().catch(() => {});
    });
    el.addEventListener('pointerdown', (e) => {
      this.idleT = 0;
      if (this.stickMode) {
        const at = this.pickSurface(e);
        if (at) {
          const fn = this.stickMode;
          this.stopStick();
          return fn(at);
        }
      }
      // 開店頁：按到貼紙 → 拖著移動（不轉機台）
      const si = this._pickSticker(e);
      if (si != null) {
        el.setPointerCapture(e.pointerId);
        const c = this._stickerScreen(si) || { x: e.clientX, y: e.clientY };
        this.dragSticker = { si, dx: e.clientX - c.x, dy: e.clientY - c.y, moved: false };
        this.cb.onStickerPick?.(si);
        return;
      }
      const what = this._pick(e);
      if (what === 'handle') {
        if (!this.handleEnabled || this.turning) {
          if (!this.turning) {
            this.wiggleHandle();
            this.cb.onHandleLocked?.();
          }
          return;
        }
        el.setPointerCapture(e.pointerId);
        const c = this._toScreen(this.root.localToWorld(this.spec.handleC.clone()));
        this.dragHandle = { c, last: Math.atan2(e.clientY - c.y, e.clientX - c.x), moved: 0, t0: performance.now() };
        return;
      }
      if (what === 'slot') return this.cb.onSlot?.(e.clientX, e.clientY);
      if (what === 'exit') return this.cb.onExitCapsule?.();
      if (what === 'open') {
        if (!this.openCap?.card) return this.cb.onOpenCapsule?.();
        el.setPointerCapture(e.pointerId);
        this.dragCard = { x0: e.clientX, dx: 0, t0: performance.now(), tilt: 0 };
        return;
      }
      if (what === 'grid') return this.cb.onGridCapsule?.(this.pickIdx);
      if (what === 'gridCard') return this.cb.onGridCard?.(this.pickIdx);
      // 開店頁點台紙上的獎品：放開時沒拖動才算（按著拖一樣轉機台）
      const bi = this._pickBoardItem(e);
      this.boardTap = bi != null ? { i: bi, x: e.clientX, y: e.clientY, t0: performance.now() } : null;
      // 空白處拖曳 → 轉機台看側面
      el.setPointerCapture(e.pointerId);
      this.dragYaw = { x: e.clientX, yaw: this.yawTarget };
    });
    el.addEventListener('pointermove', (e) => {
      // 游標位置（翻開的卡片跟著微微傾斜）
      const rr = el.getBoundingClientRect();
      if (!this.gyro) this.ptr = { x: ((e.clientX - rr.left) / rr.width) * 2 - 1, y: -((e.clientY - rr.top) / rr.height) * 2 + 1 };
      if (this.dragSticker) {
        const d = this.dragSticker;
        const at = this.pickSurface({ clientX: e.clientX - d.dx, clientY: e.clientY - d.dy });
        if (at) {
          d.moved = true;
          this.cb.onStickerMove?.(d.si, at);
        }
        return;
      }
      if (this.dragCard) {
        const d = this.dragCard;
        d.dx = e.clientX - d.x0;
        d.tilt = THREE.MathUtils.clamp(d.dx * 0.004, -0.75, 0.75);
        return;
      }
      if (this.dragHandle) {
        const d = this.dragHandle;
        const a = Math.atan2(e.clientY - d.c.y, e.clientX - d.c.x);
        let da = a - d.last;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        d.last = a;
        // 螢幕 y 向下 → atan2 增加＝順時針；只能往前轉（棘輪）
        if (da > 0) {
          d.moved += da;
          const prev = this.turnAcc;
          this.turnAcc = Math.min(Math.PI * 2, this.turnAcc + da);
          this._handleTick(prev, this.turnAcc);
          this._setHandle(this.handleAngle + (this.turnAcc - prev));
          if (this.turnAcc >= Math.PI * 2 - 1e-3) this._turned();
        }
        return;
      }
      if (this.dragYaw) {
        this.yawTarget = THREE.MathUtils.clamp(this.dragYaw.yaw + (e.clientX - this.dragYaw.x) * 0.006, -1.1, 1.1);
        return;
      }
      if (this.stickMode) return;
      if (this._pickSticker(e) != null) {
        el.style.cursor = 'move';
        return;
      }
      const what = this._pick(e);
      this.gridHover = what === 'grid' ? this.pickIdx : -1;
      el.style.cursor = { handle: 'grab', slot: 'pointer', exit: 'pointer', open: 'pointer', grid: 'pointer', gridCard: 'pointer' }[what] || (this._pickBoardItem(e) != null ? 'pointer' : 'default');
    });
    const up = (e) => {
      if (this.dragSticker) {
        const d = this.dragSticker;
        this.dragSticker = null;
        // 放開的那一點也算（有的裝置最後一個 move 沒送到）
        const at = e?.type === 'pointerup' ? this.pickSurface({ clientX: e.clientX - d.dx, clientY: e.clientY - d.dy }) : null;
        if (at && (d.moved || Math.hypot(e.clientX - d.dx - (this._stickerScreen(d.si)?.x ?? 0), e.clientY - d.dy - (this._stickerScreen(d.si)?.y ?? 0)) > 3)) {
          d.moved = true;
          this.cb.onStickerMove?.(d.si, at);
        }
        if (d.moved) this.cb.onStickerDrop?.(d.si);
      }
      if (this.dragCard) {
        const d = this.dragCard;
        this.dragCard = null;
        const tap = Math.abs(d.dx) < 8 && performance.now() - d.t0 < 500;
        if (tap || Math.abs(d.dx) > 40) {
          this.flipDir = d.dx < -8 ? -1 : 1;
          this.cb.onOpenCapsule?.();
        } // 沒滑夠 → 彈回去（_frame 把傾斜收回 0）
      }
      if (this.dragHandle) {
        const d = this.dragHandle;
        this.dragHandle = null;
        // 只是點一下 → 自動轉
        if (d.moved < 0.25 && performance.now() - d.t0 < 400 && this.handleEnabled) this.autoTurn();
      }
      if (this.boardTap) {
        const b = this.boardTap;
        this.boardTap = null;
        if (e?.type === 'pointerup' && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 8 && performance.now() - b.t0 < 600) this.cb.onBoardItem?.(b.i);
      }
      this.dragYaw = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // 用機台自己的時鐘延遲（跟動畫同步；分頁在背景時也不會錯拍）
  after(sec, fn) {
    return new Promise((resolve) => {
      let t = 0;
      this.tweens.push({
        step: (dt) => {
          t += dt;
          if (t < sec) return false;
          fn?.();
          resolve();
          return true;
        },
      });
    });
  }

  tween(dur, fn) {
    return new Promise((resolve) => {
      let t = 0;
      this.tweens.push({
        step: (dt) => {
          t = Math.min(dur, t + dt);
          fn(t / dur);
          if (t >= dur) {
            resolve();
            return true;
          }
          return false;
        },
      });
    });
  }

  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.loaded) {
      // 轉盤速度＝把手角速度的 0.4 倍（放開後慢慢停）
      const hs = Math.max(0, (this.handleAngle - this._lastHA) / Math.max(dt, 1e-3));
      this._lastHA = this.handleAngle;
      if (this.kind === 'card' && this.turnFx) {
        // 轉越快動線越亮，停下來慢慢淡掉
        this.turnK = Math.max((this.turnK || 0) * Math.exp(-6 * dt), Math.min(1, hs / 5));
        for (const arc of this.turnFx.children) arc.material.opacity = 0.85 * this.turnK;
      }
      this.stirW = Math.max(this.stirW * Math.exp(-2.5 * dt), hs * 0.4);
      if (this.kind === 'omikuji') {
        this.omiShake = (this.omiShake || 0) * Math.exp(-4 * dt);
        const prev = this.omiStir;
        this.omiStir = Math.max(prev * Math.exp(-3 * dt), Math.min(1, hs * 0.25 + this.omiShake * 0.6));
        if (this.omiStir < 0.002) this.omiStir = 0;
        if (this.omiStir > 0 || prev > 0) this._syncSlips();
      }
      if (this.kind === 'capsule') {
        this.acc += dt;
        let n = 0;
        while (this.acc >= 1 / 120 && n < 4) {
          this._physics(1 / 120);
          this.acc -= 1 / 120;
          n++;
        }
        if (n === 4) this.acc = 0;
        this._syncPile();
      }
      stepCards(this.time);
      this.tweens = this.tweens.filter((tw) => !tw.step(dt));
      this.show.step(dt);
      this._foreshadowFrame();
      this._applyDim(dt);

      // 沒在操作 → 慢慢轉回斜前方
      this.idleT += dt;
      if (!this.dragYaw && this.idleT > 2.5) this.yawTarget += (this.restYaw - this.yawTarget) * Math.min(1, dt * 1.2);
      this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8);
      this.root.rotation.y = this.yaw;
      this.wobble *= Math.exp(-9 * dt);
      this.root.rotation.z = this.reduced ? 0 : Math.sin(this.time * 70) * 0.005 * this.wobble;

      // 提示：投幣口光圈、把手發光
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
      this.slotRing.material.opacity = this.slotHint ? 0.55 + 0.45 * pulse : 0;
      this.slotRing.scale.setScalar(this.slotHint ? 1 + pulse * this.slotRing.userData.pulse : 1);
      (this.kinds[this.kind]?.mats || this.mats).handle.emissive.setRGB(1, 0.75, 0.1).multiplyScalar(this.handleEnabled && !this.turning ? 0.08 + 0.18 * pulse : 0);
      if (this.exitGlow) this.exitLight.intensity = (this.exitGlow === 3 ? 1.6 : 1.0) * (0.6 + 0.4 * pulse);
      if (this.exitCap && this.exitCap.mat?.emissive) this.exitCap.mat.emissiveIntensity = this.exitGlow ? 0.15 + 0.25 * pulse : 0;
      if (this.exitCap?.float) {
        // 洞口上的籤：輕輕上下飄、左右轉，等你點
        const c = this.exitCap;
        c.g.position.copy(c.float).add(_v2.set(0, Math.sin(this.time * 2.2) * 0.012, 0));
        c.g.quaternion.copy(c.fq).multiply(_q.setFromAxisAngle(_y, Math.sin(this.time * 1.5) * 0.25));
      }
      if (this.openCap) {
        // 鏡頭前的扭蛋輕輕晃，等你點
        const c = this.openCap;
        if (c.home) {
          const want = this.dragCard ? this.dragCard.tilt : 0;
          this.cardTilt = (this.cardTilt || 0) + (want - (this.cardTilt || 0)) * Math.min(1, dt * 14);
          c.g.position.copy(c.home).add(new THREE.Vector3(0, Math.sin(this.time * 2.4) * 0.008, 0));
          c.g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_y, Math.sin(this.time * 1.7) * 0.18 * (this.dragCard ? 0.3 : 1) + this.cardTilt));
        }
      }
      // 翻開的卡片跟著游標（手機：陀螺儀）傾斜，閃卡的光、3D 照片的視差都跟著動；沒在動也會自己慢慢晃，看得出立體
      if (this.kind === 'card' || this.kind === 'omikuji') {
        const sway = this.reduced ? 0 : this.kind === 'omikuji' ? 0.15 : 0.3;
        const px = (this.ptr?.x || 0) * 0.85 + Math.sin(this.time * 0.9) * sway;
        const py = (this.ptr?.y || 0) * 0.85 + Math.sin(this.time * 0.7 + 1.3) * sway * 0.6;
        const tilt = (g, amt) => {
          if (!g.userData.baseQ || g.userData.scaling) return;
          _e.set(-py * amt * 0.7, px * amt, 0);
          g.quaternion.copy(g.userData.baseQ).multiply(_q.setFromEuler(_e));
        };
        if (this.revealed) tilt(this.revealed.g, 0.5);
        for (const m of this.gridCards || []) if (m?.userData.card) tilt(m, 0.32);
      }
      if (this.gridPick) {
        for (const c of this.grid || []) {
          if (!c?.home) continue;
          const g = c.g;
          g.position.copy(c.home).add(new THREE.Vector3(0, Math.abs(Math.sin(this.time * 3 + c.i * 0.9)) * 0.012, 0));
          g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_y, Math.sin(this.time * 1.6 + c.i) * 0.25));
          if (g.userData.scaling) continue;
          const s = g.userData.s0 * (this.gridHover === c.i ? 1.14 : 1);
          g.scale.setScalar(g.scale.x + (s - g.scale.x) * Math.min(1, dt * 14));
        }
      }
    }
    // 鏡頭震動
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT) * 0.03;
      this.camera.position.copy(this.camBase).add(new THREE.Vector3(rnd(-k, k), rnd(-k, k), 0));
    } else if (this.camBase) this.camera.position.copy(this.camBase);
    this.renderer.render(this.scene, this.camera);
  }
}

const _v1 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _x = new THREE.Vector3(1, 0, 0);
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

// 圓角方框（中間挖空）：轉卡機投幣縫的提示框
function rectFrame({ w, h, t }) {
  const rr = (sh, x, y, ww, hh, r) => {
    sh.moveTo(x + r, y);
    sh.lineTo(x + ww - r, y);
    sh.quadraticCurveTo(x + ww, y, x + ww, y + r);
    sh.lineTo(x + ww, y + hh - r);
    sh.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
    sh.lineTo(x + r, y + hh);
    sh.quadraticCurveTo(x, y + hh, x, y + hh - r);
    sh.lineTo(x, y + r);
    sh.quadraticCurveTo(x, y, x + r, y);
  };
  const outer = new THREE.Shape();
  rr(outer, -w / 2 - t, -h / 2 - t, w + 2 * t, h + 2 * t, t * 1.4);
  const hole = new THREE.Path();
  rr(hole, -w / 2, -h / 2, w, h, t * 0.6);
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer, 6);
}

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}
