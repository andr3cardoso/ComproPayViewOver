// ── Autenticação client-side ──────────────────────────────────────────────────

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === SESSION_TOKEN;
}

// Redireciona para login se não autenticado
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.replace('index.html');
  }
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.replace('index.html');
}

function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl  = document.getElementById('login-error');
  const btnEl    = document.getElementById('login-btn');
  const btnText  = document.getElementById('btn-text');
  const spinner  = document.getElementById('btn-spinner');

  errorEl.classList.add('hidden');
  btnEl.disabled = true;
  btnText.textContent = 'Autenticando…';
  spinner.classList.remove('hidden');

  // Delay intencional para evitar timing attacks e melhorar UX
  setTimeout(() => {
    if (username === APP_CREDENTIALS.username && password === APP_CREDENTIALS.password) {
      sessionStorage.setItem(SESSION_KEY, SESSION_TOKEN);
      window.location.replace('dashboard.html');
    } else {
      errorEl.textContent = 'Usuário ou senha inválidos.';
      errorEl.classList.remove('hidden');
      btnEl.disabled = false;
      btnText.textContent = 'Entrar';
      spinner.classList.add('hidden');
      // Animação de erro no formulário
      const form = document.getElementById('login-form');
      form.classList.add('shake');
      setTimeout(() => form.classList.remove('shake'), 500);
    }
  }, 600);
}

document.addEventListener('DOMContentLoaded', () => {
  // Se já autenticado, vai direto pro dashboard
  if (isAuthenticated()) {
    window.location.replace('dashboard.html');
    return;
  }
  const form = document.getElementById('login-form');
  if (form) form.addEventListener('submit', handleLogin);
});
