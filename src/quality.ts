import { CONFIG } from "./config.ts";
import type { QualityAssessment } from "./types.ts";

/**
 * 画像の鮮鋭度(ラプラシアン分散)を測る。
 * 低いほど不鮮明=過剰な平滑化・アップスケール・強圧縮の疑い。
 * 測定不能時は Infinity を返す(=劣化扱いしない)。
 * 注: DOM canvas を使う副作用あり。assessQuality とは分離している。
 */
export function measureSharpness(bitmap: ImageBitmap): number {
  const maxSide = 256;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return Infinity;

  ctx.drawImage(bitmap, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return Infinity; // 読み取り不可(タイント等)なら劣化扱いしない
  }

  // グレースケール化
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // 4近傍ラプラシアンの分散
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return Infinity;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** assessQuality に渡す観測値。 */
export interface QualityInput {
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly sharpness: number; // measureSharpness の結果
}

/**
 * 入力画像の品質を評価する純粋関数。
 * 低解像・強圧縮・過剰平滑のいずれかが強ければ lowReliability を立て、
 * 確定的な「兆候が強い」を抑制する判断材料にする。
 */
export function assessQuality(input: QualityInput): QualityAssessment {
  const { width, height, fileSizeBytes, sharpness } = input;
  const warnings: string[] = [];
  const q = CONFIG.quality;

  const minSide = Math.min(width, height);
  const pixels = width * height;
  const bytesPerPixel = pixels > 0 ? fileSizeBytes / pixels : Infinity;

  let lowReliability = false;

  if (minSide < q.minDimension) {
    warnings.push(`画像が小さい(最小辺 ${minSide}px)ため、判定の信頼性が低い可能性があります。`);
  }
  if (minSide < q.lowResDimension) {
    lowReliability = true;
  }

  if (bytesPerPixel < q.minBytesPerPixel) {
    warnings.push("圧縮が強い(再保存・スクショの可能性)ため、判定の信頼性が低い可能性があります。");
    lowReliability = true;
  }

  if (sharpness < q.minSharpness) {
    warnings.push("画像が不鮮明(アップスケールや過剰な加工の可能性)なため、判定の信頼性が低い可能性があります。");
    lowReliability = true;
  }

  return {
    width,
    height,
    bytesPerPixel,
    sharpness,
    warnings,
    lowReliability,
  };
}
