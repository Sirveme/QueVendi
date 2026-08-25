/**
 * QueVendi — Activar avisos en el celular
 * ========================================
 * Registra el navegador para recibir notificaciones push (caja abierta,
 * caja cerrada, stock mínimo) aunque la app esté cerrada.
 *
 * Sólo aparece si:
 *   · la tienda tiene `push_enabled`
 *   · el usuario es dueño o administrador
 *   · el navegador soporta push (iOS < 16.4 no, y hace falta HTTPS)
 *
 * El service worker que muestra la notificación ya existía
 * (static/sw.js, evento 'push'); aquí sólo se hace la suscripción.
 */

const PushAvisos = (() => {

    const estado = {
        soportado: false,
        activo: false,
        suscrito: false,
        preferencias: { caja: true, stock: true },
    };

    function _api() {
        return (typeof CONFIG !== 'undefined' && CONFIG.apiBase)
            ? CONFIG.apiBase
            : `${window.location.origin}/api/v1`;
    }

    function _token() {
        return (typeof getAuthToken === 'function')
            ? getAuthToken() : localStorage.getItem('access_token');
    }

    function _toast(msg, tipo) {
        if (typeof showToast === 'function') return showToast(msg, tipo);
        console.log('[Push] ' + msg);
    }

    async function _fetch(path, opts = {}) {
        const resp = await fetch(`${_api()}/push${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_token()}`,
                ...(opts.headers || {}),
            },
        });
        if (!resp.ok) {
            const e = new Error(`HTTP ${resp.status}`);
            e.status = resp.status;
            throw e;
        }
        return resp.json();
    }

    // ============================================
    // ARRANQUE
    // ============================================

    async function init() {
        estado.soportado = ('serviceWorker' in navigator)
                        && ('PushManager' in window)
                        && ('Notification' in window);

        try {
            const s = await _fetch('/estado');
            estado.activo = s.enabled && s.puede_recibir && s.vapid_configurado;
            estado.suscrito = s.suscrito;
            estado.preferencias = s.preferencias || estado.preferencias;
        } catch (e) {
            return;   // sin permiso o sin flag: no se muestra nada
        }

        if (!estado.activo) return;
        _montarBoton();
    }

    // ============================================
    // SUSCRIPCIÓN
    // ============================================

    function _urlB64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
        return out;
    }

    async function activar() {
        if (!estado.soportado) {
            return _toast('Este dispositivo no admite avisos. Usa Chrome en Android o Safari 16.4+', 'warning');
        }

        // El permiso debe pedirse desde un gesto del usuario.
        let permiso;
        try {
            permiso = await Notification.requestPermission();
        } catch (e) {
            permiso = Notification.permission;
        }
        if (permiso !== 'granted') {
            return _toast('No diste permiso para avisos. Puedes activarlo en los ajustes del navegador.', 'warning');
        }

        try {
            const { publicKey } = await _fetch('/vapid-key');

            // El SW puede no estar registrado en esta pantalla todavía.
            let reg = await navigator.serviceWorker.getRegistration();
            if (!reg) reg = await navigator.serviceWorker.register('/static/sw.js');
            await navigator.serviceWorker.ready;

            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: _urlB64ToUint8Array(publicKey),
                });
            }

            await _fetch('/suscribir', {
                method: 'POST',
                body: JSON.stringify({
                    subscription: sub.toJSON(),
                    preferencias: estado.preferencias,
                }),
            });

            estado.suscrito = true;
            _pintarBoton();
            _toast('🔔 Avisos activados en este dispositivo', 'success');

        } catch (e) {
            console.error('[Push] Error activando:', e);
            _toast('No se pudieron activar los avisos', 'error');
        }
    }

    async function desactivar() {
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg && await reg.pushManager.getSubscription();
            if (sub) {
                await _fetch('/suscribir', {
                    method: 'DELETE',
                    body: JSON.stringify({ endpoint: sub.endpoint }),
                });
                await sub.unsubscribe();
            }
            estado.suscrito = false;
            _pintarBoton();
            _toast('Avisos desactivados en este dispositivo', 'info');
        } catch (e) {
            console.error('[Push] Error desactivando:', e);
            _toast('No se pudo desactivar', 'error');
        }
    }

    async function probar() {
        try {
            const r = await _fetch('/probar', { method: 'POST' });
            _toast(r.success ? 'Aviso enviado — revisa tu celular'
                             : `No se envió: ${r.motivo || 'sin destinatarios'}`,
                   r.success ? 'success' : 'warning');
        } catch (e) {
            _toast('No se pudo enviar la prueba', 'error');
        }
    }

    async function cambiarPreferencia(grupo, valor) {
        estado.preferencias[grupo] = valor;
        try {
            await _fetch('/preferencias', {
                method: 'PUT',
                body: JSON.stringify(estado.preferencias),
            });
        } catch (e) {
            _toast('No se pudo guardar la preferencia', 'error');
        }
    }

    // ============================================
    // UI
    // ============================================

    function _montarBoton() {
        if (document.getElementById('push-avisos-card')) return;

        // Se engancha donde haya sitio en configuración; si no, no se
        // muestra nada en vez de romper la pantalla.
        const destino = document.getElementById('tab-devices')
                     || document.querySelector('.section-card')?.parentElement;
        if (!destino) return;

        const card = document.createElement('div');
        card.className = 'section-card';
        card.id = 'push-avisos-card';
        card.innerHTML = `
            <div class="section-title">
                <i class="fas fa-bell"></i> Avisos al celular
            </div>
            <div style="font-size:0.68rem;color:var(--text3);line-height:1.5;margin-bottom:10px">
                Recibe en tu celular cuando se abre o cierra la caja y cuando
                un producto llega a su stock mínimo, aunque no tengas la app abierta.
            </div>
            <div id="push-avisos-prefs" style="margin-bottom:10px"></div>
            <div style="display:flex;gap:8px">
                <button id="btn-push-toggle" class="device-btn" style="flex:1"></button>
                <button id="btn-push-probar" class="device-btn" style="flex:1">
                    <i class="fas fa-paper-plane"></i> Probar
                </button>
            </div>`;
        destino.appendChild(card);

        document.getElementById('btn-push-probar').onclick = probar;
        _pintarBoton();
        _pintarPrefs();
    }

    function _pintarBoton() {
        const b = document.getElementById('btn-push-toggle');
        if (!b) return;
        if (estado.suscrito) {
            b.innerHTML = '<i class="fas fa-bell-slash"></i> Desactivar en este equipo';
            b.onclick = desactivar;
        } else {
            b.innerHTML = '<i class="fas fa-bell"></i> Activar avisos';
            b.onclick = activar;
        }
    }

    function _pintarPrefs() {
        const c = document.getElementById('push-avisos-prefs');
        if (!c) return;
        const filas = [
            ['caja', 'Apertura y cierre de caja'],
            ['stock', 'Productos en stock mínimo'],
        ];
        c.innerHTML = filas.map(([clave, texto]) => `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 0;
                          font-size:0.72rem;cursor:pointer">
                <input type="checkbox" data-grupo="${clave}"
                    ${estado.preferencias[clave] ? 'checked' : ''}
                    style="width:auto">
                ${texto}
            </label>`).join('');

        c.querySelectorAll('input[data-grupo]').forEach(inp => {
            inp.onchange = () => cambiarPreferencia(inp.dataset.grupo, inp.checked);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1200));
    } else {
        setTimeout(init, 1200);
    }

    return { init, activar, desactivar, probar };
})();

window.PushAvisos = PushAvisos;
