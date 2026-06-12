import csv
import datetime as dt
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict
from statistics import median


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BNAFAR_CSV = os.environ.get(
    "BNAFAR_CSV",
    os.path.join(
        ROOT,
        "data",
        "raw",
        "bnafar",
        "campina_grande_bnafar_posicao_estoque_2026-06-05.csv",
    ),
)
BPS_DIR = os.environ.get("BPS_DIR", os.path.join(ROOT, "data", "raw", "bps"))
BPS_FILES = [
    os.path.join(BPS_DIR, f"extracted_{year}", f"{year}.csv")
    for year in (2023, 2024, 2025)
]
MUNICIPALITY = os.environ.get("MUNICIPIO", "Campina Grande")
STATE = os.environ.get("UF", "PB")

REFERENCE_DATE = dt.date(2026, 6, 5)


def to_float(value):
    try:
        return float(str(value or "0").replace(",", "."))
    except ValueError:
        return 0.0


def parse_date(value):
    text = str(value or "")[:10]
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def normalize_code(code):
    match = re.search(r"BR0*(\d{5,7})", code or "")
    if not match:
        return None
    return str(int(match.group(1)))


def slugify(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.strip().lower())
    return text.strip("-")


def risk_level(score):
    if score >= 180:
        return "critico"
    if score >= 60:
        return "alto"
    if score >= 20:
        return "moderado"
    return "baixo"


def clean_number(value):
    return int(value) if float(value).is_integer() else round(value, 2)


def fmt_money(value):
    if value is None:
        return None
    return round(float(value), 4)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def row_status(qty, validity):
    if qty == 0:
        return "Estoque zero", "critico", None
    if not validity:
        return "Com saldo", "baixo", None

    days = (validity - REFERENCE_DATE).days
    if days < 0:
        return "Vencido", "critico", days
    if days <= 30:
        return "Vence em 30 dias", "alto", days
    if days <= 60:
        return "Vence em 60 dias", "moderado", days
    return "Com saldo", "baixo", days


def read_bnafar():
    if not os.path.exists(BNAFAR_CSV):
        raise FileNotFoundError(
            "BNAFAR_CSV not found. Put the raw export at "
            f"{BNAFAR_CSV} or set the BNAFAR_CSV environment variable."
        )

    rows = []
    with open(BNAFAR_CSV, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for raw in reader:
            row = {key.strip('"'): (value or "").strip('"') for key, value in raw.items()}
            row["qty"] = to_float(row.get("qt_estoque"))
            row["validity_date"] = parse_date(row.get("dt_validade"))
            row["bps_code"] = normalize_code(row.get("co_catmat"))
            rows.append(row)
    return rows


def read_bps():
    rows = []
    for path in BPS_FILES:
        if not os.path.exists(path):
            continue
        year = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=";")
            for raw in reader:
                row = {key: (value or "").strip('"') for key, value in raw.items()}
                price = to_float(row.get("preco_unitario"))
                if price <= 0:
                    continue
                row["year"] = year
                row["price"] = price
                rows.append(row)
    return rows


def build_price_references(rows):
    bps = read_bps()
    bps_by_code = defaultdict(list)
    bps_pb_by_code = defaultdict(list)

    for row in bps:
        code = row.get("codigo_br")
        if not code:
            continue
        bps_by_code[code].append(row["price"])
        if row.get("uf") == "PB":
            bps_pb_by_code[code].append(row["price"])

    code_to_product = {}
    for row in rows:
        if row["bps_code"] and row["bps_code"] not in code_to_product:
            code_to_product[row["bps_code"]] = row["ds_produto"]

    refs = []
    for code, product in code_to_product.items():
        pb_prices = bps_pb_by_code.get(code, [])
        br_prices = bps_by_code.get(code, [])
        if not br_prices:
            continue
        refs.append(
            {
                "product": product,
                "code": code,
                "medianPB": fmt_money(median(pb_prices)) if pb_prices else None,
                "observationsPB": len(pb_prices),
                "medianBrazil": fmt_money(median(br_prices)),
                "observationsBrazil": len(br_prices),
            }
        )

    refs.sort(
        key=lambda item: (item["observationsPB"], item["observationsBrazil"], item["product"]),
        reverse=True,
    )
    return refs


def main():
    rows = read_bnafar()

    units = {}
    unit_metrics = defaultdict(Counter)
    product_total = defaultdict(float)
    product_units = defaultdict(set)
    product_unit_qty = defaultdict(float)
    product_label = {}
    product_code = {}
    product_programs = defaultdict(Counter)
    product_status = defaultdict(Counter)
    product_lots = defaultdict(list)
    stock_rows = []
    expired_items = []
    expiring_items = []
    critical_items = []

    for index, row in enumerate(rows, start=1):
        cnes = row["co_cnes"]
        qty = row["qty"]
        product_key = row["co_catmat"] or row["ds_produto"]
        product = row["ds_produto"]
        unit_name = row["no_fantasia"]
        validity = row["validity_date"]
        status, severity, days = row_status(qty, validity)

        units[cnes] = {
            "cnes": cnes,
            "name": unit_name,
            "neighborhood": row.get("no_bairro", ""),
            "address": f"{row.get('no_logradouro', '')}, {row.get('nu_endereco', '')}".strip(", "),
            "lat": to_float(row.get("nu_latitude")),
            "lon": to_float(row.get("nu_longitude")),
        }
        product_label.setdefault(product_key, product)
        product_code.setdefault(product_key, row.get("co_catmat", ""))
        product_total[product_key] += qty
        product_units[product_key].add(unit_name)
        product_unit_qty[(product_key, unit_name)] += qty
        product_programs[product_key][row.get("ds_programa_saude") or "Nao informado"] += 1
        product_status[product_key][status] += 1

        if qty == 0:
            unit_metrics[unit_name]["zeroRows"] += 1
        else:
            unit_metrics[unit_name]["positiveRows"] += 1
        if status == "Vencido":
            unit_metrics[unit_name]["expiredRows"] += 1
        if status in ("Vence em 30 dias", "Vence em 60 dias"):
            unit_metrics[unit_name]["expiringRows"] += 1

        normalized = {
            "id": index,
            "unit": unit_name,
            "cnes": cnes,
            "neighborhood": row.get("no_bairro", ""),
            "product": product,
            "code": row.get("co_catmat", ""),
            "normalizedCode": row.get("bps_code"),
            "lot": row.get("nu_lote", ""),
            "validity": validity.isoformat() if validity else "",
            "daysToExpire": days,
            "stock": clean_number(qty),
            "status": status,
            "severity": severity,
            "program": row.get("ds_programa_saude", ""),
            "programCode": row.get("sg_programa_saude", ""),
            "origin": row.get("sg_origem", ""),
            "source": "BNAFAR",
        }
        stock_rows.append(normalized)

        if qty > 0 and validity:
            item = {
                "unit": unit_name,
                "cnes": cnes,
                "product": product,
                "code": row.get("co_catmat", ""),
                "lot": row.get("nu_lote", ""),
                "validity": validity.isoformat(),
                "days": days,
                "stock": clean_number(qty),
                "status": status,
                "severity": severity,
                "source": "BNAFAR",
            }
            if days is not None and days < 0:
                expired_items.append(item)
            elif days is not None and days <= 60:
                expiring_items.append(item)

        if qty > 0 or validity:
            product_lots[product_key].append(
                {
                    "unit": unit_name,
                    "cnes": cnes,
                    "lot": row.get("nu_lote", ""),
                    "validity": validity.isoformat() if validity else "",
                    "daysToExpire": days,
                    "stock": clean_number(qty),
                    "status": status,
                }
            )

    system_zero_products = sorted([product for product, total in product_total.items() if total == 0])

    relocation = []
    for product_key, label in product_label.items():
        unit_sums = [
            (unit, product_unit_qty[(product_key, unit)])
            for unit in product_units[product_key]
        ]
        zero_units = sorted([unit for unit, value in unit_sums if value == 0])
        donor_units = sorted(
            [(unit, value) for unit, value in unit_sums if value > 0],
            key=lambda entry: (-entry[1], entry[0]),
        )
        if zero_units and donor_units:
            relocation.append(
                {
                    "product": label,
                    "code": product_code.get(product_key, ""),
                    "zeroUnits": zero_units[:8],
                    "donorUnits": [
                        {"unit": unit, "stock": clean_number(value)}
                        for unit, value in donor_units[:8]
                    ],
                    "availableStock": clean_number(sum(value for _, value in donor_units)),
                }
            )

    relocation.sort(key=lambda item: (-item["availableStock"], item["product"]))

    price_refs = build_price_references(rows)
    price_by_code = {item["code"]: item for item in price_refs}

    medication_summaries = []
    for product_key, label in product_label.items():
        unit_sums = [
            (unit, product_unit_qty[(product_key, unit)])
            for unit in product_units[product_key]
        ]
        zero_units = sorted([unit for unit, value in unit_sums if value == 0])
        units_with_stock = sorted([unit for unit, value in unit_sums if value > 0])
        total_stock = clean_number(product_total[product_key])
        code = product_code.get(product_key, "")
        normalized_code = normalize_code(code)
        summary_status = "Com saldo"
        severity = "baixo"
        if total_stock == 0:
            summary_status = "Zerado no municipio"
            severity = "critico"
        elif zero_units and units_with_stock:
            summary_status = "Remanejamento possivel"
            severity = "moderado"
        elif product_status[product_key]["Vencido"]:
            summary_status = "Tem lote vencido"
            severity = "alto"
        elif product_status[product_key]["Vence em 30 dias"] or product_status[product_key]["Vence em 60 dias"]:
            summary_status = "Tem vencimento proximo"
            severity = "moderado"

        medication_summaries.append(
            {
                "product": label,
                "code": code,
                "normalizedCode": normalized_code,
                "programs": [name for name, _ in product_programs[product_key].most_common(4)],
                "totalStock": total_stock,
                "unitCount": len(product_units[product_key]),
                "unitsWithStock": len(units_with_stock),
                "zeroUnits": len(zero_units),
                "zeroUnitNames": zero_units[:6],
                "expiredRows": product_status[product_key]["Vencido"],
                "expiringRows": product_status[product_key]["Vence em 30 dias"] + product_status[product_key]["Vence em 60 dias"],
                "status": summary_status,
                "severity": severity,
                "hasPriceReferencePB": bool(normalized_code and price_by_code.get(normalized_code, {}).get("observationsPB")),
                "lots": sorted(
                    product_lots[product_key],
                    key=lambda item: (
                        item["validity"] == "",
                        item["validity"],
                        item["unit"],
                    ),
                )[:12],
            }
        )

    medication_summaries.sort(
        key=lambda item: (
            item["severity"] != "critico",
            item["severity"] != "alto",
            item["product"],
        )
    )

    for product_key in system_zero_products[:25]:
        matching = [row for row in stock_rows if (row["code"] or row["product"]) == product_key][:1]
        if matching:
            row = matching[0]
            critical_items.append(
                {
                    **row,
                    "action": "Comprar ou repor",
                    "evidence": "Produto totalmente zerado no recorte municipal.",
                }
            )

    for item in expired_items[:18]:
        critical_items.append(
            {
                **item,
                "action": "Revisar dado / segregar lote",
                "evidence": f"Saldo positivo com validade vencida ha {abs(item['days'])} dias.",
            }
        )

    for item in expiring_items[:18]:
        critical_items.append(
            {
                **item,
                "action": "Priorizar giro do lote",
                "evidence": f"Saldo positivo com vencimento em {item['days']} dias.",
            }
        )

    for item in relocation[:18]:
        critical_items.append(
            {
                "unit": item["zeroUnits"][0],
                "cnes": "",
                "product": item["product"],
                "code": item["code"],
                "lot": "",
                "validity": "",
                "stock": 0,
                "status": "Realocar",
                "severity": "moderado",
                "action": "Remanejar",
                "evidence": f"Zerado em {len(item['zeroUnits'])} unidade(s), com saldo em {len(item['donorUnits'])} doadora(s).",
                "source": "BNAFAR",
            }
        )

    unit_points = []
    for unit in units.values():
        metrics = unit_metrics[unit["name"]]
        score = metrics["zeroRows"] + metrics["expiredRows"] * 3 + metrics["expiringRows"] * 2
        action = "Monitorar"
        if metrics["expiredRows"]:
            action = "Revisar lotes vencidos"
        elif metrics["zeroRows"]:
            action = "Avaliar reposição"
        elif metrics["expiringRows"]:
            action = "Priorizar giro"

        unit_points.append(
            {
                **unit,
                "zeroRows": metrics["zeroRows"],
                "expiredRows": metrics["expiredRows"],
                "expiringRows": metrics["expiringRows"],
                "positiveRows": metrics["positiveRows"],
                "score": score,
                "riskLevel": risk_level(score),
                "topAction": action,
            }
        )

    unit_points.sort(key=lambda item: item["score"], reverse=True)

    featured_price_refs = [
        item
        for item in price_refs
        if item["medianPB"]
        and any(
            keyword in item["product"].upper()
            for keyword in [
                "LOSARTANA",
                "METFORMINA",
                "AMOXICILINA",
                "AMITRIPTILINA",
                "SINVASTATINA",
                "CAPTOPRIL",
                "DIPIRONA",
                "INSULINA",
            ]
        )
    ][:12]

    cards = {
        "monitoredProducts": len(product_label),
        "monitoredUnits": len(units),
        "zeroProductCount": len(system_zero_products),
        "zeroStockRows": sum(1 for row in stock_rows if row["stock"] == 0),
        "expiredPositiveRows": len(expired_items),
        "expiring30Rows": sum(1 for item in expiring_items if item["days"] <= 30),
        "expiring60Rows": len(expiring_items),
        "relocationProducts": len(relocation),
        "priceReferenceCoveragePB": sum(1 for item in price_refs if item["observationsPB"] > 0),
        "priceReferenceCoverageBrazil": len(price_refs),
    }

    report_metrics = {
        "rupture": {
            "title": "Ruptura municipal",
            "count": cards["zeroProductCount"],
            "rule": "Soma municipal de qt_estoque por produto igual a zero.",
        },
        "expiration": {
            "title": "Vencidos e vencendo",
            "count": cards["expiredPositiveRows"] + cards["expiring60Rows"],
            "rule": "dt_validade vencida ou em ate 60 dias, com qt_estoque maior que zero.",
        },
        "relocation": {
            "title": "Remanejamento possivel",
            "count": cards["relocationProducts"],
            "rule": "Produto zerado em uma unidade e com saldo positivo em outra.",
        },
        "price": {
            "title": "Compra defensável",
            "count": cards["priceReferenceCoveragePB"],
            "rule": "Cotacao informada comparada contra medianas BPS-PB/Brasil.",
        },
    }

    data = {
        "meta": {
            "project": "FarmaCerta PB",
            "municipality": MUNICIPALITY,
            "state": STATE,
            "stockSource": "BNAFAR",
            "stockPositionDate": "2026-06-05",
            "generatedAt": REFERENCE_DATE.isoformat(),
            "scope": "Dados reais de posição de estoque; BNAFAR não traz preço de compra nem consumo histórico.",
        },
        "cards": cards,
        "unitPoints": unit_points,
        "stockRows": stock_rows,
        "medicationSummaries": medication_summaries,
        "criticalItems": critical_items[:64],
        "relocation": relocation[:36],
        "expirationLots": sorted(
            expired_items + expiring_items,
            key=lambda item: (item["days"] is None, item["days"] if item["days"] is not None else 9999),
        )[:80],
        "priceReferences": featured_price_refs,
        "priceCatalog": price_refs[:80],
        "reportMetrics": report_metrics,
        "dataQuality": {
            "rows": len(rows),
            "missingLots": sum(1 for row in rows if not row.get("nu_lote")),
            "negativeQuantityRows": sum(1 for row in rows if row["qty"] < 0),
            "coordinatesValid": len(unit_points),
            "notes": [
                "BNAFAR não traz preço de compra neste recorte.",
                "Previsão de ruptura exige consumo histórico ou parâmetro informado.",
                "Lotes vencidos com saldo positivo devem acionar revisão operacional e qualidade do dado.",
                "As 26 unidades/CNES representam estabelecimentos com estoque publicado nesta carga, não toda a rede municipal.",
            ],
        },
    }

    mart_json = os.environ.get(
        "MART_OUTPUT",
        os.path.join(
            ROOT,
            "packages",
            "data",
            "src",
            "municipios",
            STATE.lower(),
            slugify(MUNICIPALITY),
            "dashboard.json",
        ),
    )

    write_json(mart_json, data)


if __name__ == "__main__":
    main()
