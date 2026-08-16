/**
 * QueVendi — Enviar a cocina desde la pantalla de venta
 * =====================================================
 * Toma el carrito actual, crea la comanda en el servidor y manda el
 * layout ESC/POS al Print Agent que corre en la PC del cajero.
 *
 * El Print Agent vive en http://localhost:9638 (la máquina del cliente,
 * no el servidor), por eso el POST sale del navegador. Chrome trata
 * http://localhost como origen seguro, así que no hay mixed content
 * aunque la página venga por HTTPS.
 *
 * SI EL AGENTE NO RESPONDE NO SE FALLA EN SILENCIO: la comanda ya quedó
 * registrada y cocina ya la recibió por WebSocket, así que se avisa con
 * un aviso rojo y se ofrece ver la comanda en pantalla para dictarla.
 */

const CocinaEnviar = (() => {

    const AGENTE_TIMEOUT_MS = 3000;

    // Una comanda enviada espera a que se cobre para enlazarse con la
    // venta. Se guarda en localStorage para sobrevivir a un F5 en plena
    // atención. Caduca a las 4 h para no enlazar la comanda de anoche
    // con la primera venta de la mañana.
    const PENDIENTE_KEY = 'cocina_comanda_pendiente';
    const PENDIENTE_TTL_MS = 4 * 60 * 60 * 1000;

    function _api() {
        return (typeof CONFIG !== 'undefined' && CONFIG.apiBase)
            ? CONFIG.apiBase
            : `${window.location.origin}/api/v1`;
    }

    function _token() {
        return (typeof getAuthToken === 'function')
            ? getAuthToken()
            : localStorage.getItem('access_token');
    }

    function _toast(msg, tipo) {
        if (typeof showToast === 'function') return showToast(msg, tipo);
        console.log(`[Cocina] ${tipo}: ${msg}`);
    }

    // ============================================
    // COMANDA PENDIENTE DE COBRO
    // ============================================

    function _guardarPendiente(comandaId, numero) {
        try {
            localStorage.setItem(PENDIENTE_KEY, JSON.stringify({
                comanda_id: comandaId, numero: numero, ts: Date.now(),
            }));
        } catch (e) {}
    }

    function _leerPendiente() {
        try {
            const raw = localStorage.getItem(PENDIENTE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (!p || !p.comanda_id) return null;
            if (Date.now() - (p.ts || 0) > PENDIENTE_TTL_MS) {
                _limpiarPendiente();
                return null;
            }
            return p;
        } catch (e) {
            return null;
        }
    }

    function _limpiarPendiente() {
        try { localStorage.removeItem(PENDIENTE_KEY); } catch (e) {}
    }

    /**
     * Enlaza la comanda pendiente con la venta recién cobrada.
     *
     * La llama executeSale() después de crear la venta. Es silenciosa a
     * propósito: el enlace es un dato de trazabilidad, no algo que el
     * cajero deba atender en medio de la cola. Si falla, la venta y la
     * comanda siguen existiendo por separado.
     *
     * @param {number} saleId  id de la venta creada en el servidor
     * @returns {Promise<boolean>} true si se enlazó
     */
    async function enlazarVenta(saleId) {
        if (!saleId) return false;

        const pendiente = _leerPendiente();
        if (!pendiente) return false;

        try {
            const resp = await fetch(`${_api()}/cocina/comanda/${pendiente.comanda_id}/venta`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token()}`,
                },
                body: JSON.stringify({ sale_id: saleId }),
            });

            if (resp.ok) {
                console.log(`[Cocina] 🔗 Comanda #${pendiente.numero} enlazada a la venta ${saleId}`);
                _limpiarPendiente();
                return true;
            }

            // 404: la comanda ya no existe (o es de otra tienda). No tiene
            // sentido reintentarlo en la próxima venta.
            if (resp.status === 404) _limpiarPendiente();
            console.warn(`[Cocina] No se pudo enlazar la comanda: HTTP ${resp.status}`);
            return false;

        } catch (e) {
            // Sin conexión: se deja pendiente por si la próxima venta sí sale.
            console.warn('[Cocina] Error enlazando comanda con la venta:', e.message);
            return false;
        }
    }

    // ============================================
    // ENVÍO
    // ============================================

    /**
     * Envía el carrito actual a cocina.
     * @param {Array} items  Opcional. Por defecto toma AppState.cart.
     * @param {Object} opts  { sale_id, nota }
     */
    async function enviar(items = null, opts = {}) {
        const carrito = items || (typeof AppState !== 'undefined' ? AppState.cart : []) || [];

        if (!carrito.length) {
            _toast('El carrito está vacío', 'warning');
            return { success: false, error: 'carrito_vacio' };
        }

        const payload = {
            items: carrito.map(i => ({
                product_id: i.product_id || i.id || null,
                nombre: i.nombre || i.name || 'Producto',
                cantidad: parseFloat(i.cantidad || i.quantity || 1),
                unidad: i.unidad || i.unit || null,
                nota: i.nota || null,
            })),
            sale_id: opts.sale_id || null,
            nota: opts.nota || null,
        };

        let data;
        try {
            const resp = await fetch(`${_api()}/cocina/enviar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token()}`,
                },
                body: JSON.stringify(payload),
            });

            if (resp.status === 403) {
                _toast('El módulo cocina no está activado para este negocio', 'warning');
                return { success: false, error: 'cocina_desactivada' };
            }
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            data = await resp.json();

        } catch (e) {
            console.error('[Cocina] Error enviando comanda:', e);
            _toast('No se pudo enviar a cocina. Reintenta.', 'error');
            return { success: false, error: e.message };
        }

        // La comanda ya existe y cocina ya la recibió por WebSocket.
        _toast(`🍳 Comanda #${data.numero} enviada a cocina`, 'success');

        // Si aún no se ha cobrado, queda a la espera: executeSale() la
        // enlazará con la venta en cuanto se cobre.
        if (!opts.sale_id) _guardarPendiente(data.comanda_id, data.numero);

        const impreso = await imprimir(data.impresion);
        if (!impreso) _mostrarComandaEnPantalla(data);

        return { success: true, numero: data.numero, comanda_id: data.comanda_id, impreso };
    }

    // ============================================
    // IMPRESIÓN
    // ============================================

    /**
     * Manda el ESC/POS al Print Agent local.
     * @returns {Promise<boolean>} true si se imprimió.
     */
    async function imprimir(impresion) {
        if (!impresion || !impresion.escpos_base64) return false;

        // base64 → bytes
        let bytes;
        try {
            const bin = atob(impresion.escpos_base64);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch (e) {
            console.error('[Cocina] ESC/POS inválido:', e);
            return false;
        }

        try {
            const resp = await fetch(impresion.agente_url, {
                method: 'POST',
                body: bytes,
                signal: AbortSignal.timeout(AGENTE_TIMEOUT_MS),
            });
            const r = await resp.json().catch(() => ({}));

            if (resp.ok && r.success !== false) {
                console.log('[Cocina] ✅ Comanda impresa');
                return true;
            }
            console.warn('[Cocina] El agente respondió sin éxito:', r);
            _toast('⚠️ La impresora no aceptó la comanda', 'warning');
            return false;

        } catch (e) {
            // Agente apagado, sin impresora, o timeout.
            console.warn('[Cocina] Print Agent no disponible:', e.name);
            _toast('🖨️ Impresora no disponible — muestra la comanda en pantalla', 'error');
            return false;
        }
    }

    /**
     * Reimprime una comanda ya creada.
     */
    async function reimprimir(comandaId) {
        try {
            const resp = await fetch(`${_api()}/cocina/comanda/${comandaId}/impresion`, {
                headers: { 'Authorization': `Bearer ${_token()}` },
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            const ok = await imprimir(data);
            if (ok) _toast(`🖨️ Comanda #${data.numero} reimpresa`, 'success');
            else _mostrarComandaEnPantalla({ numero: data.numero, impresion: data });
            return ok;
        } catch (e) {
            console.error('[Cocina] Error reimprimiendo:', e);
            _toast('No se pudo reimprimir', 'error');
            return false;
        }
    }

    // ============================================
    // FALLBACK EN PANTALLA
    // ============================================

    /**
     * Si no hay impresora, la comanda se muestra para dictarla o
     * llevarle el celular a cocina. Nunca se pierde el pedido.
     */
    function _mostrarComandaEnPantalla(data) {
        const texto = (data.impresion && data.impresion.texto) || '';
        const numero = data.numero || '?';

        let modal = document.getElementById('comanda-fallback-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'comanda-fallback-modal';
        modal.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:999999;
            display:flex; align-items:center; justify-content:center; padding:16px;
        `;
        modal.innerHTML = `
            <div style="background:#1a1a2e;border-radius:16px;padding:20px;
                        max-width:420px;width:100%;color:#fff;text-align:center">
                <div style="font-size:34px">🍳</div>
                <h3 style="margin:6px 0 2px;color:#f59e0b;font-size:19px">
                    Comanda #${numero} registrada
                </h3>
                <p style="color:#94a3b8;font-size:13px;margin:0 0 14px">
                    Cocina ya la recibió en su pantalla.<br>
                    No se pudo imprimir: muéstrala o díctala.
                </p>
                <pre style="background:#fff;color:#000;border-radius:10px;padding:12px;
                            text-align:left;font-family:'Courier New',monospace;
                            font-size:12px;line-height:1.35;max-height:46vh;
                            overflow:auto;white-space:pre-wrap;margin:0 0 14px"
                >${_escapar(texto)}</pre>
                <div style="display:flex;gap:8px">
                    <button onclick="CocinaEnviar.reimprimir(${data.comanda_id || 0})"
                        style="flex:1;padding:12px;border:none;border-radius:10px;
                               background:rgba(255,255,255,.1);color:#e2e8f0;
                               font-size:14px;cursor:pointer">
                        🖨️ Reintentar
                    </button>
                    <button onclick="document.getElementById('comanda-fallback-modal').remove()"
                        style="flex:1;padding:12px;border:none;border-radius:10px;
                               background:linear-gradient(135deg,#f59e0b,#d97706);
                               color:#fff;font-weight:600;font-size:14px;cursor:pointer">
                        Entendido
                    </button>
                </div>
            </div>
        `;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    }

    function _escapar(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }

    // ============================================
    // BOTÓN
    // ============================================

    /**
     * Muestra el botón "Enviar a cocina" sólo si la tienda tiene el
     * módulo activo. Así una bodega no ve nada nuevo.
     */
    async function initBoton() {
        const btn = document.getElementById('btn-enviar-cocina');
        if (!btn) return;

        try {
            const resp = await fetch(`${_api()}/cocina/ws/estado`, {
                headers: { 'Authorization': `Bearer ${_token()}` },
            });
            if (resp.status === 403) { btn.style.display = 'none'; return; }
            if (!resp.ok) { btn.style.display = 'none'; return; }
            btn.style.display = 'flex';
            btn.onclick = () => enviar();
            console.log('[Cocina] ✅ Botón "Enviar a cocina" activo');
        } catch (e) {
            btn.style.display = 'none';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initBoton, 800));
    } else {
        setTimeout(initBoton, 800);
    }

    return {
        enviar, imprimir, reimprimir, initBoton,
        enlazarVenta,
        hayPendiente: () => _leerPendiente(),
        limpiarPendiente: _limpiarPendiente,
    };
})();

window.CocinaEnviar = CocinaEnviar;
console.log('[CocinaEnviar] 🍳 Módulo cargado');
