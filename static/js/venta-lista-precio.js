/**
 * QueVendi — Cliente y lista de precio en la pantalla de venta
 * =============================================================
 * Un chip sobre el carrito muestra a quién se le está cobrando y con
 * qué lista. Al tocarlo se elige cliente (y con él viene su lista) o se
 * cambia la lista a mano para esta venta.
 *
 * Comportamiento híbrido:
 *   · cliente con lista propia  → se aplica la suya
 *   · cliente sin lista         → la lista por defecto de la tienda
 *   · sin cliente               → la lista por defecto, o precio normal
 *
 * Al cambiar de lista se recalculan los precios del carrito con
 * /pricing/detectar, que ya combina el eje cliente con el de cantidad.
 *
 * Todo esto sólo aparece si la tienda activó el multiprecio. En una
 * bodega la pantalla de venta queda exactamente igual que antes.
 */

const VentaListaPrecio = (() => {

    const estado = {
        activo: false,
        listas: [],
        porDefecto: null,
        clientes: [],
        clienteSel: null,   // {id, name, tier_id}
        tierSel: null,      // tier_id aplicado ahora
        recalculando: false,
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
        console.log('[Lista] ' + msg);
    }

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    async function _get(url) {
        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${_token()}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }

    // ============================================
    // ARRANQUE
    // ============================================

    async function init() {
        try {
            const s = await _get(`${_api()}/pricing/estado`);
            if (!s.enabled) return;                 // bodega: nada cambia
            estado.activo = true;
            estado.listas = (s.listas || []).filter(l => l.is_active);
            estado.porDefecto = s.default || null;
            estado.tierSel = estado.porDefecto ? estado.porDefecto.id : null;
        } catch (e) {
            return;
        }

        _montarChip();
        _pintarChip();
        console.log(`[Lista] Multiprecio activo — ${estado.listas.length} listas`);
    }

    function _nombreTier(id) {
        const l = estado.listas.find(x => x.id === id);
        return l ? l.nombre : 'Precio normal';
    }

    function _colorTier(id) {
        const l = estado.listas.find(x => x.id === id);
        return l ? (l.color || '#3b82f6') : '#64748b';
    }

    // ============================================
    // CHIP
    // ============================================

    function _montarChip() {
        if (document.getElementById('chip-lista-precio')) return;

        // Encima de la fila de cobro, donde el cajero ya mira.
        const fila = document.querySelector('.checkout-row');
        if (!fila || !fila.parentElement) return;

        const chip = document.createElement('button');
        chip.id = 'chip-lista-precio';
        chip.type = 'button';
        chip.onclick = abrirSelector;
        chip.style.cssText = `
            width:100%;margin-bottom:8px;padding:9px 12px;border-radius:10px;
            border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
            color:#e2e8f0;font-family:inherit;font-size:12.5px;font-weight:600;
            cursor:pointer;display:flex;align-items:center;gap:8px;text-align:left;
        `;
        fila.parentElement.insertBefore(chip, fila);
    }

    function _pintarChip() {
        const chip = document.getElementById('chip-lista-precio');
        if (!chip) return;

        const quien = estado.clienteSel
            ? _esc(estado.clienteSel.name)
            : 'Cliente ocasional';
        const lista = _nombreTier(estado.tierSel);
        const color = _colorTier(estado.tierSel);

        chip.innerHTML = `
            <i class="fas fa-user-tag" style="color:${color}"></i>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
                         white-space:nowrap">${quien}</span>
            <span style="background:${color}22;color:${color};padding:3px 9px;
                         border-radius:20px;font-size:11px;font-weight:700;
                         white-space:nowrap">${_esc(lista)}</span>
            <i class="fas fa-chevron-down" style="color:#64748b;font-size:11px"></i>`;
    }

    // ============================================
    // SELECTOR
    // ============================================

    async function abrirSelector() {
        let m = document.getElementById('modal-lista-precio');
        if (m) m.remove();

        m = document.createElement('div');
        m.id = 'modal-lista-precio';
        m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999999;
            display:flex;align-items:center;justify-content:center;padding:16px`;
        m.innerHTML = `
            <div style="background:#1a1a2e;border-radius:16px;padding:18px;max-width:400px;
                        width:100%;max-height:86vh;display:flex;flex-direction:column;color:#fff">
                <div style="display:flex;align-items:center;margin-bottom:12px">
                    <h3 style="margin:0;font-size:16px">¿A quién le cobras?</h3>
                    <button onclick="document.getElementById('modal-lista-precio').remove()"
                        style="margin-left:auto;background:none;border:none;color:#94a3b8;
                               font-size:24px;cursor:pointer;line-height:1">×</button>
                </div>

                <input type="text" id="lp-buscar-cliente" placeholder="Buscar cliente por nombre..."
                    autocomplete="off"
                    style="width:100%;padding:11px;margin-bottom:8px;border-radius:9px;
                           border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);
                           color:#fff;font-size:14px;font-family:inherit">

                <div id="lp-clientes" style="flex:1;overflow-y:auto;min-height:60px;
                     margin-bottom:10px"></div>

                <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:10px">
                    <div style="font-size:11.5px;color:#94a3b8;margin-bottom:7px;font-weight:600">
                        LISTA DE PRECIO PARA ESTA VENTA
                    </div>
                    <div id="lp-listas" style="display:flex;flex-wrap:wrap;gap:6px"></div>
                </div>
            </div>`;
        m.addEventListener('click', e => { if (e.target === m) m.remove(); });
        document.body.appendChild(m);

        _pintarListasEnModal();

        const inp = document.getElementById('lp-buscar-cliente');
        inp.oninput = () => _pintarClientes(inp.value);
        setTimeout(() => inp.focus(), 80);

        if (!estado.clientes.length) {
            try {
                estado.clientes = await _get(`${_api()}/customers/customers?limit=200`);
            } catch (e) {
                estado.clientes = [];
            }
        }
        _pintarClientes('');
    }

    function _pintarClientes(filtro) {
        const cont = document.getElementById('lp-clientes');
        if (!cont) return;

        const f = (filtro || '').toLowerCase().trim();
        const lista = f
            ? estado.clientes.filter(c => (c.name || '').toLowerCase().includes(f))
            : estado.clientes.slice(0, 25);

        const ocasional = `
            <div data-cliente="0" style="display:flex;align-items:center;gap:10px;padding:11px;
                 border-radius:9px;cursor:pointer;margin-bottom:5px;
                 background:${estado.clienteSel ? 'rgba(255,255,255,.05)' : 'rgba(59,130,246,.18)'}">
                <i class="fas fa-user" style="color:#94a3b8"></i>
                <div style="flex:1">
                    <div style="font-size:13.5px;font-weight:600">Cliente ocasional</div>
                    <div style="font-size:11px;color:#94a3b8">
                        ${estado.porDefecto ? _esc(estado.porDefecto.nombre) : 'Precio normal'}
                    </div>
                </div>
                ${estado.clienteSel ? '' : '<i class="fas fa-check" style="color:#10b981"></i>'}
            </div>`;

        const filas = lista.map(c => {
            const sel = estado.clienteSel && estado.clienteSel.id === c.id;
            const tier = estado.listas.find(l => l.id === c.tier_id);
            return `
            <div data-cliente="${c.id}" style="display:flex;align-items:center;gap:10px;
                 padding:11px;border-radius:9px;cursor:pointer;margin-bottom:5px;
                 background:${sel ? 'rgba(59,130,246,.18)' : 'rgba(255,255,255,.04)'}">
                <i class="fas fa-user-tag" style="color:${tier ? (tier.color || '#3b82f6') : '#64748b'}"></i>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13.5px;font-weight:600;overflow:hidden;
                                text-overflow:ellipsis;white-space:nowrap">${_esc(c.name)}</div>
                    <div style="font-size:11px;color:#94a3b8">
                        ${tier ? _esc(tier.nombre) : 'sin lista propia'}
                        ${c.phone ? ' · ' + _esc(c.phone) : ''}
                    </div>
                </div>
                ${sel ? '<i class="fas fa-check" style="color:#10b981"></i>' : ''}
            </div>`;
        }).join('');

        cont.innerHTML = ocasional + (filas || (f
            ? `<div style="color:#94a3b8;font-size:12.5px;padding:12px;text-align:center">
                 Ningún cliente con ese nombre</div>`
            : ''));

        cont.querySelectorAll('[data-cliente]').forEach(el => {
            el.onclick = () => _elegirCliente(parseInt(el.dataset.cliente, 10));
        });
    }

    function _pintarListasEnModal() {
        const cont = document.getElementById('lp-listas');
        if (!cont) return;

        const opciones = [{ id: null, nombre: 'Precio normal', color: '#64748b' }]
            .concat(estado.listas);

        cont.innerHTML = opciones.map(l => {
            const sel = estado.tierSel === l.id;
            const color = l.color || '#3b82f6';
            return `
            <button data-tier="${l.id === null ? '' : l.id}" type="button"
                style="padding:8px 13px;border-radius:20px;cursor:pointer;font-family:inherit;
                       font-size:12.5px;font-weight:700;
                       border:1px solid ${sel ? color : 'rgba(255,255,255,.14)'};
                       background:${sel ? color + '28' : 'rgba(255,255,255,.05)'};
                       color:${sel ? color : '#cbd5e1'}">
                ${_esc(l.nombre)}
            </button>`;
        }).join('');

        cont.querySelectorAll('[data-tier]').forEach(b => {
            b.onclick = () => {
                const v = b.dataset.tier;
                _elegirLista(v === '' ? null : parseInt(v, 10));
            };
        });
    }

    // ============================================
    // SELECCIÓN
    // ============================================

    function _elegirCliente(id) {
        if (!id) {
            estado.clienteSel = null;
            estado.tierSel = estado.porDefecto ? estado.porDefecto.id : null;
        } else {
            const c = estado.clientes.find(x => x.id === id);
            if (!c) return;
            estado.clienteSel = c;
            // Su lista manda; si no tiene, la de la tienda.
            estado.tierSel = c.tier_id || (estado.porDefecto ? estado.porDefecto.id : null);
        }
        _pintarChip();
        _pintarClientes(document.getElementById('lp-buscar-cliente')?.value || '');
        _pintarListasEnModal();
        recalcularCarrito();
    }

    function _elegirLista(tierId) {
        estado.tierSel = tierId;
        _pintarChip();
        _pintarListasEnModal();
        recalcularCarrito();
        const m = document.getElementById('modal-lista-precio');
        if (m) m.remove();
    }

    // ============================================
    // RECÁLCULO
    // ============================================

    /**
     * Repasa el carrito con la lista activa.
     *
     * Se pregunta a /pricing/detectar producto por producto porque el
     * precio depende también de la cantidad que lleva de cada uno, y esa
     * combinación la resuelve el backend.
     */
    async function recalcularCarrito() {
        if (!estado.activo) return;
        if (typeof AppState === 'undefined' || !AppState.cart || !AppState.cart.length) return;
        if (estado.recalculando) return;

        estado.recalculando = true;
        let cambiados = 0;

        try {
            for (const item of AppState.cart) {
                const url = `${_api()}/pricing/detectar?product_id=${item.id}`
                          + `&cantidad=${item.quantity}`
                          + (estado.tierSel ? `&tier_id=${estado.tierSel}` : '');
                try {
                    const d = await _get(url);
                    // Al volver a "Precio normal" hay que RESTAURAR el precio,
                    // no dejar la rebaja de la lista anterior. Por eso se usa
                    // precio_normal cuando no aplica ningún descuento.
                    const nuevo = d.aplica_especial
                        ? d.precio_especial
                        : (d.precio_normal != null ? d.precio_normal : null);
                    if (nuevo == null) continue;
                    if (nuevo && Math.abs(nuevo - item.price) > 0.001) {
                        item.price = parseFloat(nuevo);
                        cambiados++;
                    }
                } catch (e) { /* ese producto se queda como está */ }
            }

            if (cambiados) {
                if (typeof saveCart === 'function') saveCart();
                if (typeof renderCart === 'function') renderCart();
                _toast(`Precios actualizados (${cambiados})`, 'info');
            }
        } finally {
            estado.recalculando = false;
        }
    }

    // ============================================
    // API PARA LA VENTA
    // ============================================

    /** Lo que executeSale() añade al cuerpo de la venta. */
    function datosVenta() {
        if (!estado.activo) return {};
        return {
            customer_id: estado.clienteSel ? estado.clienteSel.id : null,
            tier_id: estado.tierSel || null,
        };
    }

    /** Tras cobrar: vuelve a cliente ocasional para la siguiente venta. */
    function reiniciar() {
        if (!estado.activo) return;
        estado.clienteSel = null;
        estado.tierSel = estado.porDefecto ? estado.porDefecto.id : null;
        _pintarChip();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1100));
    } else {
        setTimeout(init, 1100);
    }

    return { init, abrirSelector, recalcularCarrito, datosVenta, reiniciar,
             get clienteSel() { return estado.clienteSel; },
             get tierSel() { return estado.tierSel; } };
})();

window.VentaListaPrecio = VentaListaPrecio;
