import argparse
import csv
import os
import unicodedata


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_INPUT = os.path.join(
    ROOT,
    "data",
    "raw",
    "bnafar",
    "full_extract",
    "extracted",
    "Posicao_Estoque_06-06-2026.csv",
)


def normalize(value):
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(text.upper().split())


def default_output(uf):
    return os.path.join(
        ROOT,
        "data",
        "raw",
        "bnafar",
        "uf",
        normalize(uf),
        "posicao_estoque_2026-06-06.csv",
    )


def extract(input_path, output_path, uf):
    wanted_uf = normalize(uf)
    count = 0

    if not os.path.exists(input_path):
        raise FileNotFoundError(
            f"BNAFAR national file not found: {input_path}. "
            "Run collect_sources.py or set --input to an existing CSV."
        )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(input_path, encoding="cp1252", errors="replace", newline="") as source:
        reader = csv.DictReader(source, delimiter=";")
        with open(output_path, "w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(target, fieldnames=reader.fieldnames, delimiter=";", quoting=csv.QUOTE_MINIMAL)
            writer.writeheader()
            for row in reader:
                if normalize(row.get("sg_uf", "")) == wanted_uf:
                    writer.writerow(row)
                    count += 1

    print(f"wrote {count} rows: {output_path}")
    if count == 0:
        raise RuntimeError(f"No BNAFAR rows found for UF {uf}.")


def main():
    parser = argparse.ArgumentParser(description="Extract one UF from the BNAFAR national stock CSV.")
    parser.add_argument("--input", default=os.environ.get("BNAFAR_NATIONAL_CSV", DEFAULT_INPUT))
    parser.add_argument("--uf", default=os.environ.get("UF", "PB"))
    parser.add_argument("--output")
    args = parser.parse_args()

    extract(args.input, args.output or default_output(args.uf), args.uf)


if __name__ == "__main__":
    main()
