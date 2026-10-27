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
6. 手機版（寬 < 640 px）：價錢章收進名牌（名牌拉滿寬、標籤一列），提示卡拿掉 STEP 那行、按鈕縮小 → 機台在上下 UI 之間放到最大（390×760 實測：機台寬約佔畫面 70%，原本約 56%）
7. 介面語言：中文／日本語／English（右上角切換，預設跟瀏覽器語言；機台上的貼紙字、範例機台也跟著換）

## 短連結（`web/cloud.js`，Supabase）

連結原本把整台機器（含照片）塞在 `#g1z.…` 裡，5 張照片就快 2 萬字，LINE 一則訊息只收 5,000 字。現在：
- 「產生轉蛋連結」→ 機台字串（還是 `g1z.…`）存進 Supabase 資料表 `machines` → 連結只剩 `…/gacha-web/#s.Ab3dE9xQ1z`（隨機 10 字 id）
- **同一條連結自動更新**（`supabase/02_editable.sql`）：第一次產生時瀏覽器隨機產生 id＋修改鑰匙（24 字），存在開店的人自己的草稿（`draft.cloud`）；之後改任何設定，1.5 秒沒再動就呼叫 `save_machine()` 更新同一條連結（同時間只送一個，途中又改就跑完再送）。資料庫只存鑰匙的 SHA-256（`machine_keys`，網頁讀不到），寫入只能走這個函式。「改用新連結」＝丟掉鑰匙開新的，舊連結停在上一次的內容。換了裝置或清掉瀏覽器資料就沒有鑰匙，只能開新連結
- **庫存大家共用、只有店家補貨**（`supabase/03_stock.sql`）：每個獎品有固定 id（`uid`，6 字，放進連結的第 7 欄，改名也對得回來）；`machines.stock`＝店家放的數量，`pulls`＝每個獎品被轉走幾個。買家投完幣 → `pull()` 由伺服器照剩下的數量抽（鎖住這台，兩個人不會抽到同一顆最後的）並記下來；10 連剩不到 10 顆就抽剩下的、退多的硬幣；剛好被轉完就退幣。投好幣還沒打開就離開，下次進來那顆放進收藏。開店頁每個獎品顯示「已被轉走 N 個 · 剩 M 個」；補貨＝把數量調高（多的直接加進剩下的），或按「補貨」（按兩下，被轉走的紀錄歸零，要鑰匙）。買家那邊的「重新補貨」在雲端機台上拿掉了（只有長連結的本機試玩還有）
- 買家回到分頁時重抓：店家改了機台 → 重新載入（提示「店家更新了這台機台」）；只是庫存變了 → 更新剩幾顆。收藏照獎品 id／名稱對回新的獎品表
- 舊的內容雜湊短連結（第一版）照樣能開，但不能改
- **錢包**（`supabase/04_wallet.sql`）：每個使用者（瀏覽器）一個錢包，id＋鑰匙存在 `localStorage['clatter.wallet']`，第一次打開頁面就開戶、送 1000 枚。共用庫存的機台：投幣用錢包的錢（沒有免費「＋5 枚」），`pull()` 在同一筆交易裡抽獎、扣買家「價錢 × 抽到幾顆」、加進機台主人的錢包（`machines.owner`＝產生連結時的錢包，`machines.price`＝每轉幾枚）；錢不夠就整筆不做。明細（`ledger`：開始贈送／轉蛋／賣出）只能帶鑰匙用 `wallet_open()` 讀；`wallets`、`ledger`、`machines.owner` 網頁都讀不到。開店頁最上面有錢包卡（餘額＋明細），玩家畫面點硬幣數也能開明細。錢包綁在這台裝置；清掉瀏覽器資料＝換新錢包（目前沒有防止重開錢包拿 1000 枚）
- 上傳的音樂／影片：放進公開的 `media` 桶（單檔 50 MB、只收 audio/video，路徑＝內容 id／英數檔名）→ 變成一般 https 音樂／影片網址，買家也能播；上傳過的網址記在草稿裡，不會重傳
- 照片不用再省連結長度 → 128 px（原本 96 px）
- 雲端連不上（離線、claude.ai artifact 的 CSP）→ 自動給原本的長連結；舊的長連結照樣能開
- 專案：Supabase 組織 Clatter／專案 `clatter-gacha`（東京，Free），帳號 GitHub leo70962001-lgtm。設定 SQL：`supabase/setup.sql`。公開 key（publishable）寫在 `cloud.js`
- 免費專案 7 天沒動靜會暫停 → `.github/workflows/keepalive.yml` 每 3 天讀一次資料表

## 轉卡機（2026-10-25）

第 2 步「機台種類」選 轉蛋機／轉卡機（連結裡 `k:'c'`）。模型 `D:\ai\clatter-1.blend`（Carddass 型）：`blender/measure_card.py` 量部位 → `blender/build_card_glb.py`（跟扭蛋機同一套：套 Maya 群組、清自訂法線＋30° 銳邊＋Weighted Normal、依位置分材質、烘 AO）→ `web/assets/card.b64.txt`＋`ao_card_*.jpg`，第一次切到轉卡機才載入（`Machine.setKind`、`SPECS.card`）。
- 投幣口＝投幣板最上面那條直的細縫（提示是方框）；把手＝右側面的旋鈕（繞 X 軸、從旋鈕那面看順時針；模型保持原樣，不加握把——使用者：「模型不要改變」）；預設視角多轉一點（restYaw −0.5）看得到側面
- 卡片（`web/cardkit.js`）：0.19 × 0.277 m 圓角薄片，從出卡口躺著滑出來（卡面朝下）→ 拿到鏡頭前卡背朝前 → 翻開。卡背 Gemini 生成（`D:\ai\gemini\gacha\card_sheet.png` → `tools/cut_card_sheet.py` → `tex/cardback.webp`、側面圖 `tex/cside.webp`）；SR 金卡背、SSR 彩虹卡背（一半先裝金卡，集氣中升格）
- 翻牌（參考 Hearthstone、ポケポケ、マスターデュエル、原神／鳴潮、FGO）：蓋牌有稀有度光（R 藍、SR 紫、SSR 金）；可以點、也可以左右滑卡片翻；SR／SSR 集氣 → 定格 → 爆光＋連轉 1–2 圈（正面是剪影＋稀有度色邊光）→ 停一拍再上色
- 全圖卡＋3D 照片（像 iPhone 的空間照片）：卡面整張是獎品圖（轉卡機上傳的圖存直的 240 × 350），框／名字帶／稀有度章／星星在上層；`estimateDepth` 從圖估深度（跟四周背景色差越多越前面＋中間比較前面），shader 做視差：卡片一斜，背景比主體多位移、主體浮出一點；翻開的卡片跟著游標（手機是陀螺儀）傾斜，閃卡的光也跟著動。
  - 立體感加強（使用者：「把卡牌的立體感加強」）：視差加深（背景退到卡面後、主體浮到卡面前）、斜的時候主體可以跑出框外、稀有度章／星星／名字帶獨立一層浮在最上面（底下有影子）、窗框的影子跟著斜、護貝光澤滑過、卡片 7 mm 厚看得到卡邊、傾斜角度變大，沒在動也會自己慢慢晃；收集簿的大卡是真的 CSS 3D 分層（影子、退後的圖、框、閃光、浮出來的名字牌）
- 10 連：卡片排在格子裡，點一張翻一張或全部翻開；SR 以上一樣拿到中間跑完整演出

## 我的商店、收集簿（2026-10-25）

上方多了兩個分頁（手機只放圖示）：
- **我的商店**：可以開好幾台機台。`clatter.shop`＝{ cur, list }，每台的草稿在 `clatter.draft.<uid>`（舊版的 `clatter.draft` 第一次打開時搬成第一台）。頁面列出每台：種類、價錢、剩下／被轉走（`pulls`）、賣出枚數（`wallet_sales`，`supabase/05_sales.sql`；還沒裝就用錢包最近 30 筆明細加總）、短連結；按鈕：編輯（切到那台）、轉轉看、複製連結、拿掉（按兩下；只刪這台裝置上的草稿，連結還在）。最上面是機台數、總賣出、錢包。換機台前會先把還沒送出的修改送完
- **收集簿**：轉到的東西都記在 `clatter.album`（每台機台一筆：名稱、種類、連結、獎品名 → 稀有度＋縮圖、個數；用名稱記，店家改了獎品也對得上，拿掉的獎品收過的還在）。每台一區：進度條、收過的彩色＋×個數、沒收到的「？？？」剪影、「再去轉」；轉卡機的獎品是卡片樣子。點收過的 → 大卡跟著游標／手機陀螺儀 3D 傾斜，SR 金光、SSR 彩虹光；可以篩選 全部／轉蛋機／轉卡機

## 好友交換（2026-10-25）

使用者：「追加卡片跟轉蛋好友交換功能」。收集簿第三個分頁「好友交換」（`web/trade.js`，伺服器 `supabase/06_trade.sql`，2026-10-25 在 SQL Editor 跑過）。
- **好友碼＝錢包 id**（10 字，顯示成 XXXX-XXXX-XX）；暱稱存在 `profiles`。加好友：輸入好友碼，或打開邀請連結 `#f.<好友碼>`（「邀請好友」用 Web Share，不支援就複製）。好友清單存在這台裝置（`clatter.friends`）
- **送出**：好友列的「送東西」或大卡的「拿去交換」→ 選一個收集簿裡的獎品 → 選好友 → 交換（對方選一個回送）／送禮 → 留言。送出成功就先從自己的收集簿拿掉
- **收到**：收集簿分頁上有紅色數字；「選一個回送」→ 確認 ⇄ → 交換；送禮就「收下」；也可以拒絕。收到的東西放進同一台機台的那筆（自己的草稿機台在別人那邊叫 `d.<好友碼>.<uid>`，換回來會併回 `draft.<uid>`），收下時直接用 3D 大卡打開
- **我送出的**：等回覆時可以取消（放回來）；對方收了 → 回送的東西放進收集簿；被拒絕 → 放回來。有錢包的話每分鐘在背景看一次（`trade.poll`），處理過的交換 id 記在 `clatter.tradeApplied`，不會重複加；最近 20 筆記在「交換紀錄」（`clatter.tradeLog`）
- **伺服器**：`trades` 每一步都只能從 open 往下走一次（accept／decline 對收件人、cancel／done 對寄件人），結案時縮圖清掉；`trade_lookup` 只回傳存在的好友碼＋暱稱。別人送來的資料都會先檢查（圖片只收 `data:image/(webp|png|jpeg);base64`、名字截長度、稀有度 0–3）
- **2026-10-26 改版**（使用者：「卡片交換出去要扣掉 分成好友名單跟交換介面2個」「分成2種交換跟贈與」）：
  - 收集簿的數量改成 `got = base + tr`：`base`＝從機台轉到的（取大的）、`tr`＝好友交換進出（收到 +1、送出 −1）。以前 `albumSync` 直接 `got = max(轉到的, got)`，交換出去的下次打開機台又會跑回來。機台裡的「我的卡片／扭蛋」跟結果卡的「持有數」也用同一個算法（`owned()`）。`albumSync` 先做縮圖、做好才重讀收集簿來改（等的時候交換可能剛改過）
  - 收集簿分頁變成：卡片冊／轉蛋收藏／好友名單（好友碼、暱稱、加好友、好友列）／交換（收到的、送出的、紀錄）。邀請連結打開好友名單
  - 交換跟贈與分開：交換頁上面「⇄ 發起交換」「贈與禮物」兩個按鈕；好友列「交換」「贈與」；大卡「拿去交換」「送給好友」；送出的畫面標題、說明、按鈕跟著種類；收到的分成「交換邀請」「收到的贈與」兩區
- 收集簿本身還是存在各自的裝置（改 localStorage 就能作弊）；要防作弊得把收集簿也搬上伺服器
- 測試資料：測試錢包 `2kwVijo30a`（暱稱 Test B）跟交換 #1–#5 留在資料庫

## 多台機台、公開封面（2026-10-26）

使用者：「追加可以做多台的機器 還有公開的機器的圖片可以自己設置」。
- **多台機台本來就有**（我的商店：`clatter.shop`＝{ cur, list }，每台草稿 `clatter.draft.<uid>`），但頂列縮成圖示後不好找 → 開店頁最上面加**機台切換列**：下拉選單換台（`switchMachine`）、「＋ 新機台」（`newMachine`）、「複製這台」（`dupMachine`）。選項＝「編號. 名稱 · 種類」，任何修改都會更新（`relabelSwitch()` 在 `draftChanged` 裡）
- **複製**：同樣的獎品、外觀、價錢、封面，名稱加「（複製）」，**沒有連結**（`cloud`、`listed`、`listedCover` 拿掉 → 做連結會是另一條）。存不下（localStorage 滿了）就不複製。我的商店每台也有「複製」
- **公開封面**（`draft.cover`）：連結區的「公開到逛機台」下面一列：封面縮圖＋「換成自己的圖片」→ 裁切對話框（`sheet-cover`：拖曳調位置、滑桿／滾輪調大小，320×320，webp 壓到 55 KB 以下）；「改回 3D 機台」。沒有自己的圖就用 3D 機台拍的（`listedCover`，每次同步重拍）。公開中改封面 → `pushListing()` 馬上更新摘要。我的商店的機台圖示也換成封面
- 收尾：從我的商店拿掉公開中的機台 → 先取消公開（鑰匙會跟著刪掉）；「改用新連結」→ 舊連結取消公開、新連結做好後自動公開

## 指ではがす：貼紙包、台紙、慢慢撕下來（2026-10-27）

使用者貼了 CapLog 的影片（x.com/mommmkan/status/2114348422996303997：鋁箔包「Trace the seal from the notch to open it」→ 貼紙噴出來 → 台紙上一張一張用手指撕下來，撕掉的地方留下灰色剪影），說「這樣的撥下來的方式」「可以慢慢撕下來」。
- **`web/peel.js`（`openPeel`）**：全螢幕一層、一張 canvas。
  - 鋁箔包：從左邊切口沿上面的封口往右劃，撕口跟著手指（鋸齒線、撕下的那條繞撕點往上翹），撕到 96% → 紙花、貼紙從包口飛到台紙上；放手停在撕到的地方。另有「そのまま開ける」按鈕
  - 台紙：按住貼紙（看透明度，按在貼紙上才算）往外拉 → 折線＝按下點 A 跟手指 P 的垂直平分線；P 那邊照畫、A 那邊對折線鏡射畫成白色背面（折線附近暗、尖端亮，底下有影子），翻開的地方露出灰色剪影。放手：翻不到一半彈回去、超過一半自己撕完 → 轉著飛到上面的計數 → 存進シール帳。「のこりをまとめて保存」自動一張張撕；音效 `sfx.tear`、`sfx.peelTick`、`sfx.peel`
  - 鋁箔包圖：Gemini 畫的（使用者 2026-10-27：「Gemini 額度恢復後，用 Gemini 重畫鋁箔貼紙包換上去」；画像を作成 3:4，色鉛筆風的虹色枕頭袋、上下鋸齒封口、左邊 V 形切口、空白圓標籤）`D:\ai\gemini\gacha\foil_pack.png` → `py -I tools/cut_pack.py D:/ai/gemini/gacha/foil_pack.png web/assets/tex/foil_pack.webp`（去背；量切口那一列＝`FOIL.seal` 0.245、標籤圓心半徑＝`FOIL.labelAt`）。切口在封口下面一點 → 從那條線橫著撕開（像零食袋）。標籤裡畫第一張貼紙＋「シール ×N」。圖載不到才用程式畫的 `drawFoilPack`（`FOIL_DRAWN`）
- **收集簿的獎品 → 貼紙**（使用者 2026-10-27：「轉蛋的貼紙可以貼到貼紙簿」）：轉蛋收藏／卡片冊點獎品的大卡 →「シール帳に貼る」（按兩下：會從收藏扣 1 個，記在 `cut`，跟送人一樣）→ 用收藏裡的去背主體做貼紙（沒有去背 → 圓形，轉卡機方形；加工照稀有度 N/R ボンドロ、SR オーロラ、SSR ラメ）→ 一張台紙打開，撕下來放進シール帳。key＝那台＋獎品名，跟轉到的貼紙獎品同一張（張數累加）。不用連雲端（交換、送人的按鈕才要）
- **シール帳上貼好的也能撕**（使用者：「這個也可以撕下來」）：按在貼紙方框的外圈（離中心超過 28%）拉＝撕、按中間拉＝移動、點邊緣＝選取；撕的畫面用 `PeelLayer`（peel.js：蓋在頁面上的 canvas，跟台紙同一套折線 `paintPeel`），超過一半自己撕完放回下面那排、不到一半彈回去。「はがす」按鈕也是從右上角撕下來的動畫
- **パック**（sticker.js：`createPack`／`addToPack`／`markPackOpened`／`claimPackItem`，`book.packs`）：撕下來才放進シール帳（同 key → 張數 +1、重複的圖刪掉）；全部撕完那包就不見
  - 轉到貼紙獎品 → 裝進那台的鋁箔包（`g|機台`，還沒打開就一直加進同一包）→ 「シール帳で開けよう」
  - 做貼紙可以一次選好幾個（手繪素材點一下＝選／取消，照片可以一次選多張、每張裁切＋去背，最多 12）→「シートにする（N 枚）」→ 台紙馬上打開
  - 歡迎禮：第一次打開シール帳送一包 4 張，直接打開
  - シール帳下面那排最前面是還沒撕的：「未開封」鋁箔包（會晃）／「はがす」台紙（剩幾張），點了打開
- 測過：慢慢撕到一半的畫面、撕完存起來、拉一點點彈回去、まとめて保存、鋁箔包慢慢撕開到噴出來、10 連的貼紙裝成一包、重複的累加、手機（觸控、高解析度）

## シール：做貼紙、シール帳、貼到機台、放進轉蛋（2026-10-26）

使用者：「增加貼子的功能 跟貼子簿 往上收尋可以找的到 貼紙製作後可以貼在轉蛋機上或者放進轉蛋裡」「用gemin 生成幾個手繪風的貼紙」。
網上查過：日本的シール帳ブーム（ボンボンドロップシール＝ぷっくり、樹脂みたいなツヤ；ふわふわ＝フロッキー；クリアのシール帳；シール交換）、電子貼紙書的做法（下面一排貼紙、拖到頁面、貼好還能移動旋轉）、three.js `DecalGeometry`。
- **做貼紙**（`sheet-sticker`，app.js 的 `openStickerMaker`）：手繪素材 12 種（Gemini，下面）或「用照片做」→ 裁切（共用 `openCrop`，512²）→ 自動去背（seg.js；PNG 已經透明就直接用）→ 形狀（沿輪廓／圓／方）＋加工（ボンドロ、ふわふわ、オーロラ、ラメ、とうめい、ふつう）＋名字 → 放進シール帳
- **`web/sticker.js`**：`bakeSticker()` 把白フチ（主體往外長的距離場）跟加工畫進一張透明底的圖——ボンドロ＝離邊越遠越高的圓頂→法線→漫射＋硬高光；オーロラ＝彩虹 screen；ラメ＝亮點；ふわふわ＝邊緣絨光＋顆粒；とうめい＝沒有白フチ。存放：圖在 IndexedDB（`clatter-stickers`）、目錄在 localStorage `clatter.stickers`＝{ list, pages: [{ bg, items: [{ id, x, y, r, s }] }], welcomed }；同一台的同一個獎品再轉到 → 張數 +1
- **シール帳**（`web/stickerbook.js`，收集簿的「シール帳」分頁）：台紙 6 種（點點、方眼、格紋、粉彩、クリア、夜空）、最多 30 頁；下面一排拖到頁面上就貼；點貼好的 → 拖動、右下圓鈕轉＋縮放、「はがす」放回去、「一番上へ」；點下面那張 → 貼到這頁／マシンに貼る／ガチャに入れる／1枚すてる。寬畫面貼紙那排在頁面右邊。第一次打開送 4 張手繪貼紙。音效 `sfx.stick`／`sfx.peel`
- **貼到機台**：開店頁「マシンのシール」（最多 8 張）→ 選貼紙 → 點機台（`machine.startStick` → `pickSurface`）。`machine.setStickers()` 用 DecalGeometry 往附近每個零件都投一次（印刷面板在機身前面一點點 → 貼紙跨過去也看得到），每片掛在那個零件底下；位置存「零件編號＋零件座標的點、法線」。大小、角度滑桿。連結 `sk`：[圖長度, 格式, 加工, 機台種類, 零件, 點, 法線, 大小, 角度]（160 px 透明 webp 接在卡背圖後面）→ 買家也看得到
- **貼好的可以移動**（使用者 2026-10-27：「調整把貼紙貼到機器上後可以移動」）：開店頁按住機台上的貼紙拖 → 沿著表面跟著手指走（`machine._pickSticker` 打貼紙的網格、`pickSurface` 找新位置；手指跟貼紙中心的距離保持住），放開才存；按到就選它（大小、角度滑桿調這張）。拖貼紙時不轉機台；買家那邊（`cb.stickerEdit()` 只有開店頁是 true）拖不動
- **大張不會被切掉**（使用者 2026-10-27：「貼紙切掉了」，手機截圖：大張貼在透明窗上，超出窗邊的部分被切掉）：透明窗比機身凸出 4.75 cm，以前投影只有前後各 4 cm → 超出窗邊、落到後面框上的部分投不到。現在深度照大小（`clamp(s×1.2, 0.1, 0.3)`），`facing()` 只留法線跟貼紙方向內積 > 0.3 的三角形（不會印到玻璃背面、垂直的側壁）。測過：窗左邊緣（玻璃＋機身框）、窗上緣（玻璃＋上蓋＋上蓋標籤）都完整。舞台加 `user-select: none`（手機長按不會選到提示字）
- **手機上移動**（使用者 2026-10-27：「手機的部分沒法移動確認一下」）：手機上整台機台只有 330 px 高、貼紙只有指尖大 → 沒打中貼紙時，離貼紙中心手指 30 px／滑鼠 16 px 內也算按到；放開的那一點也用來定位置（拖出機台外就停在最後一個還在機台上的位置）；canvas 擋掉長按選單；選中的貼紙多一個「換位置（點機台新的地方）」按鈕。シール帳：按在邊緣時看第一下往哪拉——往貼紙裡面拉＝撕，往外／旁邊＝移動（手機上手指常按在邊上）
- **放進轉蛋**：獎品列「シールにしない／シール：〇〇」；連結的獎品列第 10 欄＝加工代號（＋`b`＝圖本身已經是做好的貼紙）。轉到 → `grantSticker` 用照片＋去背遮罩做成貼紙放進買家的シール帳。シール帳的「ガチャに入れる」→ 變成現在這台的獎品（透明底，`encodeImg(c, true)` 不退成 jpeg）
- **手繪素材**：Gemini（画像を作成 16:9）一張 12 格素材表 `D:\ai\gemini\gacha\sticker_sheet.png`（扭蛋、貓、狗、草莓、愛心、星星、彩虹、飯糰、杯子蛋糕、兔子、櫻花、金幣；色鉛筆線＋水彩）→ `py -I tools/cut_stickers.py D:/ai/gemini/gacha/sticker_sheet.png web/assets/stickers`（背景＝從四邊連過來的白，主體裡的白不挖；膨脹分塊；照列、行排序；`sticker_sheet_check.png` 檢查）→ `assets/stickers/s01–s12.webp`
- 測過：做貼紙（照片去背、手繪素材、6 種加工）、拖到頁面、轉＋縮放、移動、撕下來、貼到轉卡機正面＋轉蛋機側面圖、大小角度、連結來回、買家從連結看得到貼紙、貼紙獎品 10 連（同一個累加張數）、手機版面
- 還沒做：貼紙跟好友交換（シール交換）

## 獎品照片裁剪（2026-10-26）

使用者：「增加上傳扭蛋圖片時的裁剪功能」。
- 點獎品的照片格上傳圖片 → 先開裁切對話框（`openCrop()`，跟逛機台的封面共用 `sheet-cover`）：拖曳調位置、滑桿或滾輪調大小（1–4 倍，放大縮小時正中間不動），按「用這張」才換；取消（✕、取消）照片不變
- 比例跟著機台種類：轉蛋機 128×128 正方形、轉卡機 240×350 卡片比例（`prizeSize()`）；封面 320×320。預覽畫布長邊 480 px，確定時從原圖直接畫到輸出大小（`cropCanvas()`），再轉 webp（`encodeImg()`）
- 換照片後照樣跑主體去背（`makeMask`）。影片截圖、YouTube 縮圖還是自動取中間（`shrinkImage()`）

## 效果音、背景音樂（2026-10-26）

使用者：「優化音效 跟可以設定背景音樂」。
- **效果音**（`web/sfx.js`，還是全部 WebAudio 即時合成）：每個聲音 → 效果音音量 → 壓縮器 → 喇叭，另外送一點進程式產生的房間殘響；音高、左右每次差一點；開獎、升格、定格改成 FM 鐘聲（鐵琴）；硬幣（多泛音＋滾動＋掉進錢箱）、把手棘輪、扭蛋碰撞（空心塑膠共振）、開蛋（扣子＋啵＋亮晶晶）重做；新增按鈕（`tap`）、分頁（`tab`）、勾選（`toggle`）、對話框（`open`）的小聲音（全域 click 監聽，很小聲）
- **背景音樂**（`web/bgm.js`）：店家在開店頁「BGM」選：6 首預設曲（玩具店 shop、電玩 arcade、櫻花 sakura、夜晚 night、祭典 festival、夢幻 dream）、不要音樂、上傳自己的曲子（存在 IndexedDB，做連結時跟獎品影音一樣上傳 Supabase）。選了馬上播；買家轉這台時聽到同一首
  - 曲子：Gemini「音楽を作成」（2026-10-26，一首約 2 分鐘，下載「音声のみ」mp3）→ `D:\ai\gemini\gacha\bgm\` → `py -I tools/make_bgm.py D:/ai/gemini/gacha/bgm`（loudnorm −19 LUFS、96 kbps，一首約 1.4 MB）→ `web/assets/bgm/<id>.mp3`
  - 連結：`bm`＝['n'] 不要、['p', id] 預設曲、['a', 網址] 上傳的曲子；沒寫＝shop（舊連結也有音樂）。本機還沒上傳的檔案不寫進連結（買家聽到 shop）
  - 播放：兩個 `<audio>` 交叉淡入（換曲、快結束前從頭淡入 → 無縫循環；10 秒以下的短曲直接 loop）；音量走 WebAudio GainNode（iPhone 改不了 `<audio>.volume`）；開獎（`reveal`、集氣、心跳）時壓到 28%（`setDuck`）；獎品的 `<audio>／<video>` 開始播 → 先停（document 的 play 事件），YouTube／SoundCloud／Spotify 是 iframe → `nowPlaying()` 包一層停；切到背景分頁也停
  - 第一次點畫面才會出聲（瀏覽器規定），`unlock()` 之後 `onUnlock` 通知 bgm.js 開始
- **音量面板**：右上角喇叭 → 效果音、BGM 兩條滑桿＋全部靜音＋正在播哪首；存在 `clatter.audio`
- **PWA**：`sw.js` 不碰 Range（206）請求；`build_site.py` 不把 `assets/bgm/` 放進安裝時的預先下載（播過才進快取）
- 測過（`bgm.state()`）：選曲切換、開獎壓低再回來、hush／unhush、快結束時從頭淡入、上傳的曲子（本機 blob、雲端網址都經 WebAudio）、連結來回解碼、手機版面

## 逛機台（2026-10-26）

使用者：「追加用戶做好的機器的瀏覽頁面」。上方列第三個分頁「逛機台」（指南針圖示），伺服器 `supabase/07_browse.sql`（2026-10-26 在 SQL Editor 跑過）。
- **要店家自己公開**：開店頁「做連結」那區，有短連結以後多一個「公開到逛機台」勾選（`#list-on` → `toggleListed()`）；沒勾的機台還是只有拿到連結的人看得到。可以隨時取消
- **送上去的只有小摘要**（`listingMeta()`，存在 `machines.meta`）：名稱、店名、種類、主題色、價錢、獎品數、前 4 個獎品 64px 小圖、機台封面 240px（`machine.snapshot()`：暫時換成正方形畫面、上下沒 UI，整台入鏡拍一張再換回來）。之後再按「做連結」（或自動同步）會順便更新摘要；不在開店頁時用上次的封面（`draft.listedCover`）
- **伺服器**：`set_listed(id, key, listed, meta)` 要機台的修改鑰匙、meta ≤ 80KB；`browse_machines(sort, limit ≤ 48, offset)` 只列 `listed` 的，`new`＝最近更新、`hot`＝被轉最多次，順便回傳 pulls、total（stock 加總），卡片上「剩下」＝total − pulls
- **逛機台頁**：最新／熱門、名稱或店名搜尋（只搜已經載入的）、一次 24 台＋「再多看一些」；卡片＝封面、種類、價錢、名稱、店名、獎品小圖、獎品數／被轉幾次／剩下、「去轉」（網址換成 `#s.<id>`，跟打開分享連結一樣）。別人的摘要先檢查（圖只收 `data:image/(webp|png|jpeg);base64`、字截長度、價錢夾範圍）。打開網址 `#browse` 直接到這頁。手機兩欄
- **上方列變五個分頁**：放不下時（平板寬度、日文字比較長）`fitBar()` 加 `.tight`，有圖示的分頁只留圖示；≤430px 語言只留地球圖示（下拉選單透明蓋在上面）。三種語言在 375／768／976px 都量過不會超出
- 卡片的 class 是 `.bcard*`（`.mcard` 已經是 10 連的結果卡）
- claude.ai artifact 連不到 Supabase → 逛機台顯示「連不上」；要用 GitHub Pages 的網址
- 測試：`127.0.0.1:8790` 的範例機台（`Y4tqq1npvr`）公開 → `localhost` 看得到 → 去轉 → 測完取消公開了

## 收集簿：卡片冊＋轉蛋收藏（2026-10-25）

使用者：「把收集簿給優化 分卡片冊跟轉蛋收集品 卡片冊做成像冊子一樣」。收集簿上面兩個分頁（記在 `clatter.albumTab`），程式在 `web/binder.js`。
- **素材（Gemini 先畫）**：一張 16:9 的素材表 `D:\ai\gemini\gacha\album_sheet.png`（粉紅絎縫卡冊封面＋扭蛋徽章、楓木層板、薄荷色扭蛋壁紙）→ `py -I tools/cut_album_sheet.py D:/ai/gemini/gacha/album_sheet.png web/assets/tex` → `binder.webp`（白底去掉）、`shelf_row.webp`（層板九宮格拉長、放在 160 px 高透明圖的底部）、`wall.webp`（位移一半＋接縫淡入，無縫）
- **卡片冊**（`Binder`）：像真的集換式卡冊 — 闔著只看得到封面（點了翻開）→ 封面內側是目錄（每台轉卡機：進度、翻到那頁、再去轉）→ 內頁一頁 9 格透明卡套（3×3，卡套有開口跟斜斜的反光），每台轉卡機從新的一頁開始、第一頁有索引標籤；還沒收到的格子畫虛線＋No.＋？；收到的卡依稀有度有小小的閃（R ホロ、SR 斜格、SSR 亮粉＋金框）。寬的畫面（≥ 700 px）兩頁攤開、中間三個鐵環；手機一次一頁、鐵環在左邊。翻頁＝那張紙繞著書背轉 180°（Web Animations），箭頭、左右滑、鍵盤 ←→ 都能翻。頁寬由 JS 依容器寬算（`--pw`）；容器要 `min-width: 0`，不然會被書撐寬
- **轉蛋收藏**（`renderShelf`）：每台轉蛋機一個展示櫃（壁紙＋一列一塊木板），獎品站在打開的扭蛋殼裡（上蓋往左後掀開）；有去背的獎品是站在殼裡的公仔（用 `st` 把頭頂以上的空白切掉），沒有的是圓徽章；還沒轉到的是關著的灰扭蛋＋？；SR/SSR 後面有光；點了都打開 3D 大卡

## 收藏者會員卡（Apple Wallet，2026-10-28）

使用者：「嘗試加入這個」（每人一張收藏者會員卡 → 選一張收到的卡面當主題 → 後端重新簽 `.pkpass` → 更新同一張 Wallet 卡；卡上有會員號、QR、積分）。

- **收集簿 → 會員卡 分頁**（`web/member.js` 的 `MemberCard`）：左邊是跟 Wallet 上一樣擺法的預覽（iOS 27 Poster Generic：上面 logo＋積分、中間大張卡面、下面名字＋主題卡、最下面一條放金幣、收集數、QR），右邊是等級進度、名字、主題卡（收集簿裡有的獎品，卡片冊的先、稀有的先）、「加入 Apple Wallet」、「存成圖片」（卡面＋字＋QR 一張 PNG，不用 iPhone 也能用）
- **卡號＝錢包 id（好友碼）**，QR＝邀請連結 `#f.<碼>`（掃了就是加好友）。**積分**照收集簿算：每個獎品 N 10、R 30、SR 100、SSR 300；300 白銀、1000 黃金、3000 彩虹（`POINTS`／`TIERS`，伺服器卡背的說明也是這組數字）。名字＝好友那邊的名字（`trade_me`），在會員卡頁改也是改那個
- **卡面圖**在網頁用 canvas 畫（`drawArtwork`：主題色＋模糊的照片當底、稀有度色的光＋放射線、中間一張框好的卡，有去背的話頭衝出框，SSR 亮粉）→ `artwork@2x.png`（716×896＝358×448 pt）＋同一張的 `background@2x.png`（Poster 用哪個檔名查不到確定的，兩個都放）、`thumbnail@2x.png`（舊版 iOS 的 generic 用）、`icon`、`logo`、`primaryLogo`。圖組代號＝主題卡＋畫法版本的雜湊，伺服器沒有才傳圖
- **伺服器**：`supabase/08_member.sql`（`member_cards`、`pass_devices`、`pass_regs`、`pass_tickets`、`pass_log`、私有桶 `passes`）＋ Edge Function `supabase/functions/wallet/index.ts`（Deno；node-forge 簽 PKCS#7 detached、SHA-256、帶 Apple WWDR G4 中繼憑證（第一次用時從 apple.com 拿）；fflate 打包）。`pass.json` 同時放 `posterGeneric`（iOS 27）跟 `generic`（舊版）。路由：網頁用 `/status`、`/card`（要錢包鑰匙）、`/ticket`→`/get/<票>`（10 分鐘，Safari 打開就跳「加入 Apple Wallet」）；Apple 的更新服務 `/v1/devices/…/registrations/…`、`/v1/passes/…`（`If-Modified-Since` → 304）、`/v1/log`。`/card` 內容有變 → 推播給有裝這張卡的 iPhone（APNs 金鑰 `APNS_KEY_ID`＋`APNS_P8` 優先，沒有就用 Pass 憑證走 mTLS），iPhone 自己來拿新版。已經加進 Wallet 的人：轉到東西、換主題、改名字、錢包餘額變了 → 4 秒後自動送 `/card`（`touch()`）
- **本機測過**（Node，自簽的假憑證）：openssl `smime -verify` 驗過簽名；模擬資料庫跑過整套路由（鑰匙錯 401、要圖 → 傳圖、換票下載、登記 201／200、查更新、304、改內容 → 推播、取消登記）。**2026-10-28 上線**（使用者同意後）：08 SQL 在 SQL Editor 跑過；function `wallet` 用後台編輯器部署（原始碼從 raw.githubusercontent.com 的 commit 網址抓進 monaco → Deploy），Settings 的「Verify JWT with legacy secret」已關。實測：`/status` 不用金鑰、錯的錢包鑰匙 401、測試錢包 PSZ1bF0Jj5 送 `/card` → 要圖 → 8 張圖進 `passes` 桶、同內容再送 `changed: false`（jsonb 鍵順序會變 → 排好再比）、金幣變了 `changed: true`。**還沒有**：Apple 憑證（`/ticket` 回 503 → 頁面顯示準備中）、真的 iPhone。**2026-10-28 暫停**（使用者：「Pause the Apple Wallet part for now」）：私鑰＋申請檔已做好（`D:\ai\wallet-cert\pass.key`、`pass.csr`），但瀏覽器面板裡登入的 Apple 帳號沒有有效的 Developer Program 會員（帳號頁直接跳報名表、Certificates 頁是空的），所以還沒有 Pass Type ID／pass.cer。會員卡預覽、存成圖片照常
- **要開通 Apple Wallet**（Apple 開發者帳號，一年 US$99）：
  1. `node tools/wallet-cert.mjs csr` → `D:\ai\wallet-cert\pass.csr`（私鑰也在那裡，不在 repo 裡）
  2. Apple 開發者網站 → Identifiers → ＋ Pass Type IDs（例如 `pass.io.github.leo70962001.clatter`）→ Certificates → ＋ Pass Type ID Certificate → 上傳 pass.csr → 下載 pass.cer 放進同一個資料夾
  3. `node tools/wallet-cert.mjs secrets` → `secrets.env`（PASS_TYPE_ID、PASS_TEAM_ID、PASS_CERT、PASS_KEY）→ 貼到 Supabase → Edge Functions → Secrets
- **iOS 27 才有的東西沒放**：Featured Actions（官方範例的鍵名不一致，放錯可能整張卡加不進去 → 連結先放卡背）。優惠券、合作店家權益還沒做

## 把卡帶出去（2026-10-28）

使用者貼了一張「落地位置／實際效果／主要限制」的表＋「嘗試加入這個」。會員卡分頁下面多一塊「把卡帶出去」（`web/cardpack.js`），全部用主題卡畫：

- **App 內主題**（開關，`clatter.member.appTheme`）：卡的色相 → `--accent`／`--bg`／`--stage`／`--floor`（亮暗兩套；主色上是白字 → 調暗到亮度 ≤ 0.19，跟原本的紅一樣看得清楚），品牌圓點跟著變色；開場動畫（卡轉進來＋放射光＋「點一下開始」，點了才有音效 `sfx.reveal(稀有度)`，5 秒沒點就安靜淡出；每個分頁階段一次，從轉蛋／邀請連結進來不播）；分頁圖示（favicon＋apple-touch-icon 換成主題卡）。主題的 `<style>` 要放在 body 最後面（artifact 格式的樣式在 body 裡）
- **素材**（`PACK`，每種一格：預覽、尺寸、怎麼設定、按鈕）：鎖定畫面桌布（這台手機的實際像素，卡放低讓出時鐘）、主畫面桌布（不放卡）、全部的卡一組桌布（最多 24 張，照片隨機顯示用）、聯絡人海報（去背主體放大）、Apple Watch 照片錶面 410×502、頭像 640²、小紅書 1080×1440（名字、等級、積分、加好友 QR）、Discord 橫幅 1360×480（最好的 5 張排扇形）、貼圖（`bakeSticker` 透明 PNG）、App 圖示 1024²
- **存檔**：手機（`pointer: coarse` 且 `navigator.canShare({files})`）第一次按＝做圖、按鈕變「存到照片／分享」、再按才叫 `navigator.share`（分享要在點的當下叫，做圖會等太久）；電腦直接下載，很多張用 fflate（jsDelivr ESM）打成 zip
- **做不到的（表上的限制，照實寫在每一格）**：換桌布、聯絡人海報、各 App 頭像都要使用者自己按；已安裝的 App 圖示改不了（要原生 App 先放進去）；iMessage 貼圖包、`.watchface` 要原生 App
- 測過：電腦／手機寬度的版面、10 種都做得出來（單張 18 KB–1 MB，7 張桌布 zip）、主題色＋開場（點一下有聲音、5 秒自己收）、手機的兩步分享（用假的 `navigator.share` 測）。真的 iPhone 上存照片、設桌布還沒試

## 卡背可以編輯（2026-10-26）

使用者：「增加卡面的背面也可以編輯」。開店頁第 2 步（轉卡機才出現）「卡背」：
- 預設（Gemini 的卡背）／上傳自己的圖（裁成卡片比例 300×437、webp，放進連結）；一行字（最多 16 字，例：店名，畫在下方的深色帶子）；邊框顏色（外圈還是有深色描邊）；「還原預設卡背」
- 上面預覽三張：一般、SR（金）、SSR（彩虹）— 翻開前的稀有度暗示照樣疊在自訂卡背上，3D 卡的閃光（cardkit 的 uMode 2／3）也照樣
- 存在草稿（`draft.back` ＝ { img, text, color }）跟連結（codec `cb`＝[圖長度, 格式, 文字, 邊框色]，圖接在背景圖後面）；機台 `setCardBack()` 依內容重做 4 個稀有度的卡背貼圖（已經發出去的卡不變）

### 卡背樣式＋SR／SSR 加工（2026-10-26）

使用者：「跟背景一樣做給用戶選擇」「ssr sr 也給玩家有加工的選項」「再可愛跟手繪」。
- **樣式**（Gemini 手繪水彩，兩張 16:9 各 4 張直的卡：`D:\ai\gemini\gacha\backs_a.png`、`backs_b.png` → `py -I tools/cut_backs.py <sheet> shop,night,sakura,stars web/assets/tex`、`… cats,dogs,galaxy,candy …`）：轉蛋店、夜晚街道、櫻花、星空、貓咪、狗狗、銀河、糖果 → `assets/tex/back_<id>.webp`（300×437）
- 卡背格子跟背景一樣：預設、8 種樣式、選顏色（那個顏色的漸層＋白點點＋星星）、上傳；`draft.back`＝{ k: default|preset|color|img, id, c, img, text, color, sr, ssr }，全部預設＝null
- **SR／SSR 卡背的加工**：金箔、銀箔、彩虹、雷射、不加工（預設 SR 金箔、SSR 彩虹）。2D 卡背圖（decor `drawCardBack` 的 fin）＋3D 閃光（machine `backModes`：金箔 3、彩虹 4、雷射 2、銀箔 5、不加工 0；cardkit 多了 mode 4＝彩虹不加金框、5＝銀箔）
- 連結 codec `cb`＝[圖長度, 格式, 文字, 邊框色, 種類 i/p/c, 樣式 id 或顏色, SR 加工, SSR 加工]；舊的 4 欄格式照樣讀得懂
- 坑：`draftBack()` 在開頁讀草稿時就會跑 → 它用到的 `backIsDefault` 要是 function 宣告（const 還沒初始化會讓整個 App 開不起來）

### SR／SSR 表面加工（2026-10-26）

使用者：「SSR 跟SR 表面加工也追加進去」。開店頁第 2 步「SR／SSR 表面加工」（轉蛋機、轉卡機都有）：SR、SSR 各選一種 — 雷射（ホロ）、紋理、彩虹亮粉、彩虹＋金框、銀箔、不加工（預設 SR 紋理、SSR 彩虹＋金框＝原本的樣子）；上面兩張會晃的 3D 閃卡預覽（用第一個有照片的獎品）。
- 存 `draft.fin`＝{ sr, ssr }、連結 codec `cf`＝[SR 代碼, SSR 代碼]（都是預設就不寫）；`codec.finOf(fin, 稀有度)` 統一換算（N 不加工、R 雷射）
- 3D 卡面：`machine.setFrontFinish()` → `frontModes`（雷射 1、紋理 2、金框 3、彩虹 4、銀箔 5、不加工 0）；CSS 閃卡（holo.js）用 `fx-<加工>` class（原本的 `.tilt.r1/r2/r3` 規則改成 `.tilt.fx-holo/fx-texture/fx-gold…`，再加彩虹（沒金框）、銀箔）；結果卡、收集簿大卡、卡冊卡套（`pk-holo fx-…`、銀箔的卡套邊框是銀色）都照店家選的；收集簿記在 `e.fin`，交換時跟著機台資訊送

## 可以安裝的網路 App（PWA，2026-10-26）

使用者：「追加成可以下載的網路app」。只有發佈的網站（GitHub Pages）跟本機預覽有；claude.ai artifact 在 iframe 裡裝不了。
- **圖示**（Gemini 先畫）：`D:\ai\gemini\gacha\app_icon.png`（奶油色底的紅色轉蛋機）→ `py -I tools/make_icons.py D:/ai/gemini/gacha/app_icon.png web/assets/icons` → icon-192／512、maskable-512（縮 88%、補底色，圓形裁切也在安全區內）、apple-touch-icon（180）、favicon-32（裁近一點）
- **`web/manifest.webmanifest`**：名稱 Clatter 轉蛋鋪、獨立視窗、主題色 #e23b34、start_url／scope 都是 `./`（Pages 的 /gacha-web/）。外殼（`tools/build_site.py`、`tools/serve.py` 的 SHELL_HEAD）加了 manifest、theme-color、apple-touch-icon、apple-mobile-web-app-*
- **`web/sw.js`**：自己的檔案先拿網路上最新的、斷線用快取；jsDelivr（three.js、MediaPipe）、字型檔、Google Storage（MediaPipe 模型）有快取就用；字型 CSS 先用快取背景更新（`<link>` 載的是 opaque 也收）；Supabase、YouTube 不碰。`build_site.py` 把 docs/ 的檔案清單（51 個）填進 `ASSETS`、內容雜湊當 `VERSION`（內容一變舊快取就清掉）
- **下載 App 按鈕**（上方列，窄的畫面只有圖示）：Chrome／Edge／Android 有安裝提示（`beforeinstallprompt`）才出現，按了跳安裝；iPhone／iPad 的 Safari 沒有安裝提示 → 一直顯示，按了打開「分享 → 加入主畫面 → 新增」的教學；已經裝好（獨立視窗）就不顯示
- 測過：本機關掉伺服器重新整理，整個 App（含 3D 機台）從快取開得起來；Pages 上 sw 啟用、範圍 /gacha-web/、51 個檔案都進快取

## 正在播放卡（2026-10-26）

使用者：「有音樂或動畫的設計改成這樣的設計」（附 Apple Music 的「正在播放」截圖）。`web/nowplaying.js` 的 `mountNowPlaying(box, media, { art, title, artist, rarity, delay, autoplay })`：
- 背景＝獎品圖放大模糊（`.np-bg`）＋從封面抓的 4 個顏色（飽和、亮度適中、色相分開）做的漸層跟光斑（慢慢飄）；封面整體偏暗 → 按鈕、進度改白色（`.np.dark`）
- 大張圓角封面（音樂停的時候縮一點、播放時放大）；影片就放在封面的位置（直的影片限制高度置中）；YouTube 的官方嵌入也放在封面位置；SoundCloud／Spotify 放在控制列的位置（自己的按鈕控制不到）
- 名稱（獎品）／機台名、稀有度、⋯（打開原本的連結；本機檔案沒有）；進度條可以拖、已播／剩下時間；⏪ 10 秒 ⏯ ⏩ 10 秒；音量；重複播放
- 封面維持 3D 閃卡（使用者：「立體的功能要留著」）：音樂、SoundCloud、Spotify 的封面就是會斜的閃卡（去背主體浮出、稀有度閃光）；影片跟著游標斜一點＋反光；YouTube 維持平的
- 用在：轉到的結果卡（有影音的獎品改成這張，封面是同一張 3D 閃卡）、開店頁的影音預覽、收集簿的大卡（收集簿現在會記影音連結 `md`，跟著交換一起送；只存在開店的人裝置上的檔案記不了）；卡片冊／展示櫃上有影音的獎品角落有 ♪／▶

## 收集簿編輯、複製（2026-10-26）

使用者：「收集相簿 可以編輯或刪除」「複製編碼的時候要把編碼複製起來 直接可以貼上」。
- **數量的算法**（`web/albumedit.js`）：`got = base + tr − cut`。`base`＝從機台轉到的（每轉到一個 `gotOne()` 直接 +1；`albumSync` 再跟這次 play 的紀錄取大的，補舊資料）、`tr`＝好友交換進出、`cut`＝自己在收集簿拿掉的。刪掉一台＝全部 cut 掉＋`hidden`；之後再轉到新的才會讓它重新出現（只有新轉到的）
- **編輯模式**：卡片冊／轉蛋收藏右上角「編輯」→ 卡片、收藏品右下角出現 ✎（輕輕晃）。點了調持有數量（只能減少，0＝全部拿掉）；卡片冊翻到目錄、轉蛋收藏在每個展示櫃上面，可以「改名」（只改收集簿裡的顯示名字 `title`，清空＝用回原本的）或「刪除」整台（有確認、會講會刪掉幾種幾個）
- **複製**（`web/copy.js`）：先用 Clipboard API，被擋（claude.ai artifact 的 iframe 等）就用隱藏 textarea＋`execCommand('copy')`，兩個都不行才秀出內容請人手動複製。複製好友碼（XXXX-XXXX-XX，加好友的欄位有沒有「-」都收）、邀請連結、機台連結都用它

## 寶可夢卡的閃法＋獎品登場（2026-10-25）

使用者：「強化轉蛋機把轉蛋的物品效果強化，卡片把卡片的效果強化，參考寶可夢卡的作法」。參考 pokemon-cards-css（simeydotme）：每張卡分 shine（六色 sunpillar 雷射 × 紋理，用 color-dodge 疊）跟 glare（跟著光點的反光）兩層，稀有度不同閃法不同。
- **稀有度 → 閃法**（3D 卡 `cardkit.js` 的 shader、CSS 卡 `holo.js` 同一套）：
  - N：只有反光（一般卡）
  - R：ホロ — 110° 六色雷射＋直的細掃描線＋兩組會干涉的直條，只在圖片背景閃，主體不閃（CSS 版框也淡淡的閃）
  - SR：フルアート — ±45° 交叉細線（菱格紋理）疊 133° 虹光，背景＋框都閃，主體只有淡淡的紋理
  - SSR：レインボーレア＋ゴールド — 整張虹色上色、亮粉（每格一顆，斜到對的角度才亮）、金框也有亮粉
  - 光點跟著卡片斜的方向走（3D 卡＝看過來的方向，CSS 卡＝游標／陀螺儀），越斜越亮
  - 照片是不透明的，只用 color-dodge 的話綠色背景還是綠色 → 先用「圖的亮度 × 虹色」上一層色（像雷射箔透過油墨，CSS 用 `mix-blend-mode: color`），再 dodge
- **`web/holo.js`**：收集簿大卡、結果卡共用的 CSS 3D 閃卡（`new Holo(el, area)`、`set({ t, s, b, st, r, shape, name, tag })`、`start(isOpen)`）。分層：影子 → 背景（照片＋tint＋shine）→ 框（＋框的 shine，用 mask 挖成一圈）→ 主體（＋主體 tint／亮粉，mask＝去背圖）→ glare → 名字牌。會混色的層都包在平的群組裡（`isolation`），3D 只動群組
- **結果卡**：獎品變成 3D 閃卡（轉卡機是卡、轉蛋機是方形壓克力牌），照稀有度登場 — N 跳出來、R 翻一圈、SR 剪影→轉一圈上色、SSR 剪影集氣抖一抖→轉兩圈爆光；後面放射光（SSR 彩虹）、亮的那一刻光環＋星星往外噴；有去背的話換上大張的分層圖
- **開蛋的那一刻**：獎品小卡（`drawPrizeCard`）從蛋的中心長出來、往上往前飛，越稀有轉越多圈，結果卡蓋上來時淡掉（`machine._prizePop`）

## 主體跟背景分開（2026-10-25）

使用者：「主體跟背景分開」。
- **去背**：`web/seg.js` 用 MediaPipe tasks-vision 0.10.14 的 InteractiveSegmenter（MagicTouch 模型 6 MB，從 jsDelivr／Google Storage 載），開店的人上傳照片時在他的瀏覽器跑一次（點照片中間偏下 0.5, 0.55），信心 0.35–0.65 平滑成灰階遮罩；抓到不到 4% 或超過 92% 就不信（`noMask`）。遮罩 120 px webp 存進草稿跟連結（codec 第 7–8 欄，跟在那個獎品的圖後面），買家不用載模型。以前上傳的照片開店頁打開時自動補（`autoMasks`）。載不到模型（離線、artifact 的 CSP）→ 退回用顏色估深度
- **轉卡機的卡**：有遮罩 → 深度圖用遮罩（`depthFromMask`），另外做一張「主體挖掉、用四周顏色由粗到細補回去」的背景圖（`inpaintBehind`，push-pull），shader 落在背景時用它，斜著看背景裡不會再看到一次主體的邊。視差改成沿視線一步一步走（24 步＋最後一段內插的視差遮擋），深度圖跟照片用同一個放大 1.16 倍的座標（之前只放大照片 → 對不齊、主體邊緣會有一條背景色）。正面看主體的耳朵、頭就會蓋到框上
- **收集簿大卡**：有去背就分三層 — 背景（主體那塊柔化掉、整張再柔焦變暗、退到 −40px）、框＋一圈底紙（照片窗變小）、主體（+30px、從窗下緣放大 1.07 倍）。照片窗的上緣依主體頭頂的位置算（`st`，縮圖時從遮罩找；`--bt`），讓頭剛好衝出窗蓋到框上，像 iPhone 景深桌布。開店的人自己試玩的紀錄改用 `draft.<uid>` 當 key（設定一改 play id 就變，以前會變成好幾筆；舊的同名紀錄自動併過來）

## 影音獎品（`web/media.js`）

- 貼連結：YouTube／Shorts（直式播放器）、SoundCloud、Spotify、https 的 mp3／mp4 網址 → 放進分享連結（`[k, u]`，解碼時重新解析、對不上就丟掉）
- 上傳音樂／影片檔：先存在這台裝置的 IndexedDB（上限 50 MB）；產生連結時傳上 Supabase 的 `media` 桶，買家也能播（雲端連不上時才只有開店的人自己能播）。影片會自動擷取一格當縮圖（縮圖會放進連結）
- 結果卡：影片／YouTube 取代獎品圖；音樂有自製播放列；收藏冊點已收集的可以重播
- 在 claude.ai artifact 裡，外部網站的影音會被 CSP 擋掉，要用 GitHub Pages 版

## 背景（壁紙）

第 2 步「機台顏色」下面：素色、扭蛋店、夜晚街道、櫻花、星空、貓咪、狗狗、銀河（後三張是平面花紋，沒有空間感：貓咪奶油色底、狗狗薄荷色底，是粗輪廓線＋平塗色塊的 2D 插畫風；銀河是水彩繪畫風；都是 Gemini 生成，`D:\ai\gemini\gacha\bg_*.png` → `web/assets/tex/bg_*.webp`，貓狗用的是 `bg_cats4.png`、`bg_dogs5.png`）、自選顏色、上傳自己的圖（長邊 200 px 放進連結，畫面上柔焦放大）。圖片背景依螢幕比例裁切填滿、地板不畫只留影子；SR／SSR 的關燈用一層遠處的暗幕。

## 10 連抽

一次投 10 回（剩不到 10 顆就抽剩下的；硬幣不夠自動換試玩硬幣）→ 把手快轉 10 次、扭蛋飛到鏡頭前排成格子：只排在上下 UI 之間那塊空間（連右上價錢章都避開），欄數挑能讓扭蛋最大的（桌機多半 5×2、直向手機 2-3-3-2），UI 高度或螢幕方向變了會重排（`_gridSlot` / `_layoutGrid`）→ 兩種開法：
- **一顆一顆點開**：格子裡的扭蛋輕輕跳、滑鼠移上去放大。N、R 當場啵開、翻出獎品小卡（`decor.js` 的 `drawPrizeCard`：稀有度色框＋照片＋名字＋NEW）；SR、SSR 移到中間跑完整演出（其他格子先縮起來）＋結果卡，按「開下一顆」回到格子。點已經開出來的小卡可以看結果卡（影音可播）。
- **全部打開**（原本的方式）：還沒開的依序啵開，其中最稀有的那顆最後移到中間跑完整演出。

開完 → 結果表（NEW、最高稀有度、影音獎品可點開重播）。NEW 依打開的順序算（同一個獎品抽到兩次，先開的那顆才算）。抽好的 10 顆跟哪幾顆開過會存起來：中途關掉頁面，下次進來時沒開的直接放進收藏（會跳提示）。

## 黃金扭蛋

SR、SSR 掉出來的扭蛋上下兩半都是金色（`goldMatcap()`：卡通金屬的分層、高光、右下反光；SSR 外圈加彩虹光澤）＋表面閃爍亮點；出口透出金光。SSR 一半機率先是普通金蛋，集氣到一半升格成彩虹金。

## 開蛋演出（`web/fx.js` 的 `TIERS`）

再強化（2026-10-22）：轉把手時的前兆（SSR 75%、SR 50%：窗裡扭蛋發金光／彩虹光、頂燈閃、光點往上飄）、爆開前定格（扭蛋變白停一拍）、鏡頭衝擊縮放、窗內扭蛋被震起來、結果卡剪影翻面、集氣小鼓連打＋鈸、SSR 合唱和弦、SSR 彩虹光芒留在結果卡後面。

| 稀有度 | 演出 |
|---|---|
| N | 抖一抖、啵、小彩帶 |
| R | 微暗、藍色光芒、一圈衝擊波、星星、「RARE」 |
| SR | 關燈、接縫透光＋光粒子集氣 1.3 秒、雙層光芒、光柱、兩圈衝擊波、兩發煙火、紫閃光、「SUPER RARE」、紫色結果卡 |
| SSR | 全暗＋心跳、集氣 2.3 秒（一半機率先裝銀蛋，集氣到一半升格成金蛋）、彩虹光芒、金光柱、三圈衝擊波、五發煙火、金幣雨、鏡頭震動、金閃光、「SECRET」逐字跳出、金色結果卡（掃光＋星點） |

延遲都用機台自己的時鐘（`Machine.after`），分頁在背景也不會錯拍。逐格檢查：本機預覽時頁面可以 POST `/__snap?name=` 存 3D 畫面到 `renders/fx_frames/`，`tools/fx_sheet.py` 拼成對照表。

## 陰影（2026-10-22 查證）

背光面原本還有 35% 直射光，陰影貼圖在明暗交界附近時有時無 → 同一個側面紅色值從 85 到 197 都有，貼紙比機身亮、斑駁。
改成：toon 色階背光面（N·L<0）直射光＝0，跟被擋住的影子同一個暗色；環境光 1.75、主光 1.6；陰影貼圖 2048。改完陰影開／關在側面量到的值完全一樣。

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
| `web/sticker.js` | 貼紙：`bakeSticker`（白フチ＋加工）、シール帳的存放、手繪素材清單 |
| `web/peel.js` | 指ではがす：鋁箔包沿封口撕開、台紙上的貼紙沿折線慢慢撕下來（canvas）；`PeelLayer`＝シール帳頁面上撕 |
| `tools/cut_pack.py` | Gemini 鋁箔包 → 去背＋量切口、標籤位置 |
| `web/stickerbook.js` | シール帳的畫面（頁面、拖曳、旋轉縮放、下面一排） |
| `tools/cut_stickers.py` | Gemini 手繪素材表 → 一張張去背的貼紙 |
| `web/bgm.js` | 背景音樂：交叉淡入循環、壓低、暫停、音量 |
| `tools/make_bgm.py` | Gemini 的 mp3 → `web/assets/bgm/`（音量一致、96 kbps） |
| `web/sfx.js` | WebAudio 合成音效 |
| `supabase/07_browse.sql` | 逛機台：`machines.listed／meta／listed_at`、`set_listed`、`browse_machines` |
| `web/member.js` | 收藏者會員卡：積分／等級、主題卡、Wallet 卡面圖、預覽、存成圖片、同步 |
| `web/cardpack.js` | 把卡帶出去：App 主題（顏色、開場、圖示）、桌布／錶面／頭像／分享圖／貼圖素材、分享或 zip |
| `supabase/08_member.sql` | 會員卡：`member_cards`、Wallet 裝置登記、下載票、`passes` 桶 |
| `supabase/functions/wallet/index.ts` | Edge Function：簽 `.pkpass`、Apple Wallet 更新服務、推播 |
| `tools/wallet-cert.mjs` | Apple Pass 憑證：做 CSR、檢查 pass.cer、寫 Supabase 秘密 |
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
