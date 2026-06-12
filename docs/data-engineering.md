# Data Engineering

This repository is organized as a data engineering pipeline that serves an analytical interface.

The frontend is a consumer. The pipeline is responsible for collecting public data, shaping it into municipal analytical marts, and publishing deterministic artifacts that the interface can read.

## Target Architecture

```text
public sources
  -> data/raw
  -> UF extract
  -> municipal extract
  -> normalized analytical model
  -> municipality app-ready marts
  -> Next.js interface
```

## Pipeline Commands

```bash
npm run data:collect
npm run data:extract:uf -- --uf PB
npm run data:extract -- --municipio "Campina Grande" --uf PB
npm run data:build
```

End to end:

```bash
npm run data:pipeline
```

End to end without downloading again:

```bash
npm run data:pipeline -- --skip-collect
```

## Source Manifest

Public source definitions live in:

```text
config/sources.json
```

The manifest separates acquisition from transformation. When public URLs change, update the manifest without rewriting the analytical rules.

Current public sources:

- BNAFAR stock position ZIP;
- BPS annual compiled ZIPs for 2023, 2024 and 2025.

## Data Layers

### Raw

```text
data/raw/
```

Downloaded or received files. Ignored by Git.

Expected examples:

```text
data/raw/bnafar/full_extract/extracted/Posicao_Estoque_06-06-2026.csv
data/raw/bnafar/uf/PB/posicao_estoque_2026-06-06.csv
data/raw/bnafar/campina_grande_bnafar_posicao_estoque_2026-06-05.csv
data/raw/bps/extracted_2023/2023.csv
data/raw/bps/extracted_2024/2024.csv
data/raw/bps/extracted_2025/2025.csv
```

### UF Extract

`scripts/extract_uf.py` streams the national BNAFAR CSV and writes one UF-level file.

This is the preferred heavy processing boundary. A state file is much smaller than the national source and can feed many municipal builds without re-reading the whole country.

Example:

```text
data/raw/bnafar/uf/PB/posicao_estoque_2026-06-06.csv
```

### Municipal Extract

`scripts/extract_municipality.py` streams a UF-level or national BNAFAR CSV and writes one municipal stock file.

It filters by:

- `no_municipio`;
- `sg_uf`.

This lets the user reuse the UF layer and generate multiple municipal recortes.

### Analytical Build

`scripts/generate_dashboard_data.py` reads the municipal BNAFAR extract and BPS annual files, then generates:

```text
packages/data/src/municipios/pb/campina-grande/dashboard.json
```

The municipal file is intentionally app-ready. It contains precomputed metrics and records so the frontend can run without a database.

The scalable convention is:

```text
packages/data/src/municipios/{uf}/{municipio-slug}/dashboard.json
```

## BNAFAR Model

BNAFAR supports the operational stock layer.

Expected fields:

- UF and municipality;
- CNES and establishment name;
- address and coordinates;
- CATMAT/product code;
- product description;
- stock quantity;
- batch;
- expiration date;
- health program/origin.

Supported analytics:

- stock zero by line;
- product zero in the municipality;
- expired batch with positive stock;
- batch expiring in 30/60 days;
- unit risk ranking;
- internal relocation when one unit is zero and another has positive stock.
- nearby municipalities with similar zero-stock items for regional joint purchasing.

Not supported by BNAFAR alone:

- municipal purchase price;
- monthly consumption;
- patient dispensing;
- statistical rupture forecast;
- clinical recommendation.

## BPS Model

BPS supports defensive purchasing.

The build uses BPS as a public price reference layer:

- median PB;
- median Brazil;
- number of observations;
- comparison between quoted price and public market reference.

BPS does not prove that one municipality overpaid in a specific contract unless that contract/process is also joined. In the product, BPS is the defensible reference baseline.

## App Marts

`packages/data/src/municipios/{uf}/{municipio-slug}/dashboard.json` contains:

- `cards`: high-level KPIs;
- `unitPoints`: georeferenced CNES/unit points;
- `stockRows`: normalized stock rows;
- `medicationSummaries`: product-level summaries;
- `criticalItems`: prioritized alerts;
- `relocation`: internal relocation suggestions;
- `expirationLots`: expired or expiring batches;
- `priceCatalog`: BPS references;
- `reportMetrics`: report-ready metrics.

Other reference artifacts:

```text
packages/data/src/cmed-prices.json
packages/data/src/regional-partners.json
```

`regional-partners.json` supports the regional partnership screen. It maps nearby municipalities, distance from the base municipality, products zeroed in common and candidate items for joint purchasing or intermunicipal coordination.

## Reproducibility Contract

A contributor should be able to:

1. clone the repository;
2. run `npm install`;
3. run `npm run data:pipeline`;
4. inspect `packages/data/src/municipios/{uf}/{municipio}/dashboard.json`;
5. run `npm run dev`;
6. inspect a frontend that uses generated analytical data.

The committed JSONs allow running the app without downloading large public datasets. The pipeline allows reproducing or updating those JSONs.

## Recommended Next Steps

- Add schema validation for raw and mart files.
- Add data quality checks for required fields, date parsing, negative stock and duplicated rows.
- Split large analytical marts into smaller route-level datasets.
- Add a DuckDB/Parquet layer when the static JSON bundle becomes too large.
- Add CI that runs `data:build` against a small fixture dataset.
