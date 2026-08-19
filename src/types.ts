// アプリ内で受け渡す不変データの型定義。すべて readonly。

/** C2PA(来歴)検証の結果。 */
export interface C2paResult {
  readonly checked: boolean; // 検証を試みたか
  readonly present: boolean; // 署名マニフェストが存在したか
  readonly generative: boolean; // 生成系アサーションを含むか(= AI生成と記録)
  readonly issuer?: string; // 署名者(あれば)
  readonly error?: string; // 検証中のエラー(あれば)
}

/** 個々のモデルの判定スコア。 */
export interface ModelScore {
  readonly modelId: string;
  readonly label: string; // UI表示名
  readonly aiScore: number; // 0..1。AI生成である確率(重み未適用の生スコア)。
  readonly weight: number; // 統合時に効かせる信頼度の重み(0..1)。
  readonly topLabel: string; // モデルが出した最上位ラベル(デバッグ用)
  readonly error?: string;
}

/** 複数モデルを統合したアンサンブル結果。 */
export interface EnsembleScore {
  readonly aiScore: number; // 統合後の AI生成スコア
  readonly strategy: string; // 統合戦略("max" 等)
  readonly perModel: readonly ModelScore[]; // 各モデルの内訳
  readonly error?: string; // 全モデルが失敗した場合のみ
}

/** 入力画像の品質評価(低信頼警告のため)。 */
export interface QualityAssessment {
  readonly width: number;
  readonly height: number;
  readonly bytesPerPixel: number; // 実測:小さいほど強圧縮
  readonly sharpness: number; // 実測:小さいほど不鮮明/加工
  readonly warnings: readonly string[]; // 空なら問題なし
  readonly lowReliability: boolean; // 真なら確定的な「兆候が強い」を抑制する
}

/** 最終的な判定の言葉ラベル。 */
export type VerdictKind =
  | "certain_ai" // C2PAで確定
  | "ai_strong" // 兆候が強い
  | "uncertain" // 判断できない
  | "natural"; // 自然な写真の特徴

/** モデル別スコアの内訳1行。 */
export interface BreakdownRow {
  readonly label: string;
  readonly pct: number; // 生スコア(重み未適用)
  readonly weight: number; // 信頼度の重み(0..1)
  readonly failed: boolean;
  readonly error?: string; // 失敗時の実際のエラーメッセージ(診断用)
}

/** UIに渡す最終結果。 */
export interface Verdict {
  readonly kind: VerdictKind;
  readonly headline: string;
  readonly confidencePct?: number; // 主役の「AIの可能性 %」。certain_ai では省略。
  readonly summary?: string; // スコアの算出方法を平易に説明する1文。
  readonly breakdown: readonly BreakdownRow[]; // モデル別内訳(空なら非表示)。
  readonly reasons: readonly string[]; // 補足メモ(来歴の有無など)。
  readonly warnings: readonly string[];
  readonly diagnostics?: string; // 画質診断(解像度・圧縮・鮮鋭度・低信頼)
}
