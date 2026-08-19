import { CONFIG } from "./config.ts";
import type {
  BreakdownRow,
  C2paResult,
  EnsembleScore,
  QualityAssessment,
  Verdict,
} from "./types.ts";

/** 統合戦略を平易な日本語に言い換える(専門用語を出さない)。 */
function strategySummary(strategy: string, pct: number): string {
  const how =
    strategy === "mean"
      ? "各モデルのスコアを信頼度で重み付けして平均しています"
      : "各モデルのスコアを信頼度で調整し、最も高いものを採用しています";
  return `総合「AIの可能性 ${pct}%」は、${how}。`;
}

/** 各モデルのスコアを内訳行に変換する。 */
function toBreakdown(ensemble: EnsembleScore): BreakdownRow[] {
  return ensemble.perModel.map((m) => ({
    label: m.label,
    pct: Math.round(m.aiScore * 100),
    weight: m.weight,
    failed: Boolean(m.error),
    error: m.error,
  }));
}

/**
 * 来歴・アンサンブルスコア・品質を統合し、表示用の最終判定を組み立てる純粋関数。
 * 断定は C2PA 署名がある場合のみ。それ以外は確率と言葉ラベルで表現する。
 */
export function buildVerdict(
  c2pa: C2paResult,
  ensemble: EnsembleScore,
  quality: QualityAssessment
): Verdict {
  const warnings = [...quality.warnings];

  // ① 来歴に「AI生成」と記録されていれば、それが唯一の断定根拠。
  if (c2pa.present && c2pa.generative) {
    const reasons = ["画像の来歴情報(C2PA署名)にAI生成と記録されています。"];
    if (c2pa.issuer) reasons.push(`署名者: ${c2pa.issuer}`);
    return {
      kind: "certain_ai",
      headline: "✅ AI生成と記録されています(確実)",
      breakdown: [],
      reasons,
      warnings,
    };
  }

  const pct = Math.round(ensemble.aiScore * 100);
  const breakdown = toBreakdown(ensemble);

  // 全モデルがエラーなら、確率を出せない旨を正直に伝える。
  if (ensemble.error) {
    return {
      kind: "uncertain",
      headline: "🤔 判断できません",
      breakdown,
      reasons: [ensemble.error],
      warnings,
    };
  }

  const reasons: string[] = [];
  if (c2pa.checked && !c2pa.present) {
    reasons.push("来歴情報(C2PA署名)は付与されていませんでした。");
  }

  const diagnostics =
    `画質: ${quality.width}×${quality.height} / ` +
    `圧縮 ${quality.bytesPerPixel.toFixed(2)} bytes/px / ` +
    `鮮鋭度 ${Math.round(quality.sharpness)} / ` +
    `低信頼: ${quality.lowReliability ? "はい" : "いいえ"}`;

  const base = {
    confidencePct: pct,
    summary: strategySummary(ensemble.strategy, pct),
    breakdown,
    reasons,
    warnings,
    diagnostics,
  };

  // ② スコアを言葉ラベルへマッピング。
  if (ensemble.aiScore >= CONFIG.thresholds.aiStrong) {
    // 低信頼入力(強圧縮・低解像・過剰加工)では確定的な断定を控える。
    if (quality.lowReliability) {
      return {
        ...base,
        kind: "uncertain",
        headline: "🤔 判断できません(画像の加工が強く確定できません)",
        reasons: [
          "AIの兆候は出ていますが、画像の圧縮・低解像・加工が強く、加工された実写でも同様の反応が出るため確定を控えました。",
          ...base.reasons,
        ],
      };
    }
    // 単独モデルの自信過剰な誤りを断定から除外:複数モデルの一致を要件化。
    const agreeing = ensemble.perModel.filter(
      (m) => !m.error && m.aiScore >= CONFIG.thresholds.agreeScore
    ).length;
    if (agreeing < CONFIG.thresholds.minAgreeingModels) {
      return {
        ...base,
        kind: "uncertain",
        headline: "🤔 判断できません(1つのモデルのみが反応)",
        reasons: [
          `AIと反応したのは ${agreeing} モデルのみで、複数モデルの一致が得られなかったため断定を控えました。`,
          ...base.reasons,
        ],
      };
    }
    return { ...base, kind: "ai_strong", headline: "⚠️ AI生成の兆候が強い" };
  }
  if (ensemble.aiScore <= CONFIG.thresholds.natural) {
    return {
      ...base,
      kind: "natural",
      headline: "自然な写真の特徴(AIの兆候は検出されず)",
    };
  }
  // 低めのスコアは「AIの可能性は低い」という自然寄りのニュアンスで伝える。
  // ※高スコアを保留した上の分岐(低信頼/単独反応)はここに来ないので、
  //   "低い" と誤誘導することはない。
  if (ensemble.aiScore <= CONFIG.thresholds.aiLow) {
    return {
      ...base,
      kind: "natural",
      headline: "AIの可能性は低めです(確定はできません)",
    };
  }
  return {
    ...base,
    kind: "uncertain",
    headline: "🤔 判断できません",
    reasons: [
      `AIの可能性は ${pct}% と中程度で、自然ともAIとも言い切れる確証がないため判定を保留しました。`,
      ...base.reasons,
    ],
  };
}
