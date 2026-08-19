"""
xRayon/convnext-ai-images-detector (timm convnextv2_base, num_classes=2) を
transformers.js で読める ONNX + config 一式に変換する。

出力: <repo>/public/models/convnext-ai/
  - config.json
  - preprocessor_config.json
  - onnx/model.onnx

ラベル: index 0 = real / 1 = artificial(AI)  ※ inference.py の probs[0]=real, probs[1]=fake より
前処理: Resize(288) -> CenterCrop(256) -> ToTensor -> Normalize(ImageNet)
"""

import json
import os

import timm
import torch
from huggingface_hub import hf_hub_download

REPO_ID = "xRayon/convnext-ai-images-detector"
CKPT_IN_REPO = "AI Images Detector/checkpoints/checkpoint_phase2.pth"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO_ROOT, "public", "models", "convnext-ai")
ONNX_DIR = os.path.join(OUT_DIR, "onnx")
IMAGE_SIZE = 256
CROP_PCT = 256 / 288  # = 0.8889。ConvNext プロセッサが 288 にリサイズ→256 で中央切り抜き。


def build_and_load() -> torch.nn.Module:
    print("checkpoint をダウンロード中…")
    ckpt_path = hf_hub_download(repo_id=REPO_ID, filename=CKPT_IN_REPO)
    print(f"  -> {ckpt_path}")

    # 学習済み重みは自前checkpointで上書きするので pretrained=False。
    model = timm.create_model("convnextv2_base", pretrained=False, num_classes=2)

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    # DataParallel 由来の "module." 接頭辞があれば剥がす。
    state = { (k[7:] if k.startswith("module.") else k): v for k, v in state.items() }

    missing, unexpected = model.load_state_dict(state, strict=False)
    print(f"  load_state_dict: missing={len(missing)} unexpected={len(unexpected)}")
    if missing:
        print("   missing(先頭5):", missing[:5])
    if unexpected:
        print("   unexpected(先頭5):", unexpected[:5])
    model.eval()
    return model


def export_onnx(model: torch.nn.Module) -> None:
    os.makedirs(ONNX_DIR, exist_ok=True)
    out_path = os.path.join(ONNX_DIR, "model.onnx")
    dummy = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE)
    print("ONNX をエクスポート中…")
    torch.onnx.export(
        model,
        dummy,
        out_path,
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"  -> {out_path}  ({os.path.getsize(out_path)/1e6:.0f} MB)")


def write_configs() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    config = {
        "architectures": ["ConvNextV2ForImageClassification"],
        "model_type": "convnextv2",
        "num_channels": 3,
        "patch_size": 4,
        "num_stages": 4,
        "hidden_sizes": [128, 256, 512, 1024],
        "depths": [3, 3, 27, 3],
        "hidden_act": "gelu",
        "layer_norm_eps": 1e-12,
        "drop_path_rate": 0.0,
        "image_size": IMAGE_SIZE,
        "id2label": {"0": "real", "1": "artificial"},
        "label2id": {"real": 0, "artificial": 1},
        "num_labels": 2,
    }
    with open(os.path.join(OUT_DIR, "config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    # ConvNext プロセッサ: shortest_edge<384 のとき int(256/crop_pct)=288 にリサイズ→256 中央切り抜き。
    # resample=2 は BILINEAR(torchvision の Resize 既定に一致)。
    preproc = {
        "image_processor_type": "ConvNextImageProcessor",
        "do_resize": True,
        "size": {"shortest_edge": IMAGE_SIZE},
        "crop_pct": CROP_PCT,
        "do_rescale": True,
        "rescale_factor": 1 / 255,
        "do_normalize": True,
        "image_mean": [0.485, 0.456, 0.406],
        "image_std": [0.229, 0.224, 0.225],
        "resample": 2,
    }
    with open(os.path.join(OUT_DIR, "preprocessor_config.json"), "w", encoding="utf-8") as f:
        json.dump(preproc, f, indent=2)
    print("config.json / preprocessor_config.json を書き出しました。")


def main() -> None:
    model = build_and_load()
    export_onnx(model)
    write_configs()
    print("\n完了。出力先:", OUT_DIR)


if __name__ == "__main__":
    main()
