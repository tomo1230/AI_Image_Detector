import { createC2pa, type C2pa } from "c2pa";
// WASM とワーカーはローカル資産を Vite にバンドルさせ、端末内で完結させる。
import wasmSrc from "c2pa/dist/assets/wasm/toolkit_bg.wasm?url";
import workerSrc from "c2pa/dist/c2pa.worker.min.js?url";
import { CONFIG } from "./config.ts";
import type { C2paResult } from "./types.ts";

let c2paPromise: Promise<C2pa> | null = null;

function getC2pa(): Promise<C2pa> {
  if (c2paPromise === null) {
    c2paPromise = createC2pa({ wasmSrc, workerSrc });
  }
  return c2paPromise;
}

/** アサーション内の digitalSourceType 等から生成系かどうかを推定。 */
function looksGenerative(json: string): boolean {
  const lower = json.toLowerCase();
  return CONFIG.c2pa.generativeHints.some((hint) => lower.includes(hint));
}

/**
 * 画像の C2PA(Content Credentials)署名を検証する。
 * 署名が無い・検証失敗でも例外は投げず、checked/present で状態を返す。
 */
export async function checkC2pa(file: File): Promise<C2paResult> {
  try {
    const c2pa = await getC2pa();
    const { manifestStore } = await c2pa.read(file);

    if (!manifestStore || !manifestStore.activeManifest) {
      return { checked: true, present: false, generative: false };
    }

    const active = manifestStore.activeManifest;
    // マニフェスト全体を文字列化して生成系の痕跡を探す(防御的・簡易)。
    const serialized = JSON.stringify(active);
    const generative = looksGenerative(serialized);

    return {
      checked: true,
      present: true,
      generative,
      issuer: active.signatureInfo?.issuer ?? undefined,
    };
  } catch (err) {
    return {
      checked: true,
      present: false,
      generative: false,
      error: err instanceof Error ? err.message : "C2PA検証に失敗しました。",
    };
  }
}
