import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import unicodedata
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def slugify(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.strip().lower())
    return text.strip("-")

def run(command, env=None):
    print("+ " + " ".join(command))
    current_env = os.environ.copy()
    if env:
        current_env.update(env)
    subprocess.run(command, cwd=ROOT, check=True, env=current_env)

def main():
    parser = argparse.ArgumentParser(description="Run pipeline and generate data for all configured municipalities.")
    parser.add_argument("--config", default=os.path.join(ROOT, "config", "municipalities.json"))
    args = parser.parse_args()

    if not os.path.exists(args.config):
        raise FileNotFoundError(f"Municipalities config file not found: {args.config}")

    with open(args.config, encoding="utf-8") as f:
        municipalities = json.load(f)

    python = sys.executable
    index_entries = []

    temp_csv = os.path.join(ROOT, "data", "raw", "bnafar", "temp_extracted_all.csv")

    for entry in municipalities:
        uf = entry["uf"].upper()
        municipio = entry["municipio"]
        slug = slugify(municipio)
        
        print(f"\n========================================")
        print(f"Generating data for {municipio} ({uf})")
        print(f"========================================\n")
        
        # 1. Extract municipality CSV
        uf_input_csv = os.path.join(ROOT, "data", "raw", "bnafar", "uf", uf, "posicao_estoque_2026-06-06.csv")
        run([
            python,
            "scripts/extract_municipality.py",
            "--input", uf_input_csv,
            "--output", temp_csv,
            "--municipio", municipio,
            "--uf", uf
        ])
        
        # 2. Generate dashboard.json
        dashboard_output = os.path.join(
            ROOT, "packages", "data", "src", "municipios", uf.lower(), slug, "dashboard.json"
        )
        
        env_vars = {
            "MUNICIPIO": municipio,
            "UF": uf,
            "BNAFAR_CSV": temp_csv,
            "MART_OUTPUT": dashboard_output
        }
        
        run([python, "scripts/generate_dashboard_data.py"], env=env_vars)
        
        # 3. Generate regional partners
        partners_output = os.path.join(
            ROOT, "packages", "data", "src", "municipios", uf.lower(), slug, "regional-partners.json"
        )
        run([
            python,
            "scripts/generate_regional_partners.py",
            "--uf", uf,
            "--municipio", municipio,
            "--output", partners_output
        ])
        
        index_entries.append({
            "slug": slug,
            "name": municipio,
            "uf": uf,
            "generatedAt": dt.date.today().isoformat()
        })

    # Cleanup temp csv
    if os.path.exists(temp_csv):
        os.remove(temp_csv)

    # Write index.json
    index_path = os.path.join(ROOT, "packages", "data", "src", "municipios", "index.json")
    os.makedirs(os.path.dirname(index_path), exist_ok=True)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_entries, f, ensure_ascii=False, indent=2)
        f.write("\n")
        
    print(f"\nGenerated index with {len(index_entries)} municipalities at {index_path}")

if __name__ == "__main__":
    main()
