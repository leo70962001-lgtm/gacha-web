# Clatter 轉蛋鋪

用 `D:\ai\clatter.blend` 的轉蛋機模型做成網頁轉蛋機（three.js，toon 卡通渲染）。

- **公開網址（GitHub Pages）**：https://leo70962001-lgtm.github.io/gacha-web/ ── 產生的轉蛋連結都指向這裡，任何人都打得開
- claude.ai artifact（私人）：https://claude.ai/artifact/95Qk7ZeuLHCcpzFqWDtupd
- 本機預覽：`py -I tools/serve.py 8790` → http://localhost:8790（或內建瀏覽器的 `gacha-web` 設定）
- 發佈：`node tools/publish.js "訊息"`（`tools/build_site.py` 把 web/ 包成 docs/ → commit → push → Pages 用 main 的 /docs）

## 流程

1. **開店設定**：放進獎品（名稱、照片、稀有度 N/R/SR/SSR、數量）→ 設定價錢（每回投幾枚 × 每枚多少）→ 機台名稱、店名、顏色
2. **產生連結**：整台機器的設定（含縮成 96 px 的照片）壓縮後放在網址 `#g1z.…` 裡，不需要伺服器
3. **玩家打開連結**：投幣（拖硬幣到投幣口或點投幣口）→ 順時針轉把手（拖曳或「幫我轉」）→ 扭蛋掉到出口 → 拿出來 → 點一下打開 → 依稀有度的特效＋開獎卡
4. 機率＝數量／總數；抽一顆少一顆（像真的機器）；SR 銀蛋、SSR 金蛋會在出口先發光
5. 窗裡的扭蛋顆數＝剩下的商品數（最多畫 300 顆，數量多時扭蛋自動縮小）；把手底下有轉盤，轉的時候底層扭蛋跟著繞圈、被凹槽頂起來；出蛋時是最靠近出蛋孔的那顆真的掉下去，出口出現同一顏色
6. 介面語言：中文／日本語／English（右上角切換，預設跟瀏覽器語言；機台上的貼紙字、範例機台也跟著換）

## 法線（2026-10-22 查證）

Maya 匯入的網格帶自訂法線，蓋掉了 Blender 的銳邊 → 機身 56% 面積的頂點法線偏離面法線 >5°（大平面偏 50–60°），toon 硬色階在大面中間切出暗帶。
`build_glb.py` 現在：清自訂法線 → 30° 銳邊 → Weighted Normal（面積加權、保留銳邊）→ 11%（大平面 0°，只剩圓角）。
查證工具：`blender/normal_check.py`（熱圖＋統計，`renders/normals*/`），報告 `tools/normal_report.py` → `renders/normals_fixed/report.png`。

體驗版限制：硬幣是試玩硬幣，不會收款；庫存、收藏、硬幣記在玩家自己的瀏覽器（localStorage）。真正收款、跨玩家共用庫存需要後端。

## 檔案

| 路徑 | 內容 |
|---|---|
| `blender/build_glb.py` | 從 clatter.blend：套用 Maya 群組變換、零件改名、依位置分材質（出口暗色、投幣口金屬）、扭蛋細分、Smart UV、Cycles 烘 AO、匯出 `web/assets/gacha.glb` ＋ `gacha.b64.txt` |
| `blender/gacha_web.blend` | 上面的結果（寫實材質） |
| `blender/toon_look.py` → `blender/gacha_toon.blend` | Toon 版：Shader to RGB ＋常數 ColorRamp、Solidify 反向殼描邊、Gemini 貼圖；`renders/toon_preview.png` |
| `blender/check_render.py` | 寫實材質的檢查渲染 |
| `tools/cut_sheet.py` | Gemini 貼紙組合表 → `web/assets/tex/*.webp` |
| `tools/serve.py` | 本機伺服器（把 index.html 包上跟 artifact 一樣的外殼） |
| `web/index.html` | 版面、樣式（artifact 格式，沒有 doctype） |
| `web/app.js` | 開店表單、連結、玩家流程 |
| `web/machine.js` | three.js 場景：toon 材質＋描邊、窗內扭蛋物理、投幣、把手、出蛋、開蛋特效 |
| `web/decor.js` | 機台上的貼紙與台紙（Canvas：Gemini 背景＋文字） |
| `web/codec.js` | 設定 ⇄ 連結（二進位打包＋deflate-raw＋base64url） |
| `web/sfx.js` | WebAudio 合成音效 |
| `web/i18n.js` | 中／日／英文字串、語言切換（HTML 用 `data-i18n`） |

## 量測值（three.js 座標：Y 上、+Z 朝正面，公尺）

- 窗內：x ±0.35、z −0.125～0.41、底部 y 0.724（前後各一個斜坡）、上蓋底 1.265
- 投幣口 (0.20, 0.60)、把手中心 (0, 0.482, 0.384)、出口 x −0.27～−0.03 / y 0.067～0.32 / 深到 z 0.154
- 扭蛋半徑：模型 0.113 → 網頁 0.065（出口才放得進）

## 貼圖

Gemini（gemini.google.com 圖片模式）生成兩張，原圖在 `D:\ai\gemini\gacha\`：
- `side_a.png`（4:3）機身側面插畫
- `sheet_b.png`（16:9）貼紙組合：上蓋橫幅、價格圓章、台紙外框、側邊直條、代幣

圖裡沒有文字；名稱、價錢、獎品由 `decor.js` 疊上去。

## 注意

- artifact 不提供 `.glb` 檔案類型 → 模型以 base64 文字（`gacha.b64.txt`）發佈，網頁解碼後 `GLTFLoader.parseAsync`
- 重新產生模型：`blender -b D:/ai/clatter.blend --python blender/build_glb.py -- D:/ai/gacha-web`，再把 `web/assets/ao_*.png` 轉成 jpg（見 git 外的指令紀錄：PIL 轉灰階 q85）
