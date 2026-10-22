// 3D 轉蛋機：模型（Blender → assets/gacha.glb）、窗內扭蛋物理、投幣、把手、出蛋、開蛋特效
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './sfx.js';
import { RARITY, drawLid, drawPrice, drawArrow, drawLabel, drawCard, drawSide } from './decor.js';

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
// 三階明暗：受光、半影、暗部；NearestFilter 讓色階是硬邊
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
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
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normalize(normal) * uW, 1.0); }`,
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
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
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
    // 亮面 ≈ 環境 0.45 + 主光 0.6（three.js 的漫射要除以 π）
    s.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 1.9));
    key.position.set(-1.6, 3.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.2;
    key.shadow.camera.right = 1.2;
    key.shadow.camera.top = 1.8;
    key.shadow.camera.bottom = -0.4;
    key.shadow.camera.far = 8;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 1.5;
    s.add(key);

    // 地板＝背景色（不受光）＋只畫影子的一層 → 地板和背景接得起來
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0xdce6ec });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
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
    this.capRare = [null, null, toon({ color: 0xe4e9f0, emissive: 0x7a4ad8, emissiveIntensity: 0 }), toon({ color: 0xffc634, emissive: 0xff9a00, emissiveIntensity: 0 })];
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
    // 出口內的光（稀有扭蛋）
    this.exitLight = new THREE.PointLight(0xffffff, 0, 0.9, 2);
    this.exitLight.position.set(EXIT.x, 0.2, 0.3);
    this.root.add(this.exitLight);

    this._buildDecals();
    this._buildFx();
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

  setStage(bg, floor) {
    this.scene.background.set(bg);
    this.scene.fog.color.set(bg);
    this.floorMat.color.set(floor);
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
    const arrow = canvasTex(drawArrow());
    this.decals.arrow.material.map = arrow;
    this.decals.exit.material.map = canvasTex(drawLabel('取出口', 'left'));
    this.decals.ret.material.map = canvasTex(drawLabel('退幣口', 'down', '#2f6bdb'));
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
  _makeCapsule(mat) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(this.capTopGeo, this.mats.capClear);
    const bot = new THREE.Mesh(this.capBotGeo, mat);
    top.renderOrder = 2;
    bot.castShadow = true;
    addOutline(bot, 0.0028, this.hullCache);
    g.add(top, bot);
    g.userData = { top, bot };
    return g;
  }

  setPile(count) {
    if (!this.loaded) return;
    const n = Math.min(count, 24); // 堆太高會擋住台紙
    while (this.pile.length > n) {
      const c = this.pile.pop();
      this.root.remove(c.g);
    }
    let spawned = 0;
    while (this.pile.length < n) {
      const g = this._makeCapsule(this.capMats[(this.pile.length * 5 + 3) % this.capMats.length]);
      const c = {
        g,
        p: new THREE.Vector3(rnd(-0.28, 0.28), 0.86 + spawned * 0.035 + rnd(0, 0.05), rnd(-0.06, 0.25)),
        v: new THREE.Vector3(),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.6, 0.6), rnd(0, 6.28), rnd(-0.6, 0.6))),
      };
      g.position.copy(c.p);
      this.root.add(g);
      this.pile.push(c);
      spawned++;
    }
    // 先讓它們落定，第一眼看到的就是堆好的樣子
    if (spawned > 4) for (let i = 0; i < 360; i++) this._physics(1 / 120);
    this._syncPile();
  }

  shakePile(k = 1) {
    for (const c of this.pile) {
      if (c.p.y > 1.0) continue;
      c.v.x += rnd(-0.5, 0.5) * k;
      c.v.y += rnd(0.3, 0.9) * k;
      c.v.z += rnd(-0.4, 0.4) * k;
    }
  }

  _physics(dt) {
    const P = this.pile;
    const R = CAP_R;
    for (const c of P) {
      c.v.y -= 9.8 * dt;
      c.v.multiplyScalar(0.998);
      c.p.addScaledVector(c.v, dt);
    }
    for (let it = 0; it < 3; it++) {
      for (const c of P) {
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
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          const a = P[i];
          const b = P[j];
          const d = _v1.subVectors(b.p, a.p);
          const dist = d.length();
          if (dist < 2 * R && dist > 1e-6) {
            d.multiplyScalar(1 / dist);
            const pen = (2 * R - dist) / 2;
            a.p.addScaledVector(d, -pen);
            b.p.addScaledVector(d, pen);
            const vr = _v2.subVectors(b.v, a.v).dot(d);
            if (vr < 0) {
              const imp = -vr * 0.6;
              a.v.addScaledVector(d, -imp);
              b.v.addScaledVector(d, imp);
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
      if (c.v.lengthSq() < 0.0004) c.v.multiplyScalar(0.8); // 快停了就讓它停
    }
  }

  _syncPile() {
    for (const c of this.pile) {
      c.g.position.copy(c.p);
      c.g.quaternion.copy(c.q);
    }
  }

  // 出蛋時從堆裡拿走一顆（最靠出口那側、最下面的）
  _takeFromPile() {
    if (!this.pile.length) return;
    let best = 0;
    let score = Infinity;
    this.pile.forEach((c, i) => {
      const s = c.p.y + Math.abs(c.p.x - EXIT.x) * 0.3;
      if (s < score) (score = s), (best = i);
    });
    const [c] = this.pile.splice(best, 1);
    const p0 = c.g.position.clone();
    this.tween(0.35, (k) => {
      c.g.position.set(p0.x, p0.y - 0.08 * k, p0.z);
      c.g.scale.setScalar(1 - k);
    }).then(() => this.root.remove(c.g));
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

  _setHandle(a) {
    this.handleAngle = a;
    this.handle.rotation.z = this.handleBase - a; // 順時針（從正面看）
  }

  _handleTick(prev, next) {
    const step = Math.PI / 4;
    if (Math.floor(next / step) > Math.floor(prev / step)) {
      sfx.tick();
      this.shakePile(0.35);
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
    this._takeFromPile();
    const mat = rarity >= 2 ? this.capRare[rarity] : this.capMats[Math.floor(Math.random() * this.capMats.length)];
    const g = this._makeCapsule(mat);
    g.position.set(EXIT.x, 0.42, EXIT.z0);
    g.quaternion.setFromEuler(new THREE.Euler(rnd(-1, 1), rnd(0, 6), rnd(-1, 1)));
    this.root.add(g);
    this.exitCap = { g, rarity, mat };
    const floorY = EXIT.floor + CAP_R;
    let y = 0.42;
    let vy = -0.4;
    let z = EXIT.z0;
    let bounces = 0;
    let t = 0;
    return new Promise((resolve) => {
      this.tweens.push({
        step: (dt) => {
          t += dt;
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
      if (rarity >= 2) {
        this.exitLight.color.set(RARITY[rarity].glow);
        this.exitGlow = rarity;
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
      g.scale.setScalar(1 + 0.15 * e);
    }).then(() => {
      c.home = to.clone();
      c.q = g.quaternion.clone();
    });
  }

  // 開蛋：先抖、再「啵」一聲打開，依稀有度放特效
  openCapsule() {
    const c = this.openCap;
    if (!c) return Promise.resolve();
    this.openCap = null;
    const g = c.g;
    sfx.shake();
    const home = c.home;
    return this.tween(this.reduced ? 0.2 : 0.62, (k) => {
      const a = Math.sin(k * 38) * 0.12 * k;
      g.position.set(home.x + Math.sin(k * 45) * 0.01 * k, home.y, home.z);
      g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_z, a));
    }).then(() => {
      sfx.pop();
      const { top, bot } = g.userData;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      const camR = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const t0 = top.position.clone();
      const b0 = bot.position.clone();
      top.material = top.material.clone();
      bot.material = bot.material.clone();
      bot.material.transparent = true;
      const line = bot.getObjectByName('outline');
      line.material = line.material.clone();
      line.material.transparent = true;
      this.burst(c.rarity, home);
      const upL = g.worldToLocal(home.clone().add(up)).sub(g.worldToLocal(home.clone()));
      const rL = g.worldToLocal(home.clone().add(camR)).sub(g.worldToLocal(home.clone()));
      this.tween(0.9, (k) => {
        const e = ease.out(k);
        top.position.copy(t0).addScaledVector(upL, 0.16 * e).addScaledVector(rL, 0.1 * e);
        top.rotation.set(-1.4 * e, 0, -0.9 * e);
        bot.position.copy(b0).addScaledVector(upL, -0.2 * e * e).addScaledVector(rL, -0.06 * e);
        bot.rotation.set(0.9 * e, 0, 0.6 * e);
        top.material.uniforms.uOpacity.value = 1 - k;
        bot.material.opacity = 1 - k;
        line.material.uniforms.uOpacity.value = 1 - k;
      }).then(() => this.fx.remove(g));
      return new Promise((r) => setTimeout(r, 380));
    });
  }

  // 收掉還留在畫面上的扭蛋（換機台、補貨時）
  clearCapsules() {
    if (this.exitCap) this.root.remove(this.exitCap.g);
    if (this.openCap) this.fx.remove(this.openCap.g);
    this.exitCap = this.openCap = null;
    this.exitGlow = 0;
    this.exitLight.intensity = 0;
  }

  // ---------- 特效 ----------
  _buildFx() {
    const rays = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color() }, uA: { value: 0 }, uN: { value: 12 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform float uT, uA, uN; uniform vec3 uC; varying vec2 vUv;
        void main(){ vec2 p = vUv*2.-1.; float r = length(p); float a = atan(p.y,p.x);
          float rays = pow(abs(sin(a*uN*.5 + uT*.7)), 10.) * .9 + pow(abs(sin(a*uN*.25 - uT*.4)), 30.) * .6;
          float fall = smoothstep(1., .05, r); float core = smoothstep(.42, 0., r);
          float v = (rays * fall + core * 0.9) * uA;
          gl_FragColor = vec4(uC * v, 1.); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), rays);
    this.rays.renderOrder = 50;
    this.rays.visible = false;
    this.fx.add(this.rays);

    // 彩帶
    const N = 220;
    this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.016, 0.009),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false }),
      N,
    );
    this.confetti.renderOrder = 60;
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.confettiData = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
    this.fx.add(this.confetti);

    // 星星閃光
    const star = document.createElement('canvas');
    star.width = star.height = 64;
    const g = star.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 0);
    g.quadraticCurveTo(35, 29, 64, 32);
    g.quadraticCurveTo(35, 35, 32, 64);
    g.quadraticCurveTo(29, 35, 0, 32);
    g.quadraticCurveTo(29, 29, 32, 0);
    g.fill();
    this.starTex = canvasTex(star);
    this.sparks = Array.from({ length: 26 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
      s.renderOrder = 70;
      s.visible = false;
      this.fx.add(s);
      return { s, p: new THREE.Vector3(), v: new THREE.Vector3(), ph: 0, life: 0 };
    });
  }

  burst(rarity, at) {
    const R = RARITY[rarity];
    const palettes = [
      ['#e8423b', '#f6b91a', '#2f7fe0', '#36c18f', '#ffffff'],
      ['#2f80ed', '#8cc3ff', '#ffffff', '#36c18f', '#f6b91a'],
      ['#a45cf0', '#e3c7ff', '#ffffff', '#ef6fa8', '#8cc3ff'],
      ['#ffcf33', '#fff2b0', '#ffffff', '#ff8a3d', '#ffe28a'],
    ];
    const pal = palettes[rarity].map((c) => new THREE.Color(c));
    const scale = this.reduced ? 0.35 : 1;
    // 光芒
    const rm = this.rays.material.uniforms;
    rm.uC.value.set(R.glow);
    rm.uN.value = [8, 12, 16, 20][rarity];
    this.rays.position.copy(at);
    this.rays.lookAt(this.camera.position);
    this.rays.visible = true;
    const rayScale = [0.45, 0.65, 0.95, 1.4][rarity];
    this.tween(rarity >= 2 ? 2.6 : 1.4, (k) => {
      rm.uA.value = (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88) * [0.35, 0.6, 0.9, 1.15][rarity];
      this.rays.scale.setScalar(rayScale * (0.6 + 0.6 * ease.out(Math.min(1, k * 2))));
    }).then(() => (this.rays.visible = false));
    // 彩帶
    const n = Math.round([70, 110, 160, 220][rarity] * scale);
    const camUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.confettiData.forEach((d, i) => {
      d.alive = i < n;
      d.p.copy(at);
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize();
      d.v.copy(dir).multiplyScalar(rnd(0.5, 1.5) * (0.8 + rarity * 0.15)).addScaledVector(camUp, 0.5);
      d.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      d.w.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
      this.confetti.setColorAt(i, pal[i % pal.length]);
    });
    this.confetti.instanceColor.needsUpdate = true;
    this.confetti.visible = true;
    this.confettiT = 0;
    // 星星（SR 以上）
    if (rarity >= 1) {
      const m = [0, 8, 16, 26][rarity];
      this.sparks.forEach((s, i) => {
        s.life = i < m ? rnd(1.2, 2.4) : 0;
        s.p.copy(at).add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-0.2, 0.3), rnd(-0.3, 0.3)));
        s.v.set(rnd(-0.1, 0.1), rnd(0.02, 0.15), rnd(-0.1, 0.1));
        s.ph = rnd(0, 6);
        s.s.material.color.set(i % 3 ? R.glow : '#ffffff');
      });
    }
    // 隱藏版：鏡頭震動
    if (rarity === 3 && !this.reduced) this.shakeT = 0.55;
  }

  _fxStep(dt) {
    if (this.confetti.visible) {
      this.confettiT += dt;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1);
      this.confettiData.forEach((d, i) => {
        if (!d.alive) {
          m.makeScale(0, 0, 0);
          this.confetti.setMatrixAt(i, m);
          return;
        }
        d.v.y -= 1.6 * dt;
        d.v.multiplyScalar(1 - 1.6 * dt);
        d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt;
        d.r.y += d.w.y * dt;
        d.r.z += d.w.z * dt;
        q.setFromEuler(d.r);
        m.compose(d.p, q, s);
        this.confetti.setMatrixAt(i, m);
      });
      this.confetti.instanceMatrix.needsUpdate = true;
      this.confetti.material.opacity = Math.max(0, 1 - Math.max(0, this.confettiT - 2) / 0.8);
      if (this.confettiT > 2.8) this.confetti.visible = false;
    }
    for (const sp of this.sparks) {
      if (sp.life <= 0) {
        sp.s.visible = false;
        continue;
      }
      sp.life -= dt;
      sp.ph += dt * 9;
      sp.p.addScaledVector(sp.v, dt);
      sp.s.position.copy(sp.p);
      const tw = 0.5 + 0.5 * Math.sin(sp.ph);
      sp.s.scale.setScalar(0.03 + 0.05 * tw);
      sp.s.material.opacity = Math.min(1, sp.life) * (0.4 + 0.6 * tw);
      sp.s.visible = true;
    }
  }

  // ---------- 畫面與輸入 ----------
  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._frameCamera();
  }

  // 畫面上下被 UI 蓋住的高度（px）：機器要放在剩下的空間裡
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    this._frameCamera();
  }

  // 讓整台機器剛好入鏡：直式螢幕要退遠一點
  _frameCamera() {
    const a = this.camera.aspect;
    const H = this.host.clientHeight || 1;
    const { top = 0, bottom = 0 } = this.insets || {};
    const f = Math.max(0.35, (H - top - bottom) / H); // 可用的高度比例
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const needH = 0.86 / (tanV * f);
    const needW = 0.62 / (tanV * a);
    const d = Math.max(needH, needW) * (this.zoom || 1);
    const target = new THREE.Vector3(0, 0.66, 0.05);
    // 可用空間的中心比畫面中心低 → 鏡頭目標往上移，機器就落在空間中間
    target.y += ((top - bottom) / H) * d * tanV;
    const dir = new THREE.Vector3(0.0, 0.3, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, d);
    this.camera.lookAt(target);
    this.camBase = this.camera.position.clone();
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
      this._fxStep(dt);

      // 沒在操作 → 慢慢轉回斜前方
      this.idleT += dt;
      if (!this.dragYaw && this.idleT > 2.5) this.yawTarget += (this.restYaw - this.yawTarget) * Math.min(1, dt * 1.2);
      this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8);
      this.root.rotation.y = this.yaw;

      // 提示：投幣口光圈、把手發光
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
      this.slotRing.material.opacity = this.slotHint ? 0.55 + 0.45 * pulse : 0;
      this.slotRing.scale.setScalar(this.slotHint ? 1 + pulse * 0.25 : 1);
      this.mats.handle.emissive.setRGB(1, 0.75, 0.1).multiplyScalar(this.handleEnabled && !this.turning ? 0.08 + 0.18 * pulse : 0);
      if (this.exitGlow) this.exitLight.intensity = (this.exitGlow === 3 ? 1.6 : 1.0) * (0.6 + 0.4 * pulse);
      if (this.exitCap && this.exitCap.rarity >= 2) this.exitCap.mat.emissiveIntensity = 0.15 + 0.25 * pulse;
      if (this.openCap) {
        // 鏡頭前的扭蛋輕輕晃，等你點
        const c = this.openCap;
        if (c.home) {
          c.g.position.copy(c.home).add(new THREE.Vector3(0, Math.sin(this.time * 2.4) * 0.008, 0));
          c.g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_y, Math.sin(this.time * 1.7) * 0.18));
        }
      }
      if (this.rays.visible) {
        this.rays.material.uniforms.uT.value = this.time;
        this.rays.lookAt(this.camera.position);
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
