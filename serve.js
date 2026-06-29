const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8099;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

// ── Lê environment.env ────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, 'environment.env');
  if (!fs.existsSync(envPath)) {
    console.error('\n⚠  environment.env não encontrado.\n   Crie o arquivo com as credenciais antes de rodar.\n');
    process.exit(1);
  }
  const vars = {};
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx < 0) return;
    vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return vars;
}

// ── Gera config.js em disco com as credenciais reais ─────────────────────────
function buildConfig(env) {
  const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','DASHBOARD_USERNAME','DASHBOARD_PASSWORD'];
  required.forEach(k => {
    if (!env[k]) {
      console.error(`\n⚠  Variável "${k}" não definida em environment.env\n`);
      process.exit(1);
    }
  });

  const content = `// GERADO AUTOMATICAMENTE pelo serve.js — não editar manualmente
// Edite environment.env e reinicie o servidor.
const SUPABASE_URL     = '${env.SUPABASE_URL}';
const SUPABASE_ANON_KEY = '${env.SUPABASE_ANON_KEY}';

const APP_CREDENTIALS = {
  username: '${env.DASHBOARD_USERNAME}',
  password: '${env.DASHBOARD_PASSWORD}',
};

const SESSION_KEY            = 'cpay_dashboard_session';
const SESSION_TOKEN          = 'cpay_authenticated_v1';
const CHARTS_ROW_LIMIT       = 2000;
const TABLE_PAGE_SIZE        = 20;
const THREAT_ALERT_THRESHOLD = 70;
`;

  fs.writeFileSync(path.join(ROOT, 'config.js'), content, 'utf8');
  console.log('✓ config.js gerado com as credenciais do environment.env');
}

// ── Inicializa ────────────────────────────────────────────────────────────────
const ENV = loadEnv();
buildConfig(ENV);

// ── Servidor HTTP estático ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';

  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'text/plain',
      // Sem cache — garante que o navegador sempre pegue a versão mais recente
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠  A porta ${PORT} já está em uso — provavelmente há um servidor antigo rodando.`);
    console.error(`   Feche-o primeiro. No PowerShell:\n`);
    console.error(`   Get-Process node | Stop-Process -Force\n`);
    console.error(`   Depois rode 'node serve.js' de novo.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ CPAY Dashboard em: http://localhost:${PORT}`);
  console.log(`  Ctrl+C para parar\n`);
});
