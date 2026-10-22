// 開蛋演出：越稀有越華麗
//   N   啵一聲、小彩帶
//   R   藍光芒、一圈衝擊波、星星
//   SR  場景變暗 → 接縫透光＋光粒子集氣 → 雙層光芒、光柱、兩圈衝擊波、煙火、紫色閃光
//   SSR 全暗＋心跳 → 長集氣（一半機率先假裝銀蛋，集氣到一半「升格」變金蛋）
//       → 彩虹光芒、金光柱、三圈衝擊波、五發煙火、金幣雨、強震、白閃
import * as THREE from 'three';
import { sfx } from './sfx.js';
import { RARITY } from './decor.js';

// 每個稀有度的演出表（秒／個數）
export const TIERS = [
  { shake: 0.45, charge: 0, dim: 0, rays: 0, rings: 0, pillar: 0, fireworks: 0, confetti: 50, sparks: 0, camShake: 0, reveal: 0.45, glow: 0.22 },
  { shake: 0.6, charge: 0, dim: 0.2, rays: 1, rings: 1, pillar: 0, fireworks: 0, confetti: 110, sparks: 12, camShake: 0, reveal: 0.8, glow: 0.3 },
  { shake: 0.5, charge: 1.3, dim: 0.62, rays: 2, rings: 2, pillar: 1, fireworks: 2, confetti: 170, sparks: 26, camShake: 0.25, reveal: 1.6, glow: 0.4 },
  { shake: 0.6, charge: 2.3, dim: 0.9, rays: 3, rings: 3, pillar: 1, fireworks: 5, confetti: 260, sparks: 44, camShake: 0.7, reveal: 2.8, glow: 0.5, coins: 70 },
];
const PALETTES = [
  ['#e8423b', '#f6b91a', '#2f7fe0', '#36c18f', '#ffffff'],
  ['#2f80ed', '#8cc3ff', '#ffffff', '#5fd1ff', '#c9e6ff'],
  ['#a45cf0', '#e3c7ff', '#ffffff', '#ef6fa8', '#b8a2ff'],
  ['#ffcf33', '#fff2b0', '#ffffff', '#ff8a3d', '#ffe28a'],
];
const BEAM = ['#ffffff', '#6fb6ff', '#c79bff', '#ffd54a'];

const rnd = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class Spectacle {
  constructor(m) {
    this.m = m; // Machine：tween、camera、fx 群組、reduced
    this.g = m.fx;
    this.time = 0;
    this._build();
  }

  _build() {
    const g = this.g;
    // 光芒：放射狀光束（第二層反方向轉；SSR 彩虹）
    const raysMat = () =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color() }, uA: { value: 0 }, uN: { value: 12 }, uDir: { value: 1 }, uRainbow: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `uniform float uT, uA, uN, uDir, uRainbow; uniform vec3 uC; varying vec2 vUv;
          vec3 hue(float h){ return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); }
          void main(){ vec2 p = vUv*2.-1.; float r = length(p); float a = atan(p.y,p.x);
            float rays = pow(abs(sin(a*uN*.5 + uDir*uT*.7)), 10.) * .9 + pow(abs(sin(a*uN*.25 - uDir*uT*.4)), 30.) * .6;
            float fall = smoothstep(1., .05, r); float core = smoothstep(.42, 0., r);
            vec3 col = mix(uC, mix(uC, hue(a/6.2832 + uT*.12), .85), uRainbow);
            float v = (rays * fall + core * .9) * uA;
            gl_FragColor = vec4(col * v, 1.); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
    this.rays = [0, 1].map((i) => {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), raysMat());
      r.material.uniforms.uDir.value = i ? -1 : 1;
      r.renderOrder = 50 + i;
      r.visible = false;
      g.add(r);
      return r;
    });

    // 中心爆光
    this.glowTex = radialTex();
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.core.renderOrder = 55;
    this.core.visible = false;
    g.add(this.core);

    // 衝擊波：往外擴散的光圈
    this.rings = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 96),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
      );
      m.renderOrder = 56;
      m.visible = false;
      g.add(m);
      return m;
    });

    // 光柱：從下往上穿過扭蛋的直光
    this.pillar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 5),
      new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color() }, uA: { value: 0 }, uW: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `uniform vec3 uC; uniform float uA, uW; varying vec2 vUv;
          void main(){ float x = abs(vUv.x - .5) * 2. / max(uW, .001); float core = pow(clamp(1. - x, 0., 1.), 3.);
            float hot = pow(clamp(1. - x * 3., 0., 1.), 2.);
            float y = smoothstep(0., .25, vUv.y) * smoothstep(1., .6, vUv.y);
            vec3 col = mix(uC, vec3(1.), hot);
            gl_FragColor = vec4(col * (core + hot) * y * uA, 1.); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.pillar.renderOrder = 49;
    this.pillar.visible = false;
    g.add(this.pillar);

    // 接縫透光（集氣時）
    this.seam = new THREE.Mesh(
      new THREE.TorusGeometry(0.067, 0.0045, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.seam.rotation.x = Math.PI / 2;
    this.seam.renderOrder = 5;
    // 打在扭蛋上的光（場景變暗時扭蛋本身還看得到）
    this.capLight = new THREE.PointLight(0xffffff, 0, 1.6, 1.5);
    g.add(this.capLight);

    // 彩帶
    const N = 260;
    this.confetti = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.016, 0.009),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false }),
      N,
    );
    this.confetti.renderOrder = 60;
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.confettiData = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), alive: false }));
    this.confetti.setColorAt(0, new THREE.Color());
    g.add(this.confetti);

    // 金幣雨（SSR）
    const coinGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.0025, 20);
    coinGeo.rotateX(Math.PI / 2);
    this.coins = new THREE.InstancedMesh(coinGeo, new THREE.MeshToonMaterial({ color: 0xffc634, emissive: 0x7a4a00, gradientMap: this.m.ramp }), 80);
    this.coins.renderOrder = 61;
    this.coins.frustumCulled = false;
    this.coins.visible = false;
    this.coinData = Array.from({ length: 80 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), alive: false }));
    g.add(this.coins);

    // 星星閃光
    this.starTex = starTex();
    this.sparks = Array.from({ length: 44 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
      s.renderOrder = 70;
      s.visible = false;
      g.add(s);
      return { s, p: new THREE.Vector3(), v: new THREE.Vector3(), ph: 0, life: 0 };
    });

    // 光粒子（集氣往內收、煙火往外炸）：一個 Points，自己管粒子池
    const P = 900;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(P * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(P), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(P), 1));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uPix: { value: Math.min(devicePixelRatio, 2) } },
        vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uPix;
          varying vec3 vC; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uPix * 300. / -mv.z; vC = aColor; vA = aAlpha; }`,
        fragmentShader: `varying vec3 vC; varying float vA;
          void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a *= a;
            gl_FragColor = vec4(mix(vC, vec3(1.), a * .6) * a * vA, 1.); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.points.renderOrder = 65;
    this.points.frustumCulled = false;
    g.add(this.points);
    this.parts = []; // { p, v, c, size, life, max, drag, grav, target }
    this.P = P;
  }

  // ---------- 集氣 ----------
  // 扭蛋在鏡頭前：抖得越來越兇、接縫透光、光粒子往裡收；SSR 會先心跳，可能中途升格
  charge(c, home, rarity) {
    const T = TIERS[rarity];
    const m = this.m;
    const dur = m.reduced ? Math.min(T.charge, 0.6) : T.charge;
    const g = c.g;
    const col = new THREE.Color(c.fake ? BEAM[2] : BEAM[rarity]);
    g.add(this.seam);
    this.seam.material.color.copy(col);
    this.capLight.color.copy(col);
    this._placeLight(home);
    if (rarity === 3) sfx.heartbeat(Math.max(1, Math.round(dur / 0.75)));
    sfx.charge(dur, rarity);
    let upgraded = !c.fake;
    let moteT = 0;
    return m.tween(dur, (k) => {
      // 越來越快、越來越大的抖動，最後一刻停住
      const amp = (0.04 + 0.16 * k * k) * (k < 0.96 ? 1 : 0);
      const a = Math.sin(m.time * (28 + 40 * k)) * amp;
      g.position.set(home.x + Math.sin(m.time * 51) * 0.012 * k, home.y + 0.02 * k, home.z);
      g.quaternion.copy(c.q).multiply(_q.setFromAxisAngle(_z, a));
      g.rotateY(k * k * (rarity === 3 ? 9 : 4)); // 越轉越快
      this.seam.material.opacity = Math.min(1, k * 1.6) * (0.6 + 0.4 * Math.sin(m.time * 30));
      this.capLight.intensity = 0.25 + 0.9 * k;
      // 光粒子往扭蛋收
      moteT += 1 / 60;
      const rate = m.reduced ? 1 : 3 + Math.floor(k * 5);
      for (let i = 0; i < rate; i++) this._mote(home, c.fake && !upgraded ? BEAM[2] : BEAM[rarity]);
      // 升格：銀蛋 → 金蛋
      if (!upgraded && k > 0.55) {
        upgraded = true;
        g.userData.bot.material = m.capRare[3];
        this.seam.material.color.set(BEAM[3]);
        this.capLight.color.set(BEAM[3]);
        sfx.upgrade();
        this._coreFlash(home, '#fff3c4', 0.35, 0.35);
        this._ring(home, '#ffd54a', 0, 0.45, 0.5);
        m.cb.onUpgrade?.();
      }
    });
  }

  _mote(center, color) {
    if (this.parts.length >= this.P) return;
    const dir = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    const p = center.clone().addScaledVector(dir, rnd(0.35, 0.7));
    this.parts.push({ p, v: new THREE.Vector3(), c: new THREE.Color(color), size: rnd(0.03, 0.055), life: 0, max: 0.9, target: center.clone(), drag: 0, grav: 0 });
  }

  // ---------- 爆開 ----------
  burst(rarity, at) {
    const T = TIERS[rarity];
    const m = this.m;
    const red = m.reduced ? 0.35 : 1;
    const R = RARITY[rarity];
    const pal = PALETTES[rarity].map((c) => new THREE.Color(c));
    sfx.boom(rarity);
    this.seam.removeFromParent();
    this.seam.material.opacity = 0;
    // 中心爆光
    this._coreFlash(at, BEAM[rarity], T.glow, rarity >= 2 ? 0.7 : 0.5);
    this._placeLight(at);
    this.capLight.color.set(BEAM[rarity]);
    const L = this.capLight;
    const l0 = rarity >= 2 ? 1.6 : 0.8;
    m.tween(1.6, (k) => (L.intensity = l0 * (1 - k)));
    // 光芒（R 一層、SR 兩層、SSR 兩層＋彩虹）
    this.rays.forEach((r, i) => {
      if (i >= Math.min(T.rays, 2)) return;
      const u = r.material.uniforms;
      u.uC.value.set(i ? '#ffffff' : R.glow);
      u.uN.value = [8, 12, 16, 20][rarity] + i * 6;
      u.uRainbow.value = rarity === 3 && i === 0 ? 1 : 0;
      r.position.copy(at);
      r.visible = true;
      const sc = [0.3, 0.42, 0.56, 0.72][rarity] * (i ? 0.8 : 1); // 鏡頭前 1.2 m，太大會整片白
      const dur = [1.2, 1.5, 2.6, 3.4][rarity];
      m.tween(dur, (k) => {
        u.uA.value = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) * [0.3, 0.5, 0.62, 0.75][rarity] * (i ? 0.7 : 1);
        r.scale.setScalar(sc * (0.5 + 0.7 * easeOut(Math.min(1, k * 2.2))));
      }).then(() => (r.visible = false));
    });
    // 衝擊波
    for (let i = 0; i < T.rings; i++) this._ring(at, i === 0 ? '#ffffff' : BEAM[rarity], i * 0.14, 0.75 + i * 0.12, [0, 0.55, 0.75, 1.0][rarity] + i * 0.15);
    // 光柱
    if (T.pillar) {
      const p = this.pillar;
      p.position.copy(at);
      p.material.uniforms.uC.value.set(BEAM[rarity]);
      p.visible = true;
      m.tween(rarity === 3 ? 2.6 : 1.8, (k) => {
        p.material.uniforms.uW.value = easeOut(Math.min(1, k * 4)) * (rarity === 3 ? 1.3 : 0.9);
        p.material.uniforms.uA.value = (k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92) * (rarity === 3 ? 0.85 : 0.65);
      }).then(() => (p.visible = false));
    }
    // 彩帶
    const n = Math.round(T.confetti * red);
    const camUp = new THREE.Vector3().setFromMatrixColumn(m.camera.matrixWorld, 1);
    this.confettiData.forEach((d, i) => {
      d.alive = i < n;
      d.p.copy(at);
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize();
      d.v.copy(dir).multiplyScalar(rnd(0.5, 1.5) * (0.8 + rarity * 0.2)).addScaledVector(camUp, 0.5);
      d.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      d.w.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
      this.confetti.setColorAt(i, pal[i % pal.length]);
    });
    this.confetti.instanceColor.needsUpdate = true;
    this.confetti.visible = true;
    this.confettiT = 0;
    // 星星
    const ns = Math.round(T.sparks * red);
    this.sparks.forEach((s, i) => {
      s.life = i < ns ? rnd(1.2, rarity === 3 ? 3.2 : 2.4) : 0;
      s.p.copy(at).add(new THREE.Vector3(rnd(-0.35, 0.35), rnd(-0.25, 0.35), rnd(-0.3, 0.3)));
      s.v.set(rnd(-0.1, 0.1), rnd(0.02, 0.15), rnd(-0.1, 0.1));
      s.ph = rnd(0, 6);
      s.s.material.color.set(i % 3 ? R.glow : '#ffffff');
    });
    // 煙火：在扭蛋周圍一發一發炸
    const right = new THREE.Vector3().setFromMatrixColumn(m.camera.matrixWorld, 0);
    const nf = Math.round(T.fireworks * (m.reduced ? 0.4 : 1));
    for (let i = 0; i < nf; i++) {
      const pos = at.clone().addScaledVector(right, rnd(-0.38, 0.38)).addScaledVector(camUp, rnd(-0.05, 0.3));
      m.after(0.22 + i * 0.26, () => this._firework(pos, rarity, i));
    }
    // 金幣雨
    if (T.coins) this._coinRain(at, Math.round(T.coins * red));
    // 鏡頭震動
    if (T.camShake && !m.reduced) m.shakeT = T.camShake;
  }

  // 補光放在扭蛋和鏡頭之間、偏上（放在扭蛋中心會把殼內側照爆）
  _placeLight(at) {
    const cam = this.m.camera.position;
    this.capLight.position.copy(at).lerp(cam, 0.3).add(new THREE.Vector3(0, 0.18, 0));
  }

  _coreFlash(at, color, size, dur) {
    const s = this.core;
    s.material.color.set(color);
    s.position.copy(at);
    s.visible = true;
    this.m.tween(dur, (k) => {
      s.scale.setScalar(size * (0.3 + 0.9 * easeOut(k)));
      s.material.opacity = 1 - k;
    }).then(() => (s.visible = false));
  }

  _ring(at, color, delay, dur, size) {
    this._ringIdx = ((this._ringIdx ?? -1) + 1) % this.rings.length; // 同一時間排好幾圈，各用各的
    const r = this.rings[this._ringIdx];
    const m = this.m;
    m.after(delay, () => {
      r.position.copy(at);
      r.lookAt(m.camera.position);
      r.material.color.set(color);
      r.visible = true;
      m.tween(dur, (k) => {
        r.scale.setScalar(0.05 + size * easeOut(k));
        r.material.opacity = (1 - k) * 0.9;
      }).then(() => (r.visible = false));
    });
  }

  _firework(center, rarity, i) {
    sfx.firework();
    const hues = rarity === 3 ? [0.13, 0.95, 0.55, 0.3, 0.75][i % 5] : [0.75, 0.82, 0.6][i % 3];
    const count = this.m.reduced ? 30 : 80;
    for (let k = 0; k < count && this.parts.length < this.P; k++) {
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
      const c = new THREE.Color().setHSL((hues + rnd(-0.04, 0.04) + 1) % 1, 0.9, k % 5 ? 0.62 : 0.9);
      this.parts.push({ p: center.clone(), v: dir.multiplyScalar(rnd(0.35, 0.6)), c, size: rnd(0.025, 0.045), life: 0, max: rnd(0.9, 1.4), drag: 1.8, grav: 0.35 });
    }
  }

  _coinRain(at, n) {
    const m = this.m;
    const right = new THREE.Vector3().setFromMatrixColumn(m.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(m.camera.matrixWorld, 1);
    this.coinData.forEach((d, i) => {
      d.alive = i < n;
      d.delay = rnd(0, 1.2);
      d.p.copy(at).addScaledVector(right, rnd(-0.45, 0.45)).addScaledVector(up, rnd(0.35, 0.6)).add(new THREE.Vector3(0, 0, rnd(-0.1, 0.1)));
      d.v.set(rnd(-0.05, 0.05), rnd(-0.3, -0.1), 0);
      d.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      d.w.set(rnd(-10, 10), rnd(-10, 10), rnd(-4, 4));
    });
    this.coins.visible = true;
    this.coinT = 0;
  }

  // ---------- 每一格 ----------
  step(dt) {
    this.time += dt;
    const cam = this.m.camera;
    for (const r of this.rays) if (r.visible) {
      r.material.uniforms.uT.value = this.time;
      r.lookAt(cam.position);
    }
    if (this.pillar.visible) {
      // 光柱只繞垂直軸轉向鏡頭
      const p = this.pillar;
      p.rotation.set(0, Math.atan2(cam.position.x - p.position.x, cam.position.z - p.position.z), 0);
    }
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3(1, 1, 1);
    if (this.confetti.visible) {
      this.confettiT += dt;
      this.confettiData.forEach((d, i) => {
        if (!d.alive) return this.confetti.setMatrixAt(i, M.makeScale(0, 0, 0));
        d.v.y -= 1.6 * dt;
        d.v.multiplyScalar(1 - 1.6 * dt);
        d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt;
        d.r.y += d.w.y * dt;
        d.r.z += d.w.z * dt;
        this.confetti.setMatrixAt(i, M.compose(d.p, Q.setFromEuler(d.r), S));
      });
      this.confetti.instanceMatrix.needsUpdate = true;
      this.confetti.material.opacity = Math.max(0, 1 - Math.max(0, this.confettiT - 2.2) / 0.8);
      if (this.confettiT > 3) this.confetti.visible = false;
    }
    if (this.coins.visible) {
      this.coinT += dt;
      this.coinData.forEach((d, i) => {
        if (!d.alive || this.coinT < d.delay) return this.coins.setMatrixAt(i, M.makeScale(0, 0, 0));
        d.v.y -= 0.9 * dt;
        d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt;
        d.r.y += d.w.y * dt;
        d.r.z += d.w.z * dt;
        this.coins.setMatrixAt(i, M.compose(d.p, Q.setFromEuler(d.r), S));
      });
      this.coins.instanceMatrix.needsUpdate = true;
      if (this.coinT > 3.4) this.coins.visible = false;
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
    // 光粒子
    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.aColor.array;
    const siz = this.points.geometry.attributes.aSize.array;
    const alp = this.points.geometry.attributes.aAlpha.array;
    let n = 0;
    this.parts = this.parts.filter((q) => {
      q.life += dt;
      if (q.life >= q.max) return false;
      if (q.target) {
        // 往中心加速收
        const d = _v.subVectors(q.target, q.p);
        const dist = d.length();
        if (dist < 0.03) return false;
        q.v.addScaledVector(d.normalize(), dt * 6);
        q.v.multiplyScalar(1 - dt * 2);
      } else {
        q.v.multiplyScalar(1 - q.drag * dt);
        q.v.y -= q.grav * dt;
      }
      q.p.addScaledVector(q.v, dt);
      const k = q.life / q.max;
      pos[n * 3] = q.p.x;
      pos[n * 3 + 1] = q.p.y;
      pos[n * 3 + 2] = q.p.z;
      col[n * 3] = q.c.r;
      col[n * 3 + 1] = q.c.g;
      col[n * 3 + 2] = q.c.b;
      siz[n] = q.size * (q.target ? 1 : 1 - k * 0.5);
      alp[n] = q.target ? Math.min(1, q.life * 4) : (1 - k) * (0.6 + 0.4 * Math.sin(q.life * 40 + n));
      n++;
      return true;
    });
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) geo.attributes[k].needsUpdate = true;
    this.points.visible = n > 0;
  }
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

function radialTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
