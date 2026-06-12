import argparse
import os
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run(command):
    print("+ " + " ".join(command))
    subprocess.run(command, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description="Run the FarmaCerta data pipeline end to end.")
    parser.add_argument("--skip-collect", action="store_true", help="Use existing files under data/raw.")
    parser.add_argument("--source", choices=["all", "bnafar", "bps"], default="all")
    parser.add_argument("--municipio", default=os.environ.get("MUNICIPIO", "Campina Grande"))
    parser.add_argument("--uf", default=os.environ.get("UF", "PB"))
    args = parser.parse_args()

    python = sys.executable

    if not args.skip_collect:
        run([python, "scripts/collect_sources.py", "--source", args.source])

    if args.source in ("all", "bnafar"):
        uf_output = os.path.join(
            "data",
            "raw",
            "bnafar",
            "uf",
            args.uf.upper(),
            "posicao_estoque_2026-06-06.csv",
        )
        run([python, "scripts/extract_uf.py", "--uf", args.uf, "--output", uf_output])
        run(
            [
                python,
                "scripts/extract_municipality.py",
                "--input",
                uf_output,
                "--municipio",
                args.municipio,
                "--uf",
                args.uf,
            ]
        )

    run([python, "scripts/generate_dashboard_data.py"])


if __name__ == "__main__":
    main()
