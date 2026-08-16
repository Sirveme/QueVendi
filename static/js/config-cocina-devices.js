/**
 * QueVendi — Gestión de pantallas de cocina desde Configuración del negocio
 * =========================================================================
 * Genera, lista y revoca los enlaces con que las tablets abren /cocina.
 *
 * La sección entera se oculta si el negocio no tiene el módulo cocina
 * activado: una bodega no debe ver opciones de restaurante.
 *
 * OJO OPERATIVO: sólo owner/admin pueden autorizar pantallas. Si quien
 * configura tiene rol vendedor, el backend responde 403 y aquí se
 * explica por qué, en vez de dejar un error mudo.
 */

(function () {

    function _api() { return `${window.location.origin}/api/v1`; }
    function _token() { return localStorage.getItem('access_token'); }

    function _headers() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${_token()}`,
        };
    }

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    function _fecha(iso) {
        if (!iso) return 'nunca';
        const d = new Date(iso);
        return d.toLocaleString('es-PE', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
    }

    function _aviso(msg, tipo) {
        if (typeof showToast === 'function') return showToast(msg, tipo);
        alert(msg);
    }

    // ============================================
    // LISTAR
    // ============================================

    async function cargarPantallasCocina() {
        const card = document.getElementById('card-cocina-devices');
        const lista = document.getElementById('cocinaDeviceList');
        if (!card || !lista) return;

        try {
            const resp = await fetch(`${_api()}/cocina/devices`, { headers: _headers() });

            // 403 = cocina desactivada o el usuario no es dueño: no mostramos la sección.
            if (!resp.ok) { card.style.display = 'none'; return; }

            const data = await resp.json();
            const devices = data.devices || [];
            card.style.display = 'block';

            const activos = devices.filter(d => d.is_active);
            const cont = document.getElementById('cocinaDeviceCount');
            if (cont) cont.textContent = activos.length;

            if (!devices.length) {
                lista.innerHTML = `<div style="color:var(--text3);font-size:0.72rem;padding:10px">
                    Todavía no hay pantallas autorizadas.</div>`;
                return;
            }

            lista.innerHTML = devices.map(d => `
                <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;
                            background:var(--bg2);border:1px solid var(--border);
                            border-radius:8px;margin-bottom:6px;${d.is_active ? '' : 'opacity:.5'}">
                    <i class="fas fa-tablet-screen-button" style="color:var(--orange)"></i>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:0.75rem;font-weight:700">
                            ${_esc(d.nombre || 'Pantalla')}
                            ${d.is_active ? '' : '<span style="color:var(--text3);font-weight:400"> (revocada)</span>'}
                        </div>
                        <div style="font-size:0.63rem;color:var(--text3)">
                            ···${_esc(d.token_cola)} · última vez: ${_fecha(d.last_seen_at)}
                        </div>
                    </div>
                    ${d.is_active ? `
                        <button onclick="revocarPantallaCocina(${d.id}, '${_esc(d.nombre || '')}')"
                            class="device-btn device-btn-danger" style="padding:6px 10px;font-size:0.68rem">
                            <i class="fas fa-ban"></i> Revocar
                        </button>` : ''}
                </div>
            `).join('');

        } catch (e) {
            console.warn('[Cocina devices] No se pudo cargar:', e);
            card.style.display = 'none';
        }
    }

    // ============================================
    // CREAR
    // ============================================

    async function crearPantallaCocina() {
        const input = document.getElementById('cocina-device-nombre');
        const nombre = (input?.value || '').trim();

        try {
            const resp = await fetch(`${_api()}/cocina/devices`, {
                method: 'POST',
                headers: _headers(),
                body: JSON.stringify({ nombre: nombre || 'Pantalla de cocina' }),
            });

            if (resp.status === 403) {
                _aviso('Solo el dueño o un administrador puede autorizar pantallas de cocina', 'error');
                return;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const d = await resp.json();
            if (input) input.value = '';

            _mostrarEnlaceNuevo(d);
            await cargarPantallasCocina();

        } catch (e) {
            console.error('[Cocina devices] Error creando:', e);
            _aviso('No se pudo generar el enlace', 'error');
        }
    }

    /**
     * El token completo se ve UNA sola vez. Se muestra bien visible y
     * con botón de copiar, porque después ya no se puede recuperar.
     */
    function _mostrarEnlaceNuevo(d) {
        const box = document.getElementById('cocina-device-nuevo');
        if (!box) return;

        const url = `${window.location.origin}${d.url}`;
        box.style.display = 'block';
        box.innerHTML = `
            <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);
                        border-radius:8px;padding:12px">
                <div style="font-size:0.72rem;font-weight:800;color:var(--orange);margin-bottom:6px">
                    <i class="fas fa-circle-check"></i> Pantalla autorizada: ${_esc(d.nombre)}
                </div>
                <div style="font-size:0.65rem;color:var(--text3);margin-bottom:8px;line-height:1.5">
                    Abre este enlace <b>una vez</b> en la tablet y déjalo fijo.
                    Guárdalo ahora: por seguridad no se vuelve a mostrar completo.
                </div>
                <div style="display:flex;gap:6px">
                    <input type="text" readonly value="${_esc(url)}" id="cocina-url-nueva"
                        onclick="this.select()"
                        style="flex:1;padding:8px;background:var(--bg);border:1px solid var(--border);
                               border-radius:6px;color:var(--text);font-size:0.66rem;
                               font-family:monospace">
                    <button onclick="copiarEnlaceCocina()" class="device-btn"
                        style="padding:8px 12px;font-size:0.68rem">
                        <i class="fas fa-copy"></i> Copiar
                    </button>
                </div>
            </div>`;
    }

    function copiarEnlaceCocina() {
        const input = document.getElementById('cocina-url-nueva');
        if (!input) return;
        input.select();
        try {
            navigator.clipboard.writeText(input.value);
            _aviso('Enlace copiado', 'success');
        } catch (e) {
            document.execCommand('copy');
            _aviso('Enlace copiado', 'success');
        }
    }

    // ============================================
    // REVOCAR
    // ============================================

    async function revocarPantallaCocina(deviceId, nombre) {
        const ok = confirm(
            `¿Revocar "${nombre || 'esta pantalla'}"?\n\n` +
            `Dejará de mostrar comandas. Las demás pantallas siguen funcionando.`
        );
        if (!ok) return;

        try {
            const resp = await fetch(`${_api()}/cocina/devices/${deviceId}`, {
                method: 'DELETE',
                headers: _headers(),
            });
            if (resp.status === 403) {
                _aviso('Solo el dueño o un administrador puede revocar pantallas', 'error');
                return;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            _aviso('Pantalla revocada', 'success');
            await cargarPantallasCocina();
        } catch (e) {
            console.error('[Cocina devices] Error revocando:', e);
            _aviso('No se pudo revocar', 'error');
        }
    }

    // Exponer para los onclick del HTML
    window.cargarPantallasCocina = cargarPantallasCocina;
    window.crearPantallaCocina = crearPantallaCocina;
    window.revocarPantallaCocina = revocarPantallaCocina;
    window.copiarEnlaceCocina = copiarEnlaceCocina;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(cargarPantallasCocina, 900));
    } else {
        setTimeout(cargarPantallasCocina, 900);
    }
})();
