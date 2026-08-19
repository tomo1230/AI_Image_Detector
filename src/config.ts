// アプリ全体の調整値を一箇所に集約(ハードコード禁止のため)。

/** アンサンブルを構成する個々の判定モデルの定義。 */
export interface ModelDef {
  /** transformers.js が解決する HuggingFace Hub のモデルID。 */
  readonly id: string;
  /** UI に出す短い表示名。 */
  readonly label: string;
  /** ONNX の重み精度。量子化版が無いモデルは "fp32" を明示。省略時は既定。 */
  readonly dtype?: "fp32" | "fp16" | "q8" | "q4";
  /** 「AI生成側」を表すラベル文字列(小文字・部分一致で判定)。 */
  readonly aiLabelHints: readonly string[];
  /** 信頼度の重み(0..1、省略時 1)。統合時に スコア×重み で効かせる。 */
  readonly weight?: number;
}

/** 複数モデルのスコア統合戦略。 */
export type EnsembleStrategy = "max" | "mean";

export const CONFIG = {
  // 合議に参加するモデル群。並行実行してスコアを統合する。
  // 守備範囲の異なる専門家を並べることで偽陰性(見逃し)を減らす。
  models: [
    {
      // 写実系 text-to-image(SDXL等)に強い。labels: artificial / human。
      // ⚠️ CC-BY-NC-3.0(非商用のみ)。⚠️ ONNX fp32 単体 354MB。
      id: "Organika/sdxl-detector",
      label: "写実系AI検出",
      dtype: "fp32",
      aiLabelHints: ["artificial"],
      // 本物写真への誤反応(偽陽性)が多いため重みで頭打ち。
      // 0.6 では単独で「兆候が強い(0.85)」に到達できず、補助シグナル扱いになる。
      // 写実系AIの主役は汎用AI検出(convnext, 1.0)に委ねる。
      weight: 0.6,
    },
    {
      // 顔のディープフェイク特化。labels: Realism / Deepfake。Apache-2.0。
      id: "onnx-community/Deep-Fake-Detector-v2-Model-ONNX",
      label: "ディープフェイク検出",
      aiLabelHints: ["deepfake", "fake"],
      weight: 0.6, // 実写の顔に誤反応しやすいため重みで頭打ちにする。
    },
    {
      // 汎用AI画像検出。xRayon/convnext-ai-images-detector(ConvNeXtV2-Base、
      // 約40万枚 + 継続学習で最新生成AIに追従、MIT)を自前で ONNX 変換し
      // public/models/convnext-ai/ に同梱(tools/convert/ 参照)。
      // labels: real / artificial。env.allowLocalModels でローカル解決。
      id: "convnext-ai",
      label: "汎用AI画像検出",
      dtype: "fp32", // 同梱 onnx/model.onnx は fp32(351MB)。
      aiLabelHints: ["artificial"],
      weight: 1.0,
    },
  ] as readonly ModelDef[],

  // スコア統合: "max"=重み付き最大(単独の専門家の反応を拾う)。
  //   各モデルの スコア×重み の最大値を採用。誤反応しやすいモデルは
  //   weight を下げることで頭打ちにできる。
  // "mean" は重み付き平均(全モデルの合議をバランスよく反映)。
  ensembleStrategy: "max" as EnsembleStrategy,

  // 確信度のしきい値(AI生成である確率 aiScore に対して)。
  // 偽陽性(本物をAI認定)の害が重いため、断定は慎重側に倒す。
  thresholds: {
    aiStrong: 0.9, // これ以上 かつ 下記の一致条件を満たすと「兆候が強い」
    natural: 0.25, // これ以下で「自然な写真の特徴」
    aiLow: 0.5, // natural〜これ は「AIの可能性は低め」(自然寄りだが断定はしない)
    // aiLow〜aiStrong や 一致条件未達 は「判断できません」に倒す

    // 単独モデルの自信過剰な誤りを断定から除外するための一致条件。
    agreeScore: 0.6, // 生スコアがこれ以上なら「このモデルはAIと反応」とみなす
    minAgreeingModels: 2, // 「兆候が強い」には反応したモデルがこの数以上必要
  },

  // 低信頼入力の検知条件。これらに触れると「兆候が強い」を「判断できません」に
  // 抑制し、警告を出す(加工の強い実写での偽陽性対策)。
  quality: {
    minDimension: 256, // 最小辺がこれ未満なら警告(注意レベル)
    lowResDimension: 400, // 最小辺がこれ未満なら低信頼(放送スクショ等の小さい画像)
    minBytesPerPixel: 0.15, // 1px あたりバイト数がこれ未満なら強圧縮=低信頼
    minSharpness: 90, // ラプラシアン分散がこれ未満なら過剰平滑/アップスケール=低信頼
  },

  // C2PA の生成系アサーションを示す digitalSourceType の語句(部分一致)。
  c2pa: {
    generativeHints: ["trainedalgorithmicmedia", "compositewithtrainedalgorithmicmedia", "algorithmicmedia"],
  },
} as const;
