import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import unicodedata
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def slugify(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.strip().lower())
    return text.strip("-")

def to_float(value):
    try:
        return float(str(value or "0").replace(",", "."))
    except ValueError:
        return 0.0

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def main():
    parser = argparse.ArgumentParser(description="Generate regional partners data for a municipality.")
    parser.add_argument("--uf", default="PB")
    parser.add_argument("--municipio", default="Campina Grande")
    parser.add_argument("--raio-km", type=float, default=120.0)
    parser.add_argument("--input", default=None)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    uf = args.uf.upper()
    municipio_base_name = args.municipio
    raio = args.raio_km

    if not args.input:
        input_path = os.path.join(ROOT, "data", "raw", "bnafar", "uf", uf, "posicao_estoque_2026-06-06.csv")
    else:
        input_path = args.input

    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input BNAFAR file not found: {input_path}")

    # Group data by municipality
    mun_coords = defaultdict(list)
    mun_stock = defaultdict(lambda: defaultdict(float))
    ibge_to_name = {}
    name_to_ibge = {}
    product_names = {}

    with open(input_path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for raw in reader:
            row = {key.strip('"'): (value or "").strip('"') for key, value in raw.items()}
            
            row_uf = row.get("sg_uf", "").upper()
            if row_uf != uf:
                continue
                
            mun_ibge = row.get("co_municipio_ibge")
            mun_name = row.get("no_municipio")
            if not mun_ibge or not mun_name:
                continue
                
            lat = to_float(row.get("nu_latitude"))
            lon = to_float(row.get("nu_longitude"))
            
            if abs(lat) > 0.01 and abs(lon) > 0.01:
                mun_coords[mun_ibge].append((lat, lon))
                
            ibge_to_name[mun_ibge] = mun_name
            name_to_ibge[mun_name.upper()] = mun_ibge
            
            qty = to_float(row.get("qt_estoque"))
            catmat = row.get("co_catmat")
            product_desc = row.get("ds_produto")
            if not catmat:
                catmat = product_desc
            
            product_names[catmat] = product_desc
            mun_stock[mun_ibge][catmat] += qty

    # Centroids
    mun_centroids = {}
    for ibge, coords in mun_coords.items():
        avg_lat = sum(c[0] for c in coords) / len(coords)
        avg_lon = sum(c[1] for c in coords) / len(coords)
        mun_centroids[ibge] = (avg_lat, avg_lon)

    # Find base IBGE code
    base_ibge = name_to_ibge.get(municipio_base_name.upper())
    if not base_ibge:
        def norm(v):
            return slugify(v).replace("-", "")
        base_norm = norm(municipio_base_name)
        for name, ibge in name_to_ibge.items():
            if norm(name) == base_norm:
                base_ibge = ibge
                break

    if not base_ibge:
        raise ValueError(f"Base municipality '{municipio_base_name}' not found in state {uf}")

    base_name_real = ibge_to_name[base_ibge]
    
    # Calculate zero stock products of base municipality
    base_zeros = []
    for catmat, qty in mun_stock[base_ibge].items():
        if qty == 0:
            base_zeros.append(catmat)
            
    base_zeros.sort(key=lambda c: product_names.get(c, ""))
    
    produtos_zerados_cg = [
        {"catmat": c, "produto": product_names[c]} for c in base_zeros
    ]

    base_zeros_set = set(base_zeros)
    
    # Base coords fallback
    if base_ibge not in mun_centroids:
        mun_centroids[base_ibge] = (-7.22, -35.88) # CG coordinates

    base_lat, base_lon = mun_centroids[base_ibge]
    
    parceiros = []
    for target_ibge, target_latlon in mun_centroids.items():
        if target_ibge == base_ibge:
            continue
            
        target_lat, target_lon = target_latlon
        dist = haversine(base_lat, base_lon, target_lat, target_lon)
        if dist <= raio:
            target_stock = mun_stock[target_ibge]
            
            # Intersection of zeros
            common_zeros = []
            for catmat in base_zeros:
                if target_stock.get(catmat, 0) == 0:
                    common_zeros.append(catmat)
            
            if common_zeros:
                partner_prods = []
                for c in common_zeros:
                    partner_prods.append({
                        "catmat": c,
                        "produto": product_names[c],
                        "estoqueCG": 0,
                        "estoqueParceiro": 0
                    })
                
                parceiros.append({
                    "cod": target_ibge,
                    "municipio": ibge_to_name[target_ibge],
                    "distKm": round(dist, 1),
                    "produtosZeradosEmComum": len(common_zeros),
                    "produtos": partner_prods
                })

    # Sort partners by produtosZeradosEmComum descending, then distKm ascending
    parceiros.sort(key=lambda p: (-p["produtosZeradosEmComum"], p["distKm"]))

    payload = {
        "meta": {
            "geradoEm": dt.date.today().isoformat(),
            "municipioBase": base_name_real,
            "codIBGEBase": base_ibge,
            "fonte": f"BNAFAR Posição de Estoque {dt.date.today().strftime('%d/%m/%Y')}",
            "raioBuscaKm": int(raio),
            "totalProdutosZeradosCG": len(base_zeros),
            "totalMunicipiosParceiros": len(parceiros)
        },
        "produtosZeradosCG": produtos_zerados_cg,
        "parceiros": parceiros
    }

    if not args.output:
        output_dir = os.path.join(ROOT, "packages", "data", "src", "municipios", uf.lower(), slugify(base_name_real))
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "regional-partners.json")
    else:
        output_path = args.output
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"wrote {len(parceiros)} partners to {output_path}")

if __name__ == "__main__":
    main()
