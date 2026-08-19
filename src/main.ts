import "./styles.css";
import { checkC2pa } from "./c2pa.ts";
import { listModels, runDetector, warmUp, type ModelLoadEvent } from "./detector.ts";
import { assessQuality, measureSharpness } from "./quality.ts";
import { buildVerdict } from "./verdict.ts";
import {
  renderError,
  renderModelStatus,
  renderPreview,
  renderStatus,
  renderVerdict,
  type ModelStatusItem,
} from "./ui.ts";

const dropZone = document.querySelector<HTMLElement>("#drop")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const modelStatusBox = document.querySelector<HTMLElement>("#model-status")!;
const previewBox = document.querySelector<HTMLElement>("#preview")!;
const resultBox = document.querySelector<HTMLElement>("#result")!;

const IMAGE_TYPE = /^image\//;

/** 画像をデコードして寸法を得る(品質評価用)。 */
async function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** 1枚の画像に対する判定フロー全体。 */
async function analyze(file: File): Promise<void> {
  if (!IMAGE_TYPE.test(file.type)) {
    renderError(resultBox, "画像ファイルを選んでください。");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  renderPreview(previewBox, objectUrl);
  renderStatus(resultBox, "解析中…(初回はモデルの読み込みに時間がかかります)");

  try {
    const bitmap = await loadBitmap(file);
    const sharpness = measureSharpness(bitmap);
    const quality = assessQuality({
      width: bitmap.width,
      height: bitmap.height,
      fileSizeBytes: file.size,
      sharpness,
    });
    bitmap.close();

    // 来歴検証とモデル合議は独立なので並行実行。
    const [c2pa, ensemble] = await Promise.all([
      checkC2pa(file),
      runDetector(objectUrl),
    ]);

    const verdict = buildVerdict(c2pa, ensemble, quality);
    renderVerdict(resultBox, verdict);
  } catch (err) {
    renderError(
      resultBox,
      err instanceof Error ? err.message : "解析中に不明なエラーが発生しました。"
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function firstFile(list: FileList | null | undefined): File | null {
  return list && list.length > 0 ? list[0] : null;
}

// --- イベント配線 ---

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drop--over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drop--over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drop--over");
  const file = firstFile(e.dataTransfer?.files);
  if (file) void analyze(file);
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = firstFile(fileInput.files);
  if (file) void analyze(file);
});

// クリップボードからの貼り付けにも対応(消費者の主要動線)。
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) =>
    IMAGE_TYPE.test(i.type)
  );
  const file = item?.getAsFile();
  if (file) void analyze(file);
});

// --- モデル準備状況の進捗表示 ---

// 全モデルを「待機中」で初期化し、warmUp のイベントで更新する。
const modelStatus = new Map<string, ModelStatusItem>(
  listModels().map((m) => [m.id, { label: m.label, status: "pending", pct: 0 }])
);

function paintModelStatus(): void {
  renderModelStatus(modelStatusBox, [...modelStatus.values()]);
}

function onModelEvent(e: ModelLoadEvent): void {
  modelStatus.set(e.modelId, { label: e.label, status: e.status, pct: e.pct });
  paintModelStatus();
}

paintModelStatus();

// バックグラウンドでモデルを温めつつ、進捗をUIに反映(失敗しても全体は止めない)。
void warmUp(onModelEvent).catch(() => undefined);
