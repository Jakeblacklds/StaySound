"""Install the optional Apple Silicon aligners without touching Demucs/MFA."""
import hashlib
import pathlib
import subprocess
import sys
import tarfile
import urllib.request

VERSION = "qwen-sofa-v1"
SOFA_REV = "9549c6a86d16019c817eefe4bb8183405da524cc"
QWEN_REV = "0e1a68e91d815300c7c9754b2a7639378b23db15"
PACKAGES = [
    "mlx-audio[stt]==0.5.3", "torch==2.5.1", "torchaudio==2.5.1",
    "lightning==2.5.0.post0", "librosa==0.10.2.post1", "numpy==1.26.4",
    "pyphen==0.17.2", "einops==0.6.1", "matplotlib==3.8.4",
    "textgrid==1.6.1", "h5py==3.12.1", "pandas==2.2.3",
    "tensorboardX==2.6.2.2", "tensorboard==2.18.0", "chardet==5.2.0",
    "mlx==0.32.2", "transformers==5.16.1", "huggingface_hub==1.30.0",
]


def download(url, destination, digest):
    def valid(path):
        if not path.is_file():
            return False
        with path.open("rb") as handle:
            checksum = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                checksum.update(chunk)
        return checksum.hexdigest() == digest
    if valid(destination):
        return
    temporary = destination.with_suffix(".download")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as out:
        while chunk := response.read(1024 * 1024):
            out.write(chunk)
    if not valid(temporary):
        temporary.unlink(missing_ok=True)
        raise RuntimeError("La descarga del modelo no coincide con su SHA-256.")
    temporary.replace(destination)


def main(root, micromamba):
    root = pathlib.Path(root)
    assets = root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    python = root / "runtime/bin/python"
    marker = root / "ready-version"
    if marker.exists() and marker.read_text() == VERSION and python.exists():
        return
    marker.unlink(missing_ok=True)
    if not python.exists():
        subprocess.run([micromamba, "create", "-y", "-p", str(root / "runtime"),
                        "-c", "conda-forge", "python=3.11", "pip"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--no-input", *PACKAGES], check=True)
    download(f"https://codeload.github.com/qiuqiao/SOFA/tar.gz/{SOFA_REV}",
             assets / "sofa.tar.gz", "eb572a520e37a721f97f96ccbd4027ae5cc885b68c5909dc8023a12c09fa9b6f")
    with tarfile.open(assets / "sofa.tar.gz") as archive:
        archive.extractall(assets, filter="data")
    (assets / "sofa.tar.gz").unlink()
    download("https://github.com/spicytigermeat/SOFA-Models/releases/download/v1.0.0_en/tgm_en_v100.ckpt",
             assets / "tgm_en_v100.ckpt", "6aba5f0ba3461155bf0c20190df85fad580de42409784737573309f6962449ff")
    download("https://raw.githubusercontent.com/spicytigermeat/SOFA-Models/ed3218d/tgm_sofa_dict.txt",
             assets / "tgm_sofa_dict.txt", "1b2a52ac559169196cb7cdfd3edcfe3947d37ec6a28a6ec281abac838331439c")
    subprocess.run([str(python), "-c",
        "from huggingface_hub import snapshot_download; import sys; "
        "snapshot_download('mlx-community/Qwen3-ForcedAligner-0.6B-8bit', "
        f"revision='{QWEN_REV}', local_dir=sys.argv[1], ignore_patterns=['*.md','.gitattributes'])",
        str(assets / "qwen3-aligner")], check=True)
    subprocess.run([str(python), "-c",
                    "from mlx_audio.stt import load; import torch, lightning, librosa, pyphen"], check=True)
    marker.write_text(VERSION)


if __name__ == "__main__":
    main(*sys.argv[1:3])
