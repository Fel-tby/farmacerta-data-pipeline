import argparse
import json
import os
import urllib.request
import zipfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_CONFIG = os.path.join(ROOT, "config", "sources.json")


def resolve(path):
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def iter_sources(config, selected):
    if selected in ("all", "bnafar"):
        yield config["bnafar"]["stock_position"]
    if selected in ("all", "bps"):
        for year in sorted(config["bps"]):
            yield config["bps"][year]


def download(source, skip_existing):
    archive_path = resolve(source["archive_path"])
    os.makedirs(os.path.dirname(archive_path), exist_ok=True)

    if skip_existing and os.path.exists(archive_path):
        print(f"skip download: {archive_path}")
        return archive_path

    print(f"download: {source['name']}")
    print(f"from: {source['url']}")
    urllib.request.urlretrieve(source["url"], archive_path)
    return archive_path


def extract(source, archive_path, skip_existing):
    extract_dir = resolve(source["extract_dir"])
    os.makedirs(extract_dir, exist_ok=True)

    if skip_existing and os.path.isdir(extract_dir) and os.listdir(extract_dir):
        print(f"skip extract: {extract_dir}")
        return

    print(f"extract: {archive_path} -> {extract_dir}")
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extract_dir)


def main():
    parser = argparse.ArgumentParser(description="Collect public BNAFAR/BPS source files.")
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--source", choices=["all", "bnafar", "bps"], default="all")
    parser.add_argument("--force", action="store_true", help="Download/extract even when files already exist.")
    args = parser.parse_args()

    with open(args.config, encoding="utf-8") as handle:
        config = json.load(handle)

    for source in iter_sources(config, args.source):
        archive_path = download(source, skip_existing=not args.force)
        extract(source, archive_path, skip_existing=not args.force)


if __name__ == "__main__":
    main()
