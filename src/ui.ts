import type { Verdict, VerdictKind } from "./types.ts";

const DISCLAIMER =
  "これは確率的な推定であり証拠ではありません。判定器は新しい生成手法を見逃すことがあります。";

const KIND_CLASS: Record<VerdictKind, string> = {
  certain_ai: "verdict--certain",
  ai_strong: "verdict--strong",
  uncertain: "verdict--uncertain",
  natural: "verdict--natural",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** ステータス(準備中・解析中)を表示する。 */
export function renderStatus(container: HTMLElement, message: string): void {
  container.replaceChildren(el("p", "status", message));
}

/** モデル準備状況の1行分。 */
export interface ModelStatusItem {
  readonly label: string;
  readonly status: "pending" | "loading" | "ready" | "error";
  readonly pct: number;
}

const STATUS_TEXT: Record<ModelStatusItem["status"], string> = {
  pending: "待機中",
  loading: "ダウンロード中",
  ready: "準備完了",
  error: "失敗",
};

/**
 * 各モデルの準備状況(待機中 / ダウンロード中 NN% / 準備完了)を描画する。
 * すべて ready になったら控えめな「準備完了」表示にする。
 */
export function renderModelStatus(
  container: HTMLElement,
  items: readonly ModelStatusItem[]
): void {
  const allReady = items.length > 0 && items.every((i) => i.status === "ready");

  const box = el("div", `model-status__box${allReady ? " is-ready" : ""}`);
  box.appendChild(
    el(
      "div",
      "model-status__head",
      allReady ? "✓ モデル準備完了" : "モデルを準備中…(初回のみ・ダウンロード)"
    )
  );

  if (!allReady) {
    for (const item of items) {
      const row = el("div", "model-status__row");
      row.appendChild(el("span", "model-status__name", item.label));

      const right =
        item.status === "loading"
          ? `${STATUS_TEXT.loading} ${item.pct}%`
          : STATUS_TEXT[item.status];
      row.appendChild(
        el("span", `model-status__state model-status__state--${item.status}`, right)
      );

      const bar = el("div", "model-status__bar");
      const fill = el("div", "model-status__fill");
      const width = item.status === "ready" ? 100 : item.status === "loading" ? item.pct : 0;
      fill.style.width = `${width}%`;
      bar.appendChild(fill);
      row.appendChild(bar);

      box.appendChild(row);
    }
  }

  container.replaceChildren(box);
}

/** 画像プレビューを表示する。 */
export function renderPreview(container: HTMLElement, url: string): void {
  const img = el("img", "preview");
  img.src = url;
  img.alt = "判定対象の画像プレビュー";
  container.replaceChildren(img);
}

/** モデル別内訳を折りたたみ(details)で描画する。 */
function renderBreakdown(verdict: Verdict): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "breakdown";
  details.appendChild(el("summary", undefined, "モデル別の詳細"));

  const table = el("div", "breakdown__table");
  for (const row of verdict.breakdown) {
    const line = el("div", "breakdown__row");
    // 重みが1未満のモデルは「(信頼度 60%)」を併記して、なぜ抑えられるか示す。
    const name =
      row.weight < 1
        ? `${row.label}(信頼度 ${Math.round(row.weight * 100)}%)`
        : row.label;
    line.appendChild(el("span", "breakdown__name", name));
    line.appendChild(
      el(
        "span",
        "breakdown__pct",
        row.failed ? "実行できず" : `${row.pct}%`
      )
    );
    table.appendChild(line);

    // 失敗時は実際のエラーメッセージも出す(診断用)。
    if (row.failed && row.error) {
      table.appendChild(el("div", "breakdown__error", row.error));
    }
  }
  details.appendChild(table);
  return details;
}

/** 最終判定をカードとして描画する。 */
export function renderVerdict(container: HTMLElement, verdict: Verdict): void {
  const card = el("div", `verdict ${KIND_CLASS[verdict.kind]}`);

  card.appendChild(el("h2", "verdict__headline", verdict.headline));

  // 主役の数値:「AIの可能性 NN%」の1つだけを大きく見せる。
  if (verdict.confidencePct !== undefined) {
    const bar = el("div", "confidence");
    const fill = el("div", "confidence__fill");
    fill.style.width = `${verdict.confidencePct}%`;
    bar.appendChild(fill);
    bar.appendChild(
      el("span", "confidence__label", `AIの可能性 ${verdict.confidencePct}%`)
    );
    card.appendChild(bar);
  }

  // スコアの算出方法を平易な1文で説明(専門用語は出さない)。
  if (verdict.summary) {
    card.appendChild(el("p", "summary", verdict.summary));
  }

  // 補足メモ(来歴の有無など)。
  if (verdict.reasons.length > 0) {
    const list = el("ul", "reasons");
    for (const r of verdict.reasons) list.appendChild(el("li", undefined, r));
    card.appendChild(list);
  }

  // モデル別内訳は既定で折りたたみ、見たい人だけ開く。
  if (verdict.breakdown.length > 0) {
    const details = renderBreakdown(verdict);
    if (verdict.diagnostics) {
      details.appendChild(el("div", "breakdown__diag", verdict.diagnostics));
    }
    card.appendChild(details);
  }

  for (const w of verdict.warnings) {
    card.appendChild(el("p", "warning", `⚠️ ${w}`));
  }

  card.appendChild(el("p", "disclaimer", DISCLAIMER));
  container.replaceChildren(card);
}

/** エラーを表示する。 */
export function renderError(container: HTMLElement, message: string): void {
  container.replaceChildren(el("p", "error", `エラー: ${message}`));
}
