# AI画像チェッカー (AI Image Detector)

SNS等で見かけた**静止画**をドロップするだけで「AI生成の可能性」を推定する、ブラウザ完結型のWebアプリです。

- **完全オンデバイス** — 判定はすべてブラウザ内で実行。画像は外部に一切送信しません。
- **サーバ・API課金ゼロ** — 静的ファイルとして配布できます。
- **断定しない設計** — 確率推定であることを明示し、低信頼な入力では判断を保留します。

詳細な設計思想・判定ロジックは [DESIGN.md](DESIGN.md) を参照してください。

## 判定パイプライン

1. **画質計測** — 解像度・圧縮率・鮮鋭度から「低信頼」フラグを立てる
2. **C2PA来歴検証** — 生成AIの署名があれば確定表示
3. **3モデルの合議** — 写実系AI検出 / ディープフェイク検出 / 汎用AI画像検出(ONNX, WASM・WebGPU)
4. **結果表示** — 言葉ラベル + 可能性% + 根拠 + 免責

## 必要環境

- Node.js 18 以上
- (モデル変換を行う場合のみ) Python 3.10 以上

## セットアップ

```bash
npm install
```

### 同梱モデルの重みを用意する

`public/models/` 以下のモデル一式(重み `model.onnx` は約351MB)はリポジトリに含めていません。以下のコマンドで取得・生成します。

```bash
pip install -r tools/convert/requirements.txt
python tools/convert/convert_convnext.py
```

[xRayon/convnext-ai-images-detector](https://huggingface.co/xRayon/convnext-ai-images-detector) のチェックポイントを取得し、transformers.js が読めるONNX一式(`model.onnx` / `config.json` / `preprocessor_config.json`)を `public/models/convnext-ai/` に出力します。変換結果の妥当性は次で検証できます。

```bash
python tools/convert/validate.py
```

他の2モデルは初回実行時に HuggingFace Hub から自動取得され、ブラウザにキャッシュされます。

## 開発

```bash
npm run dev
```

Windows では [start.bat](start.bat) をダブルクリックしても起動できます(依存の自動インストール込み)。

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが出力されます。`npm run preview` でビルド結果を確認できます。

> ONNX Runtime の WASM やマルチスレッド実行のため、配信サーバでは `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` の付与が必要です(設定は [vite.config.ts](vite.config.ts) を参照)。

## 構成

```
src/
  main.ts      エントリポイント・全体フロー
  config.ts    モデル定義・しきい値などの調整値
  detector.ts  ONNXモデルの読み込みと推論・スコア統合
  c2pa.ts      C2PA来歴検証
  quality.ts   画質計測(解像度・圧縮率・鮮鋭度)
  verdict.ts   スコア→判定ラベルの決定ロジック
  ui.ts        画面描画
tools/convert/ モデルのONNX変換・検証スクリプト(Python)
```

## ライセンスと注意事項

本リポジトリのコードは [MIT License](LICENSE) です。ただし利用する学習済みモデルは各配布元のライセンスに従います。

| モデル | ライセンス |
|---|---|
| Organika/sdxl-detector | CC-BY-NC-3.0(**非商用のみ**) |
| onnx-community/Deep-Fake-Detector-v2-Model-ONNX | Apache-2.0 |
| xRayon/convnext-ai-images-detector | MIT |

商用利用の際は `src/config.ts` から非商用ライセンスのモデルを外してください。

**免責** — 本アプリの判定は確率推定であり、証拠にはなりません。新しい生成手法は見逃す可能性があり、加工の強い実写を誤判定する可能性もあります。判断の根拠として単独で用いないでください。
