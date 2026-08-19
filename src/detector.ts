import {
  env,
  pipeline,
  type ImageClassificationPipeline,
} from "@huggingface/transformers";
import { CONFIG, type ModelDef } from "./config.ts";
import type { EnsembleScore, ModelScore } from "./types.ts";

// 自前変換した ConvNeXtV2 を public/models/ から読めるようにする。
// HF Hub のリモートモデルも引き続き許可(両立)。
env.allowLocalModels = true;
// localModelPath の既定は "/models/"。ローカルIDはその配下のフォルダ名で解決。

/** モデル準備状況のイベント(UIの進捗表示用)。 */
export interface ModelLoadEvent {
  readonly modelId: string;
  readonly label: string;
  readonly status: "loading" | "ready" | "error";
  readonly pct: number; // 0..100(ダウンロード進捗)
}

/** transformers.js の progress_callback が渡してくるイベントの必要部分。 */
interface RawProgress {
  readonly status?: string;
  readonly progress?: number;
  readonly file?: string;
}

/** UIに並べる用のモデル一覧(id と表示名)。 */
export function listModels(): readonly { id: string; label: string }[] {
  return CONFIG.models.map((m) => ({ id: m.id, label: m.label }));
}

// 各モデルのパイプラインは初回ロードが重い(モデルDL)。
// モデルIDごとに一度だけ生成して使い回す。
const pipeCache = new Map<string, Promise<ImageClassificationPipeline>>();

function getPipeline(
  model: ModelDef,
  onProgress?: (e: ModelLoadEvent) => void
): Promise<ImageClassificationPipeline> {
  const cached = pipeCache.get(model.id);
  if (cached) return cached;

  const created = pipeline("image-classification", model.id, {
    dtype: model.dtype,
    progress_callback: onProgress
      ? (raw: RawProgress) => {
          if (raw.status === "progress" && typeof raw.progress === "number") {
            onProgress({
              modelId: model.id,
              label: model.label,
              status: "loading",
              pct: Math.min(100, Math.round(raw.progress)),
            });
          }
        }
      : undefined,
  }) as Promise<ImageClassificationPipeline>;
  pipeCache.set(model.id, created);
  return created;
}

/**
 * 全モデルを事前ロードする。onEvent で各モデルの準備状況を通知する。
 * 失敗しても全体は止めない(Promise.allSettled)。
 */
export function warmUp(
  onEvent?: (e: ModelLoadEvent) => void
): Promise<unknown> {
  return Promise.allSettled(
    CONFIG.models.map(async (m) => {
      try {
        await getPipeline(m, onEvent);
        onEvent?.({ modelId: m.id, label: m.label, status: "ready", pct: 100 });
      } catch (err) {
        onEvent?.({ modelId: m.id, label: m.label, status: "error", pct: 0 });
        throw err;
      }
    })
  );
}

interface Classification {
  readonly label: string;
  readonly score: number;
}

function isAiLabel(label: string, hints: readonly string[]): boolean {
  const lower = label.toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "判定中に不明なエラーが発生しました。";
}

/** 単一モデルで画像を判定する。例外は投げず error を含む結果を返す。 */
async function runSingle(model: ModelDef, imageUrl: string): Promise<ModelScore> {
  try {
    const weight = model.weight ?? 1;
    const pipe = await getPipeline(model);
    // top_k は既定(上位5件)。採用モデルは2クラスなので両クラスが返る。
    const output = (await pipe(imageUrl)) as Classification[];

    if (!Array.isArray(output) || output.length === 0) {
      return {
        modelId: model.id,
        label: model.label,
        aiScore: 0,
        weight,
        topLabel: "",
        error: "モデルが結果を返しませんでした。",
      };
    }

    const top = output.reduce((a, b) => (a.score >= b.score ? a : b));
    const aiScore = output
      .filter((c) => isAiLabel(c.label, model.aiLabelHints))
      .reduce((sum, c) => sum + c.score, 0);

    return {
      modelId: model.id,
      label: model.label,
      aiScore: Math.max(0, Math.min(1, aiScore)),
      weight,
      topLabel: top.label,
    };
  } catch (error: unknown) {
    return {
      modelId: model.id,
      label: model.label,
      aiScore: 0,
      weight: model.weight ?? 1,
      topLabel: "",
      error: getErrorMessage(error),
    };
  }
}

/** 有効(エラー無し)なスコアを統合戦略に従って1値にまとめる。 */
function aggregate(scores: readonly ModelScore[]): number {
  const valid = scores.filter((s) => !s.error);
  if (valid.length === 0) return 0;

  const clamp = (n: number): number => Math.max(0, Math.min(1, n));

  if (CONFIG.ensembleStrategy === "mean") {
    // 重み付き平均: Σ(重み×スコア) / Σ重み。
    const weightSum = valid.reduce((a, s) => a + s.weight, 0);
    if (weightSum === 0) return 0;
    const weighted = valid.reduce((a, s) => a + s.weight * s.aiScore, 0);
    return clamp(weighted / weightSum);
  }
  // 既定: 重み付き最大。スコア×重みの最大値(誤反応しやすいモデルは重みで頭打ち)。
  return clamp(Math.max(...valid.map((s) => s.weight * s.aiScore)));
}

/**
 * 全モデルを並行実行し、スコアを統合したアンサンブル結果を返す。
 * 全モデルが失敗した場合のみ error を設定する。
 */
export async function runDetector(imageUrl: string): Promise<EnsembleScore> {
  const perModel = await Promise.all(
    CONFIG.models.map((m) => runSingle(m, imageUrl))
  );

  const allFailed = perModel.every((s) => s.error);
  return {
    aiScore: aggregate(perModel),
    strategy: CONFIG.ensembleStrategy,
    perModel,
    error: allFailed
      ? "すべての判定器を実行できませんでした。"
      : undefined,
  };
}
