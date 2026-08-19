# AI生成画像 判定Webアプリ — 設計書 (v1)

最終更新: 2026-06-05

## 1. コンセプト

一般消費者が、SNS等で見かけた **静止画** を気軽にドロップして「AI生成の可能性」を確認するWebアプリ。

- **全処理オンデバイス**(ブラウザ内で完結)
- **追加課金ゼロ**(従量課金APIを使わない)
- **画像は外部に送らない**(プライバシー最優先)

---

## 2. 確定した設計判断

| # | 論点 | 決定 | 理由 |
|---|------|------|------|
| 1 | 利用者・場面 | 一般消費者向け(気軽なチェック) | 完璧な精度を約束せずMVP化できる/ニーズが広い |
| 2 | 対象メディア | 静止画のみ(動画はv3で増築) | 画像判定が動画判定の土台/データ・研究が最も豊富 |
| 3 | 判定エンジン調達 | OSS学習済みモデル(自前) + 来歴検証。従量課金なし | コスト固定・追従負担を回避 |
| 4 | 実行場所 | 完全オンデバイス(ブラウザ内) | サーバ費ゼロ・プライバシー最強・静的配布 |
| 5 | 配布形態 | Webアプリ | インストール不要・全デバイス1コード |
| 6 | 判定手法 | C2PA来歴確認(前段) + ONNX化CNN判定器(本体) | 「来歴あれば確実・無ければ確率」 |
| 7 | 結果表示 | 言葉ラベル主役 + 確信度% + 根拠 + 免責(断定回避) | 誤判定による加害・信頼失墜を防ぐ |
| 8 | 技術スタック | Vanilla TS + Vite | 1画面構成・依存最小・初回ロード軽量 |
| 9 | やっかいな入力 | 全体スコア1値 + 低信頼時の警告(ヒートマップはv2) | 正直な限界提示でMVPに集中 |
| 10 | v1完成ライン | C2PA + ONNX判定 + 結果UI + 警告 まるごと | 設計思想が完成する最小形 |

---

## 3. 判定パイプライン (v1)

```
画像ドロップ / 選択 / 貼り付け(Ctrl+V)
  │
  ├─ 画質計測: 解像度・圧縮率(bytes/px)・鮮鋭度(ラプラシアン分散) → 低信頼フラグ
  │
  ├─① C2PA署名チェック (c2pa)
  │     ├─ 署名あり(生成系) → 「✅ AI生成と記録(確実)」で確定表示
  │     └─ 署名なし ↓
  │
  ├─② 3モデルを並行実行し合議 (@huggingface/transformers, WASM/WebGPU)
  │     ・写実系AI検出     Organika/sdxl-detector        重み 0.6
  │     ・ディープフェイク検出 Deep-Fake-Detector-v2         重み 0.6
  │     ・汎用AI画像検出    convnext-ai(自前ONNX・ローカル) 重み 1.0
  │     → 統合 = 重み付き最大 max(重み×スコア)。各モデルの生スコア内訳も表示。
  │
  └─③ 結果表示
        ・言葉ラベル(下表)+ AIの可能性 %(主役は1つ)
        ・スコア算出方法の平易な説明(専門用語を出さない)
        ・根拠(保留理由・署名有無 など。明るい青で強調表示)
        ・モデル別の詳細(折りたたみ)+ 画質診断
        ・免責(確率推定であり証拠ではない / 新手法は見逃しうる)
```

### 結果ラベルのマッピング(慎重側に倒した最終ロジック)

合議スコア(0..1)と諸条件から決定。`verdict.ts` 実装。

| 条件 | 表示 |
|------|------|
| C2PA署名(生成系)あり | ✅ AI生成と記録されています(確実) ← **唯一の断定** |
| スコア ≥ 0.90 かつ 2モデル以上一致 かつ 高信頼 | ⚠️ AI生成の兆候が強い |
| スコア ≥ 0.90 だが低信頼(圧縮/低解像/加工) | 🤔 判断できません(画像の加工が強く…) |
| スコア ≥ 0.90 だが反応モデルが1つのみ | 🤔 判断できません(1つのモデルのみが反応) |
| 0.50 ≤ スコア < 0.90 | 🤔 判断できません(AIの可能性は中程度…) |
| 0.25 < スコア ≤ 0.50 | AIの可能性は低めです(確定はできません) |
| スコア ≤ 0.25 | 自然な写真の特徴(AIの兆候は検出されず) |

- しきい値は `config.ts` の `thresholds`(aiStrong 0.9 / aiLow 0.5 / natural 0.25 /
  agreeScore 0.6 / minAgreeingModels 2)で集約・調整可能。
- **「判断できません」は必ず理由を併記**(保留理由をユーザーに明示)。
- 必須免責文:「これは確率的な推定であり証拠ではありません。判定器は新しい生成手法を見逃すことがあります。」

### 重み付け(重み付き最大)の意図
- 専門家(写実 / 顔 / 汎用)を並べ、`max(重み×生スコア)` で統合。
- 誤反応しやすいモデルは重みで頭打ち:写実系(偽陽性多)0.6 / 顔(実写の顔に誤反応)0.6 / 汎用 1.0。
- さらに「2モデル以上の一致」を断定の要件にし、単独モデルの自信過剰な誤りを除外。

---

## 4. 採用モデル(調査・確定済み)

transformers.js で変換不要・即実走するものを採用。

### 合議メンバー1(写実系AI検出): `Organika/sdxl-detector` — 重み 0.6
- アーキ: Swin transformer(AutoTrain)、ラベル `artificial` / `human`
- 学習: SDXL生成画像 × 実写(Wikimedia)ペア。写実系 text-to-image に強い。
- ONNX: main に `onnx/model.onnx`(fp32 単体 **354MB**、量子化版なし、dtype fp32)
- ⚠️ ライセンス: **CC-BY-NC-3.0(非商用のみ)**。商用化時は要差し替え。
- ⚠️ **偽陽性が多い**(加工された実写を AI と誤りやすい)→ 重みを 0.6 に下げ補助扱い。
- 既知の弱点: SDXL以外/新しい生成手法(Flux, MJ v6, DALL·E 3 等)や旧手法では精度低下。

### 合議メンバー2(顔ディープフェイク特化): `onnx-community/Deep-Fake-Detector-v2-Model-ONNX` — 重み 0.6
- ViT、2値(Realism / Deepfake)、精度 92.12%、**Apache-2.0**
- 写実系 text-to-image には弱い(顔すり替え向け)。実写の顔に誤反応しやすく重み 0.6。

### 合議メンバー3(汎用AI画像検出): `convnext-ai`(自前ONNX変換・同梱) — 重み 1.0(主役)
- 元: `xRayon/convnext-ai-images-detector`(ConvNeXtV2-Base、入力256px、MIT)。
  約40万枚(AI vs 実写)+ 継続学習で最新生成AIに追従。
- transformers.js は ConvNeXtV2 対応。元は `.pth` のため自前で ONNX 変換した。
- labels: `real`(0)/ `artificial`(1)。前処理: Resize(288)→CenterCrop(256)→ImageNet正規化。
- 変換: `tools/convert/convert_convnext.py`(timm重み→ONNX、io名 pixel_values/logits)。
  検証: torch vs ONNX 差分 1e-7、サンプル整合(`tools/convert/validate.py`)。
- 配置: `public/models/convnext-ai/`(config.json / preprocessor_config.json / onnx/model.onnx 351MB)。
  `env.allowLocalModels=true` でローカル解決。dtype fp32。

#### 不採用だった汎用候補(記録)
- `haywoodsloan` / `LPX55`: **SwinV2 = transformers.js 非対応**(`Unsupported model type: swinv2`)。
- `prithiv SigLIP2`(3クラス99%): ONNX未提供 + SigLIP画像分類のtransformers.js対応が不明。

### 呼び出し例
```javascript
import { pipeline } from '@huggingface/transformers';
const pipe = await pipeline('image-classification', 'Organika/sdxl-detector',
  { dtype: 'fp32' }); // 量子化版が無いため fp32 を明示
const result = await pipe(imageUrl); // → [{ label, score }, ...]
```

---

## 5. 技術スタック

| 役割 | 採用 |
|------|------|
| 言語 / ビルド | TypeScript + Vite |
| UIフレームワーク | なし(Vanilla) |
| ブラウザ内推論 | `@huggingface/transformers`(onnxruntime-web を内包、WASM/WebGPU 自動切替) |
| 来歴検証 | `c2pa`(Content Credentials、WASMはローカルバンドル) |
| 配布 | 静的ホスティング(無料) |
| 起動 | `start.bat`(初回 npm install → `npm run dev -- --open`) |

### ローカルモデル配信とデプロイ時の注意(重要)
- convnext-ai は `public/models/convnext-ai/` に同梱し、`env.allowLocalModels=true` で解決。
  リモートの2モデル(HF Hub)はローカル404 → HFへフォールバックする。
- **罠**: dev/本番とも、存在しないパスに `index.html` を 200 で返す(SPAフォールバック)と、
  transformers.js が HTML を JSON と誤解し、リモートのフォールバックも壊れて全モデルが失敗する。
  - 対策(dev): `vite.config.ts` の `modelsNotFoundPlugin` が `/models/` の実在しないファイルに
    404 を返し、`Cache-Control: no-store` も付与(誤った200-HTMLのキャッシュ事故防止)。
  - 対策(本番): 静的ホストで **`/models/` 配下は実ファイルのみ・無ければ404**(SPAフォールバック対象外)に設定。
- WASMスレッド用に **COOP/COEP ヘッダ**(`Cross-Origin-Opener-Policy`/`Embedder-Policy`)が必要。
- モデル準備の **進捗表示**: `warmUp(onEvent)` が各モデルの 待機中→ダウンロード中NN%→準備完了 を通知し、
  画面上部のステータス欄に進捗バーを表示(`renderModelStatus`)。

### 入力経路と SNS画像URLの方針(決定)
入力は ドロップ / クリック選択 / 貼り付け(Ctrl+V)の3経路。

- **画像URL入力は不採用**(2026-06-04決定。一度実装したが撤去)。
  - 理由: SNS等のCORS非許可URLは原理的に判定不可で、CORS許可URLだけ通る中途半端な
    経路はUIを複雑にするだけと判断。
- SNS画像は **「保存→ドロップ運用」** で対応。
  - 却下した代替: ブラウザ拡張(別配布の負担)/ 無料枠サーバ中継(サーバを持たない方針の放棄)。
  - 理由: 完全オンデバイス・サーバなし・費用ゼロの設計思想を最優先。

---

## 6. ロードマップ

- **v1(現行)**: 静止画オンデバイス判定。C2PA + 3モデル重み付き合議 + 慎重側ロジック + 進捗表示。
- **v2**: タイル分割の部分検出ヒートマップ / 周波数解析の補助シグナル / ブラウザ拡張版 /
  convnext 量子化での軽量化 / より堅牢な検出モデルへの差し替え(リスク#5対策)。
- **v3**: 動画対応(フレーム抽出 → 画像判定器で集計 → 時系列整合性)。

---

## 7. 既知リスク

| # | リスク | 状態・対応 |
|---|--------|-----------|
| 1 | 未知の最新生成手法を見逃す | 受容済み。確信度表示+免責で対応 |
| 2 | 再圧縮・スクショで精度低下 | 低信頼検知(圧縮/低解像/鮮鋭度)で断定を抑制。ただし下記#5の限界あり |
| 3 | 公開ONNX判定器の入手性・ライセンス | 一部解消。SwinV2非対応・ONNX未提供は自前変換で回避(convnext) |
| 4 | C2PA普及率が低い | 現状は補助。本体はML判定で担保 |
| 5 | **加工済み実写(放送・美肌)で3モデルが揃って誤認** | **未解決(本質的限界)**。下記参照 |

### リスク#5 の詳細(重要な学び)
- 実例: 放送スクショの実写顔で、写実100% / 顔76% / 汎用96% と**全モデルが一致して偽陽性**。
- その画像の画質は 724×482 / 0.19 bytes/px / 鮮鋭度652 と**すべて正常範囲** →
  **品質ヒューリスティックでは検出不能**(下げると正常な写真まで巻き込む)。
- **全モデルが一致して誤る場合、重み・合議・しきい値・品質検知のいずれでも救えない。**
- 対応(緩和のみ):断定の閾値を 0.90 へ引き上げ + 「2モデル以上一致」を要件化し、
  **単独モデルの自信過剰な誤りは断定から除外**。本質的な解決には、より新しい/堅牢な
  検出モデル(または face 専用処理)が必要で、現状の公開モデルでは限界がある。

---

## 8. ファイル構成(src/)

| ファイル | 役割 |
|---------|------|
| `main.ts` | 入力配線・判定フロー・モデル準備の進捗表示 |
| `config.ts` | モデル群(id/重み/dtype/ラベルヒント)・しきい値・品質条件を集約 |
| `detector.ts` | 3モデルの並行実行・重み付き合議・進捗コールバック・`env.allowLocalModels` |
| `c2pa.ts` | C2PA来歴検証(WASMローカルバンドル) |
| `quality.ts` | 鮮鋭度計測 + 低信頼判定(解像度/圧縮/鮮鋭度) |
| `verdict.ts` | 来歴+合議+品質を統合し最終ラベル・理由・診断を組み立てる純粋関数 |
| `ui.ts` | 結果カード・モデル別内訳・画質診断・進捗バーの描画 |
| `types.ts` / `config.ts` | 型・定数 |
| `tools/convert/` | convnext の ONNX 変換・検証スクリプト(Python 3.9 で実行) |
| `vite.config.ts` | `/models/` の404プラグイン・COOP/COEP・WASM除外 |
| `start.bat` | ワンクリック起動 |

## 9. 進捗・次タスク

完了:
- [x] v1雛形(Vite + TS + `@huggingface/transformers` v4 + `c2pa` v0.30)
- [x] C2PA来歴 + 3モデル合議の並行パイプライン
- [x] **3モデル合議**(写実 Organika 0.6 / 顔 DeepFake 0.6 / 汎用 convnext 1.0)、重み付き最大
- [x] convnext-ai を**自前ONNX変換**(timm ConvNeXtV2 → ONNX、torch比較 1e-7 で検証)
- [x] ローカル/リモート混在の配信問題を解決(`/models/` 404プラグイン + no-store)
- [x] モデル準備の**進捗表示**(待機中/ダウンロード中%/準備完了)
- [x] 結果UIの平易化(言葉ラベル主役・用語平易化・モデル別内訳折りたたみ・画質診断)
- [x] **慎重側の判定ロジック**:断定閾値0.90 + 2モデル一致要件 + 低信頼で断定抑制
- [x] スコア帯の文言(「AIの可能性は低め」帯を追加)、「判断できません」は必ず理由表示
- [x] 理由テキストを明るい青(#6cb0ff)で強調
- [x] `start.bat` 追加
- [x] 型チェック・本番ビルド・dev配信を都度確認

次タスク:
- [ ] **convnext ONNX の量子化**(fp32 351MB → int8 ≈ 90MB)で初回DL軽量化(`tools/convert/`)
- [ ] 商用化するなら CC-BY-NC の Organika を撤去(convnext + DeepFake は MIT/Apache-2.0)
- [ ] 本番デプロイ(静的ホスト + COOP/COEP + `/models/` を404にする設定)
- [ ] 閾値・重みの実画像チューニング(偽陽性/見逃しのバランス)
- [ ] `c2pa` → `@contentauth/c2pa-web` への移行(非推奨対応)
- [ ] (将来)リスク#5 対策= より堅牢な検出モデル or 顔専用処理の検討

## 10. 変換環境メモ(この PC 固有)
- torch を使う変換は **python.org版 Python 3.9**
  (`C:\Users\kaihatu007\AppData\Local\Programs\Python\Python39\python.exe`)を使う。
- 既定の Microsoft Store 版 Python 3.13 は `import torch` で DLL ロード失敗。
  torch/torchvision は CPU index から: `pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`
