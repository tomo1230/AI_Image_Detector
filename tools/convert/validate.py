"""変換した ONNX の妥当性検証。
1) torch版とONNX版の出力が数値一致するか(エクスポート崩れ検出)
2) サンプル実写画像のラベル整合(0=real / 1=artificial)
"""

import os

import numpy as np
import onnxruntime as ort
import timm
import torch
from huggingface_hub import hf_hub_download
from PIL import Image
from torchvision import transforms

REPO_ID = "xRayon/convnext-ai-images-detector"
CKPT = "AI Images Detector/checkpoints/checkpoint_phase2.pth"
SAMPLE = "milad-fakurian-sin5WZzF1U0-unsplash.jpg"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ONNX_PATH = os.path.join(REPO_ROOT, "public", "models", "convnext-ai", "onnx", "model.onnx")
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)

tfm = transforms.Compose([
    transforms.Resize(288),
    transforms.CenterCrop(256),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])


def load_torch():
    m = timm.create_model("convnextv2_base", pretrained=False, num_classes=2)
    ckpt = torch.load(hf_hub_download(REPO_ID, CKPT), map_location="cpu", weights_only=False)
    state = ckpt["model"] if "model" in ckpt else ckpt
    m.load_state_dict({(k[7:] if k.startswith("module.") else k): v for k, v in state.items()})
    m.eval()
    return m


def main():
    torch_model = load_torch()
    sess = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])

    # 1) ランダム入力で数値一致を確認
    x = torch.randn(1, 3, 256, 256)
    with torch.no_grad():
        t_out = torch_model(x).numpy()
    o_out = sess.run(["logits"], {"pixel_values": x.numpy()})[0]
    max_diff = np.abs(t_out - o_out).max()
    print(f"[1] torch vs onnx 最大差分: {max_diff:.3e}  ->", "OK" if max_diff < 1e-3 else "NG")

    # 2) サンプル実写画像でラベル整合
    img = Image.open(hf_hub_download(REPO_ID, SAMPLE)).convert("RGB")
    xi = tfm(img).unsqueeze(0).numpy()
    logits = sess.run(["logits"], {"pixel_values": xi})[0][0]
    probs = np.exp(logits) / np.exp(logits).sum()
    print(f"[2] サンプル画像 probs: real(0)={probs[0]:.3f}  artificial(1)={probs[1]:.3f}")
    print("    予測:", "real" if probs[0] >= probs[1] else "artificial")


if __name__ == "__main__":
    main()
