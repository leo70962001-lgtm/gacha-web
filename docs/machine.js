// 3D 轉蛋機：模型（Blender → assets/gacha.glb）、窗內扭蛋物理、投幣、把手、出蛋、開蛋特效
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './sfx.js';
import { RARITY, drawLid, drawPrice, drawArrow, drawLabel, drawCard, drawSide } from './decor.js';
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
const FRONT = 0.3575; // 機身正面
const HOLE = { x: -0.15, z: 0.06 }; // 窗內底部的出蛋孔（正上方就是出口）
const DISC = { x: 0, z: 0.06 }; // 轉盤中心（跟著把手轉）
const MAX_PILE = 300; // 畫面上最多放幾顆

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
    this.root.add(gltf.scene);
    this.handleBase = this.handle.rotation.z;

    // 點擊判定用的隱形物件
    this.slotHit = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.slotHit.position.copy(SLOT);
    this.root.add(this.slotHit);
    // 投幣口提示光圈
    this.slotRing = new THREE.Mesh(
      new THREE.RingGeometry(0.056, 0.078, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.slotRing.position.set(SLOT.x, SLOT.y, FRONT + 0.004);
    this.root.add(this.slotRing);
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
    this.loaded = true;
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
    if (!this.loaded) return;
    this.mats.body.color.set(t.body);
    this.mats.lid.color.set(t.lid);
    this.mats.handle.color.set(t.handle);
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
    this.root.add(mesh);
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
    this.root.add(sh);
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
    set('exit', drawLabel(t('d.exit'), 'left'));
    set('ret', drawLabel(t('d.return'), 'down', '#2f6bdb'));
  }

  // 機台名稱、價錢、陣容改了 → 重畫貼紙與台紙
  updateDecor(cfg, thumbs) {
    if (!this.loaded) return;
    const t = this.theme || THEMES.red;
    const set = (d, c) => {
      const old = this.decals[d].material.map;
      this.decals[d].material.map = canvasTex(c);
      this.decals[d].material.needsUpdate = true;
      if (old) old.dispose();
    };
    set('lid', drawLid(cfg, t, this.art.banner));
    set('price', drawPrice(cfg, this.art.badge));
    set('card', drawCard(cfg, thumbs, this.art.card));
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
    if (!this.loaded) return;
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
    return this._toScreen(this.root.localToWorld(SLOT.clone()));
  }

  setSlotHint(on) {
    this.slotHint = on;
  }

  // 從螢幕上的一點把硬幣丟進投幣口
  insertCoin(sx, sy) {
    const coin = new THREE.Mesh(this.coinGeo, this.mats.coin);
    coin.castShadow = true;
    addOutline(coin, 0.0018, this.hullCache);
    const slotW = this.root.localToWorld(SLOT.clone());
    const camD = this.camera.position.distanceTo(slotW);
    const start = this._fromScreen(sx, sy, camD * 0.72);
    const startL = this.root.worldToLocal(start.clone());
    this.root.add(coin);
    const front = new THREE.Vector3(SLOT.x, SLOT.y, FRONT + 0.06);
    const inside = new THREE.Vector3(SLOT.x, SLOT.y, FRONT - 0.05);
    const spin0 = rnd(2, 4);
    return this.tween(0.42, (k) => {
      const e = ease.inOut(k);
      coin.position.lerpVectors(startL, front, e);
      coin.position.y += Math.sin(k * Math.PI) * 0.08;
      // 硬幣立起來對準直的投幣孔
      coin.rotation.set(0, (1 - e) * spin0, (Math.PI / 2) * e + (1 - e) * 0.3);
    })
      .then(() => {
        sfx.coin();
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
    if (!level) this.pileBot.material.emissive.setRGB(0, 0, 0);
  }

  _foreshadowFrame() {
    const lv = this.foreshadow;
    const turning = this.turning || this.dragHandle || this.quickTurning;
    const k = lv && turning ? 1 : 0;
    this.fsK = (this.fsK || 0) + (k - (this.fsK || 0)) * 0.12;
    const f = this.fsK;
    if (f < 0.01) {
      this.lidLight.intensity = 0;
      this.pileBot.material.emissive.setRGB(0, 0, 0);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
    const col = lv === 3 ? _c.setHSL((this.time * 0.6) % 1, 0.9, 0.6) : _c.set('#ffc93c');
    this.pileBot.material.emissive.copy(col).multiplyScalar(f * (0.25 + 0.35 * pulse));
    this.lidLight.color.copy(col);
    this.lidLight.intensity = f * (1.5 + 2.5 * pulse);
    if (lv === 3 && Math.random() < f * 0.5) this.show.riseSpark(this.root.localToWorld(new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.8, 1.1), rnd(-0.05, 0.3))));
  }

  _setHandle(a) {
    this.handleAngle = a;
    this.handle.rotation.z = this.handleBase - a; // 順時針（從正面看）
  }

  _handleTick(prev, next) {
    const step = Math.PI / 4;
    if (Math.floor(next / step) > Math.floor(prev / step)) {
      sfx.tick();
      this.shakePile(0.35);
      this.wobble = 1; // 機台跟著抖一下
      this.cb.onTick?.(next / (Math.PI * 2));
      if (Math.floor(next / step) % 2 === 0) sfx.rattle();
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
  dispense(rarity) {
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
    const to = this._inFront(1.2, -0.02);
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.28, 0));
    const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.5, 0.12));
    // 讓開口（接縫）朝向鏡頭一點
    qTo.premultiply(new THREE.Quaternion().setFromUnitVectors(_y, this.camera.position.clone().sub(to).normalize().lerp(_y, 0.6).normalize()));
    this.exitCap = null;
    this.openCap = c;
    return this.tween(0.75, (k) => {
      const e = ease.out(k);
      // 二次貝茲曲線
      const a = from.clone().lerp(mid, e);
      const b = mid.clone().lerp(to, e);
      g.position.copy(a.lerp(b, e));
      g.quaternion.slerpQuaternions(q0, qTo, e);
      g.scale.setScalar(s0 + (1.15 - s0) * e); // 不管窗裡的扭蛋多小，拿到鏡頭前都一樣大
    }).then(() => {
      c.home = to.clone();
      c.q = g.quaternion.clone();
    });
  }

  // 開蛋：依稀有度跑演出表（fx.js 的 TIERS）
  //   N/R：抖一抖就打開；SR/SSR：先變暗、集氣（SSR 可能升格），再爆開
  async openCapsule() {
    const c = this.openCap;
    if (!c) return;
    this.openCap = null;
    const g = c.g;
    const r = c.rarity;
    const T = TIERS[r];
    const home = c.home;
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

  // ---------- 10 連抽 ----------
  // 每顆：窗裡掉一顆 → 出口跳出 → 飛到鏡頭前的格子（橫向 5×2、直向 2×5）
  _gridSlot(i, n) {
    const portrait = this.camera.aspect < 0.85;
    const cols = portrait ? 2 : Math.min(5, n);
    const rows = Math.ceil(n / cols);
    const dist = 1.7;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const viewH = 2 * dist * tanV;
    const viewW = viewH * this.camera.aspect;
    const step = Math.min(0.2, (viewW * 0.86) / cols, (viewH * 0.62) / rows);
    const c = i % cols;
    const r = Math.floor(i / cols);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return {
      pos: this.camera.position.clone().addScaledVector(fwd, dist)
        .addScaledVector(right, (c - (cols - 1) / 2) * step)
        .addScaledVector(up, ((rows - 1) / 2 - r) * step + viewH * 0.06),
      scale: (step / (2 * CAP_R)) * 0.78,
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
  dispenseToGrid(i, n, rarity) {
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
    this.grid = this.grid || [];
    this.grid[i] = c;
    // 1) 出口掉下來（快）
    return this.tween(0.32, (k) => {
      g.position.set(EXIT.x, 0.38 - (0.38 - floorY) * k * k, EXIT.z0 + (EXIT.z1 - EXIT.z0) * k);
      g.rotation.x += 0.2;
    })
      .then(() => {
        sfx.thud(0.6);
        // 2) 飛到格子
        const from = g.getWorldPosition(new THREE.Vector3());
        const q0 = g.getWorldQuaternion(new THREE.Quaternion());
        this.root.remove(g);
        this.fx.add(g);
        g.position.copy(from);
        g.quaternion.copy(q0);
        const slot = this._gridSlot(i, n);
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
          c.home = slot.pos.clone();
          c.q = g.quaternion.clone();
          if (shown >= 2) this.show.gridGlow(c, shown);
        });
      });
  }

  // 小開：普通扭蛋在格子裡直接啵開
  popInGrid(i) {
    const c = this.grid?.[i];
    if (!c) return Promise.resolve();
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
  async openFromGrid(i) {
    const c = this.grid?.[i];
    if (!c) return;
    this.grid[i] = null;
    const g = c.g;
    const to = this._inFront(1.2, -0.02);
    const from = g.position.clone();
    const s0 = g.scale.x;
    // 其他還沒開的退到旁邊淡掉一點
    await this.tween(0.55, (k) => {
      const e = ease.inOut(k);
      g.position.lerpVectors(from, to, e);
      g.scale.setScalar(s0 + (1.15 - s0) * e);
    });
    c.home = to.clone();
    c.q = g.quaternion.clone();
    this.openCap = c;
    await this.openCapsule();
  }

  clearGrid() {
    for (const c of this.grid || []) if (c) this.fx.remove(c.g);
    this.grid = [];
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
    if (this.exitCap) this.root.remove(this.exitCap.g);
    if (this.openCap) this.fx.remove(this.openCap.g);
    this.exitCap = this.openCap = null;
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
    this.decals.card.material.color.setScalar(1 - 0.7 * k);
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
  }

  // 畫面上下被 UI 蓋住的高度（px）：機器要放在剩下的空間裡
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    this._frameCamera();
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
    const corners = [];
    for (const x of [-0.36, 0.36]) for (const y of [0, 1.37]) for (const z of [-0.45, 0.43]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(rot));
    const dir = new THREE.Vector3(0.0, 0.3, 1).normalize();
    const target = new THREE.Vector3(0, 0.66, 0.05);
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
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let o = hit.object;
    if (o === this.handle) return 'handle';
    if (o === this.slotHit) return 'slot';
    while (o.parent && o !== this.exitCap?.g && o !== this.openCap?.g) o = o.parent;
    if (o === this.exitCap?.g) return 'exit';
    if (o === this.openCap?.g) return 'open';
    return null;
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      const what = this._pick(e);
      this.idleT = 0;
      if (what === 'handle') {
        if (!this.handleEnabled || this.turning) {
          if (!this.turning) {
            this.wiggleHandle();
            this.cb.onHandleLocked?.();
          }
          return;
        }
        el.setPointerCapture(e.pointerId);
        const c = this._toScreen(this.root.localToWorld(HANDLE_C.clone()));
        this.dragHandle = { c, last: Math.atan2(e.clientY - c.y, e.clientX - c.x), moved: 0, t0: performance.now() };
        return;
      }
      if (what === 'slot') return this.cb.onSlot?.(e.clientX, e.clientY);
      if (what === 'exit') return this.cb.onExitCapsule?.();
      if (what === 'open') return this.cb.onOpenCapsule?.();
      // 空白處拖曳 → 轉機台看側面
      el.setPointerCapture(e.pointerId);
      this.dragYaw = { x: e.clientX, yaw: this.yawTarget };
    });
    el.addEventListener('pointermove', (e) => {
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
      el.style.cursor = { handle: 'grab', slot: 'pointer', exit: 'pointer', open: 'pointer' }[this._pick(e)] || 'default';
    });
    const up = () => {
      if (this.dragHandle) {
        const d = this.dragHandle;
        this.dragHandle = null;
        // 只是點一下 → 自動轉
        if (d.moved < 0.25 && performance.now() - d.t0 < 400 && this.handleEnabled) this.autoTurn();
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
      this.stirW = Math.max(this.stirW * Math.exp(-2.5 * dt), hs * 0.4);
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / 120 && n < 4) {
        this._physics(1 / 120);
        this.acc -= 1 / 120;
        n++;
      }
      if (n === 4) this.acc = 0;
      this._syncPile();
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
      this.slotRing.scale.setScalar(this.slotHint ? 1 + pulse * 0.25 : 1);
      this.mats.handle.emissive.setRGB(1, 0.75, 0.1).multiplyScalar(this.handleEnabled && !this.turning ? 0.08 + 0.18 * pulse : 0);
      if (this.exitGlow) this.exitLight.intensity = (this.exitGlow === 3 ? 1.6 : 1.0) * (0.6 + 0.4 * pulse);
      if (this.exitCap && this.exitCap.mat.emissive) this.exitCap.mat.emissiveIntensity = this.exitGlow ? 0.15 + 0.25 * pulse : 0;
      if (this.openCap) {
        // 鏡頭前的扭蛋輕輕晃，等你點
        const c = this.openCap;
        if (c.home) {
          c.g.position.copy(c.home).add(new THREE.Vector3(0, Math.sin(this.time * 2.4) * 0.008, 0));
          c.g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_y, Math.sin(this.time * 1.7) * 0.18));
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
const _x = new THREE.Vector3(1, 0, 0);
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

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
