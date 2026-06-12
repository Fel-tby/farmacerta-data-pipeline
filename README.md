# FarmaCerta PB

FarmaCerta PB é um projeto open source de engenharia de dados para assistência farmacêutica municipal. A proposta coleta bases públicas, transforma esses dados em uma camada analítica municipal e entrega os resultados para uma interface de inteligência em saúde.

O projeto foi vencedor em 1º lugar no **Smart Cities Park - Hackathon Território 2030**.

A interface faz parte do repositório, mas o centro do projeto é a pipeline: dados públicos entram, uma camada analítica municipal sai pronta para consumo pelo front, sem banco de dados intermediário.

---

## O que a pipeline faz

O fluxo começa na coleta de arquivos públicos do BNAFAR e do BPS. A partir do arquivo nacional de estoque do BNAFAR, a pipeline recorta uma UF e, a seguir, um município específico. Os campos de estoque, lote, validade, unidade e produto são normalizados e cruzados com referências de preço do BPS e bases complementares como o CMED, quando disponíveis. O resultado são marts analíticos em JSON prontos para a aplicação, separados por município, que a interface Next.js consome diretamente.

---

## Camada analítica

A pipeline produz marts prontos para a aplicação em `packages/data/src/`. A interface importa esses arquivos diretamente, o que permite rodar o projeto sem banco de dados.

A saída municipal canônica fica em:

```text
packages/data/src/municipios/pb/campina-grande/dashboard.json
```

As regras analíticas atuais cobrem: estoque zero por linha; produto zerado no município; lote vencido com saldo positivo; lote vencendo em 30 ou 60 dias; oportunidade de remanejamento interno; mapeamento de municípios próximos com faltas semelhantes para apoiar compra conjunta regional; e comparação de compra defensável contra referências BPS e CMED.

Detalhes em [docs/data-engineering.md](docs/data-engineering.md).

---

## Fontes de dados

| Fonte | O que fornece |
|---|---|
| BNAFAR | Posição pública de estoque por estabelecimento, produto, lote, validade e quantidade |
| BPS | Registros históricos de preços de compras públicas em saúde |
| CMED | Camada auxiliar para teto e regulação de preço, quando disponível |

O manifesto das fontes públicas fica em [config/sources.json](config/sources.json). Como URLs públicas podem mudar, o manifesto é mantido separado da lógica de transformação.

---

## Estrutura do repositório

```text
config/
  sources.json               # URLs públicas e caminhos locais das fontes

data/
  raw/                       # ignorado: arquivos baixados
  processed/                 # ignorado: intermediários locais
  README.md

scripts/
  collect_sources.py         # baixa e extrai BNAFAR/BPS
  extract_uf.py              # recorta uma UF a partir do BNAFAR nacional
  extract_municipality.py    # recorta um município a partir da UF
  generate_dashboard_data.py # gera os marts analíticos JSON
  run_pipeline.py            # orquestra coleta -> UF -> município -> mart

packages/data/src/
  municipios/pb/campina-grande/dashboard.json
  cmed-prices.json
  regional-partners.json
  index.ts

packages/ai/
  regras determinísticas e auxiliares opcionais de IA

apps/web/
  interface analítica em Next.js
```

---

## Como rodar

Instale as dependências e suba a interface usando o dataset derivado já versionado no repositório:

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

---

## Rodando a pipeline de dados

Para usar os arquivos já presentes em `data/raw/` e reconstruir apenas a camada analítica:

```bash
npm run data:pipeline -- --skip-collect
```

Para baixar as fontes públicas do zero, extrair PB, extrair Campina Grande/PB e reconstruir o dataset consumido pela aplicação:

```bash
npm run data:pipeline
```

O arquivo nacional do BNAFAR fica grande após extração. Arquivos brutos são ignorados pelo Git de propósito.

As etapas também podem ser executadas separadamente:

```bash
npm run data:collect
npm run data:extract:uf -- --uf PB
npm run data:extract -- --municipio "Campina Grande" --uf PB
npm run data:build
```

Caminhos podem ser sobrescritos por variável de ambiente. No bash:

```bash
BNAFAR_CSV=/caminho/estoque_municipal.csv BPS_DIR=/caminho/bps npm run data:build
```

No PowerShell:

```powershell
$env:BNAFAR_CSV="C:\dados\estoque_municipal.csv"
$env:BPS_DIR="C:\dados\bps"
npm run data:build
```

---

## Build

```bash
npm run build
```

---

## Limitações

O BNAFAR público não traz preço de compra municipal. O BPS fornece referência pública de preço, mas não prova sozinho uma compra específica feita por um município. Previsão estatística de ruptura exige histórico de consumo, dispensação ou premissas operacionais explícitas. Dados brutos não são versionados; publique apenas artefatos derivados ou dados sanitizados.

---

## Licença

MIT. Veja [LICENSE](LICENSE).
