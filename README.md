# FarmaCerta PB

FarmaCerta PB é um projeto open source de engenharia de dados para assistência farmacêutica municipal. A proposta coleta bases públicas, transforma esses dados em uma camada analítica municipal e entrega os resultados para uma interface de inteligência em saúde.

O projeto foi vencedor em 1º lugar no **Smart Cities Park - Hackathon Território 2030**.

A interface faz parte do repositório, mas o centro do projeto é a pipeline: dados públicos entram, uma camada analítica municipal sai pronta para consumo pelo front.

## O Que Este Repositório Faz

1. Coleta arquivos públicos do BNAFAR e do BPS.
2. Extrai uma UF a partir da posição nacional de estoque do BNAFAR.
3. Extrai um município a partir da camada da UF.
4. Normaliza campos de estoque, lote, validade, unidade e produto.
5. Cruza o estoque com referências de preço do BPS e bases complementares, como CMED, quando disponíveis.
6. Gera marts analíticos JSON prontos para a aplicação, separados por município.
7. Executa uma interface Next.js que consome esses marts.

## Estrutura Do Repositório

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

## Como Rodar

Instale as dependências:

```bash
npm install
```

Execute a interface usando o dataset derivado já versionado:

```bash
npm run dev
```

Abra:

```text
http://localhost:3000
```

## Rodar A Pipeline De Dados

Usar arquivos já existentes em `data/raw/` e reconstruir a camada analítica:

```bash
npm run data:pipeline -- --skip-collect
```

Baixar fontes públicas, extrair PB, extrair Campina Grande/PB e reconstruir o dataset consumido pela aplicação:

```bash
npm run data:pipeline
```

Aviso: o arquivo nacional do BNAFAR fica grande após extração. Arquivos brutos são ignorados pelo Git de propósito.

Rodar etapas separadas:

```bash
npm run data:collect
npm run data:extract:uf -- --uf PB
npm run data:extract -- --municipio "Campina Grande" --uf PB
npm run data:build
```

Sobrescrever caminhos por variável de ambiente:

```bash
BNAFAR_CSV=/caminho/estoque_municipal.csv BPS_DIR=/caminho/bps npm run data:build
```

No PowerShell:

```powershell
$env:BNAFAR_CSV="C:\dados\estoque_municipal.csv"
$env:BPS_DIR="C:\dados\bps"
npm run data:build
```

## Fontes De Dados

- BNAFAR: posição pública de estoque por estabelecimento, produto, lote, validade e quantidade.
- BPS: registros públicos históricos de preços de compras públicas em saúde.
- CMED e referências complementares: camada auxiliar para teto/regulação de preço quando disponível.

O manifesto das fontes públicas fica em [config/sources.json](config/sources.json). Como URLs públicas podem mudar, o manifesto fica separado da lógica de transformação.

## Camada Analítica

A pipeline produz marts prontos para a aplicação em `packages/data/src/`. A interface importa esses arquivos diretamente, o que permite rodar o projeto sem banco de dados.

Saída municipal canônica:

```text
packages/data/src/municipios/pb/campina-grande/dashboard.json
```

Regras analíticas atuais:

- estoque zero por linha;
- produto zerado no município;
- lote vencido com saldo positivo;
- lote vencendo em 30/60 dias;
- oportunidade de remanejamento interno;
- mapeamento de municípios próximos com faltas semelhantes para apoiar compra conjunta regional;
- comparação de compra defensável contra referências BPS/CMED.

Detalhes em [docs/data-engineering.md](docs/data-engineering.md).

## Build

```bash
npm run build
```

## Limitações

- O BNAFAR público não traz preço de compra municipal.
- O BPS fornece referência pública de preço, não prova sozinho uma compra específica feita por um município.
- Previsão estatística de ruptura exige histórico de consumo, dispensação ou premissas operacionais.
- Dados brutos não são versionados; publique apenas artefatos derivados ou dados sanitizados.

## Licença

MIT. Veja [LICENSE](LICENSE).
