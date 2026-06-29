# ASR Dashboard — Observabilidade & Segurança de API

Dashboard web estático (HTML + CSS + JS puro) que consome a tabela `public.api_log` no Supabase via cliente JS oficial.

---

## Estrutura de arquivos

```
.
├── index.html      # Tela de login
├── dashboard.html  # Dashboard principal
├── styles.css      # Estilos compartilhados (tema dark, glassmorphism)
├── auth.js         # Lógica de login e proteção de rota
├── dashboard.js    # Leitura do Supabase, gráficos e renderização
└── config.js       # Constantes (URL, anon key, credenciais fixas)
```

---

## Como executar

Abra um terminal na pasta do projeto e rode:

```bash
node serve.js
```

Depois acesse `http://localhost:8080` no navegador.

> Não abra os arquivos como `file://` — o CORS do Supabase bloqueia requisições de origens `file://`.

---

## Configuração do Supabase

### 1. Substituir as credenciais

Edite o arquivo `config.js` e substitua os valores:

```js
const SUPABASE_URL  = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'sua_anon_key_aqui';
```

Você encontra esses valores em: **Supabase Dashboard → Settings → API**.

---

### 2. Política RLS recomendada

A tabela `api_log` precisa de RLS habilitada com uma política que permita `SELECT` para o dashboard funcionar com a `anon key`:

```sql
-- Habilitar RLS na tabela
alter table public.api_log enable row level security;

-- Política: leitura pública (apenas SELECT)
create policy "Leitura pública do dashboard"
  on public.api_log
  for select
  using (true);
```

Execute esse SQL em: **Supabase Dashboard → SQL Editor**.

---

### 3. Habilitar Realtime na tabela

Para receber alertas em tempo real quando chegarem requisições suspeitas:

1. Acesse **Supabase Dashboard → Database → Replication**
2. Clique em **"Tables"** e ative a tabela `api_log` para replicação
3. Ou execute via SQL:

```sql
alter publication supabase_realtime add table public.api_log;
```

Após isso, o indicator **"Realtime: ON"** aparecerá no topo do dashboard, e toasts serão exibidos automaticamente quando `is_suspicious = true` ou `threat_score >= 70`.

---

## Funcionalidades

| Recurso | Detalhe |
|---|---|
| **KPIs** | Total de req., req. suspeitas, threat score médio e pico, latência média + p95, taxa de erro |
| **Filtros** | Data range, método HTTP, status code, auth_type, ip_class, suspeitos, busca livre em path/IP |
| **Timeline** | Gráfico de linha (Chart.js) com total x suspeitas por hora |
| **Status donut** | Distribuição 2xx / 3xx / 4xx / 5xx |
| **Auth donut** | Distribuição por tipo de autenticação |
| **Top 10 IPs** | Barra horizontal por threat score acumulado |
| **Top 10 Paths** | Barra horizontal por volume de acessos |
| **Heatmap** | Grade 7×24 (dia da semana × hora do dia) |
| **Tabela** | Paginada (20/página), linhas suspeitas destacadas, clique abre drawer com todos os campos |
| **Drawer** | Modal lateral com todos os campos + notes |
| **Realtime** | Supabase channel escutando INSERTs — toasts para ameaças |
| **Auto-refresh** | Poll de 30s opcional |
| **Export CSV** | Exporta os registros filtrados com BOM UTF-8 |

---

## Estrutura da tabela `api_log`

```sql
id               uuid primary key
created_at       timestamptz
method           text          -- GET, POST, PUT, DELETE...
path             text
auth_type        text          -- AllowAnonymous | IgnoreAuthenticateAppDevice | Authenticated
app_id           text
ip_address       inet
ip_class         text          -- cloudflare | external | internal
status_code      smallint
response_time_ms integer
is_suspicious    boolean
threat_score     smallint      -- 0-100
notes            text
```
