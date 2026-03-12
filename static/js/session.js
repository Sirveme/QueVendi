// Renovar token automáticamente cuando quedan menos de 60 min
async function checkSessionExpiry() {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expiresIn = payload.exp * 1000 - Date.now(); // ms
        const oneHour  = 60 * 60 * 1000;

        if (expiresIn < 0) {
            // Token ya expiró
            showSessionModal();
        } else if (expiresIn < oneHour) {
            // Quedan menos de 60 min → renovar silencioso
            await renewToken();
        }
    } catch(e) {}
}

async function renewToken() {
    try {
        const resp = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            localStorage.setItem('access_token', data.access_token);
        }
    } catch(e) {}
}

function showSessionModal() {
    // Modal simple — no redirige abruptamente
    const modal = document.createElement('div');
    modal.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.8);
        z-index:9999;display:flex;align-items:center;justify-content:center
    `;
    modal.innerHTML = `
        <div style="background:#13131e;border:1px solid rgba(255,107,53,0.3);
                    border-radius:16px;padding:28px;max-width:340px;text-align:center">
            <div style="font-size:1.8rem;margin-bottom:12px">⏱</div>
            <div style="font-size:1rem;font-weight:700;color:#e8ecf4;margin-bottom:8px">
                Sesión expirada
            </div>
            <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:20px">
                ¿Deseas continuar trabajando?
            </div>
            <div style="display:flex;gap:10px">
                <button onclick="window.location='/auth/login'"
                    style="flex:1;padding:10px;background:#1a1a28;border:1px solid rgba(255,255,255,0.1);
                           border-radius:8px;color:#94a3b8;cursor:pointer;font-size:0.82rem">
                    Salir
                </button>
                <button onclick="this.closest('div[style*=fixed]').remove(); renewToken();"
                    style="flex:1;padding:10px;background:linear-gradient(135deg,#ff6b35,#ff8c42);
                           border:none;border-radius:8px;color:white;
                           cursor:pointer;font-size:0.82rem;font-weight:700">
                    Continuar ✓
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Revisar cada 5 minutos
checkSessionExpiry();
setInterval(checkSessionExpiry, 5 * 60 * 1000);