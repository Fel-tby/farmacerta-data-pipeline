# Data Directory

This directory is the local landing zone for the data pipeline.

Raw and processed files are ignored by Git:

```text
data/raw/
data/processed/
```

The repository tracks derived app datasets under `packages/data/src/`, not raw public downloads.

## Expected Raw Layout

```text
data/raw/
  bnafar/
    full_extract/
      bnafar_posicao_estoque_2026-06-06.zip
      extracted/
        Posicao_Estoque_06-06-2026.csv
    uf/
      PB/
        posicao_estoque_2026-06-06.csv
    campina_grande_bnafar_posicao_estoque_2026-06-05.csv
  bps/
    bps_2023.zip
    bps_2024.zip
    bps_2025.zip
    extracted_2023/
      2023.csv
    extracted_2024/
      2024.csv
    extracted_2025/
      2025.csv
```

## Rebuild The Analytical Layer

```bash
npm run data:pipeline -- --skip-collect
```

Or download sources first:

```bash
npm run data:pipeline
```

Generated artifacts consumed by the interface live in:

```text
packages/data/src/
packages/data/src/municipios/
```
