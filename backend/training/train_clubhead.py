"""One-time offline training for the clubhead detector used by app/club.py.

Not called at runtime — run manually, once, whenever the model needs
(re)training:

    pip install roboflow ultralytics
    python training/train_clubhead.py --api-key <your-roboflow-api-key>

Requires a free Roboflow account/API key (https://roboflow.com) to download
the public "golf-club-tracking" dataset (~11,479 labeled clubhead images,
https://universe.roboflow.com/club-head-tracking/golf-club-tracking).

Trains a small YOLOv8n model (fast enough for CPU inference at analysis
time) and copies the resulting weights to app/models/clubhead.pt, where
app/club.py expects to find them. Training itself is far more comfortable on
a GPU; on CPU-only machines this can take a long time (hours), so consider
running it on a Colab GPU runtime instead and copying the resulting
`weights/best.pt` here.
"""

import argparse
import shutil
from pathlib import Path

TRAINING_DIR = Path(__file__).resolve().parent
MODEL_DEST = TRAINING_DIR.parent / "app" / "models" / "clubhead.pt"
DATASET_DIR = TRAINING_DIR / "dataset"

WORKSPACE = "club-head-tracking"
PROJECT = "golf-club-tracking"
DATASET_VERSION = 2


def download_dataset(api_key: str) -> Path:
    from roboflow import Roboflow

    rf = Roboflow(api_key=api_key)
    project = rf.workspace(WORKSPACE).project(PROJECT)
    dataset = project.version(DATASET_VERSION).download("yolov8", location=str(DATASET_DIR))
    return Path(dataset.location)


def train(data_yaml: Path, epochs: int) -> Path:
    from ultralytics import YOLO

    model = YOLO("yolov8n.pt")
    results = model.train(data=str(data_yaml), epochs=epochs, imgsz=640)
    return Path(results.save_dir) / "weights" / "best.pt"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-key", required=True, help="Roboflow API key")
    parser.add_argument("--epochs", type=int, default=50)
    args = parser.parse_args()

    dataset_dir = download_dataset(args.api_key)
    best_weights = train(dataset_dir / "data.yaml", args.epochs)

    MODEL_DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(best_weights, MODEL_DEST)
    print(f"Copied trained weights to {MODEL_DEST}")


if __name__ == "__main__":
    main()
