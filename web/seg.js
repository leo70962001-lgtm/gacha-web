// 主體去背（使用者 2026-10-25：「主體跟背景分開」）：MediaPipe 的 InteractiveSegmenter（MagicTouch 模型）
//   開店的人上傳照片時在他的瀏覽器跑一次 → 主體遮罩（白＝主體）跟照片一起存進連結；買家不用載入模型
//   給模型一個點：照片中間偏下（商品、寵物照的主體通常在那裡）
//   載不到模型（離線、claude.ai artifact 的 CSP）或結果不可信 → 回傳 null，呼叫的地方退回用顏色估深度
const VER = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

let segP = null;
function loadSeg() {
  if (!segP) {
    segP = (async () => {
      const { FilesetResolver, InteractiveSegmenter } = await import(`${BASE}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const make = (delegate) =>
        InteractiveSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        return await make('GPU');
      } catch (e) {
        return await make('CPU');
      }
    })().catch((e) => {
      console.warn('segmenter unavailable', e);
      segP = null;
      return null;
    });
  }
  return segP;
}

// 圖（canvas／ImageBitmap）→ 遮罩 canvas（跟原圖一樣大、灰階、白＝主體），失敗回傳 null
export async function cutout(src, point = { x: 0.5, y: 0.55 }) {
  const seg = await loadSeg();
  if (!seg) return null;
  try {
    const res = seg.segment(src, { keypoint: point });
    const m = res.confidenceMasks?.[0];
    if (!m) return null;
    const f = m.getAsFloat32Array();
    const w = m.width;
    const h = m.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const id = g.createImageData(w, h);
    let fg = 0;
    for (let i = 0; i < w * h; i++) {
      const v = Math.max(0, Math.min(1, (f[i] - 0.35) / 0.3)); // 信心 0.35–0.65 之間平滑過渡（邊緣柔一點）
      fg += v;
      const b = Math.round(v * 255);
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = b;
      id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    m.close?.();
    res.close?.();
    const ratio = fg / (w * h);
    if (ratio < 0.04 || ratio > 0.92) return null; // 幾乎沒抓到，或整張都是 → 不可信
    if (w === src.width && h === src.height) return c;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    return out;
  } catch (e) {
    console.warn('cutout failed', e);
    return null;
  }
}
