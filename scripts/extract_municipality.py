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
    "uf",
    "PB",
    "posicao_estoque_2026-06-06.csv",
)
DEFAULT_OUTPUT = os.path.join(
    ROOT,
    "data",
    "raw",
    "bnafar",
    "campina_grande_bnafar_posicao_estoque_2026-06-05.csv",
)


def normalize(value):
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(text.upper().split())


def extract(input_path, output_path, municipality, uf):
    wanted_city = normalize(municipality)
    wanted_uf = normalize(uf)
    count = 0

    if not os.path.exists(input_path):
        raise FileNotFoundError(
            f"BNAFAR source file not found: {input_path}. "
            "Run extract_uf.py first, or set --input to an existing national/UF CSV."
        )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(input_path, encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=";")
        with open(output_path, "w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(target, fieldnames=reader.fieldnames, delimiter=";", quoting=csv.QUOTE_MINIMAL)
            writer.writeheader()
            for row in reader:
                row_city = normalize(row.get("no_municipio", ""))
                row_uf = normalize(row.get("sg_uf", ""))
                if row_city == wanted_city and row_uf == wanted_uf:
                    writer.writerow(row)
                    count += 1

    print(f"wrote {count} rows: {output_path}")
    if count == 0:
        raise RuntimeError(f"No BNAFAR rows found for {municipality}/{uf}.")


def main():
    parser = argparse.ArgumentParser(description="Extract one municipality from a BNAFAR national or UF stock CSV.")
    parser.add_argument("--input", default=os.environ.get("BNAFAR_UF_CSV", DEFAULT_INPUT))
    parser.add_argument("--output", default=os.environ.get("BNAFAR_CSV", DEFAULT_OUTPUT))
    parser.add_argument("--municipio", default=os.environ.get("MUNICIPIO", "Campina Grande"))
    parser.add_argument("--uf", default=os.environ.get("UF", "PB"))
    args = parser.parse_args()

    extract(args.input, args.output, args.municipio, args.uf)


if __name__ == "__main__":
    main()
