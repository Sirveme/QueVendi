/**
 * QueVendi — Listas de precio por tipo de cliente (configuración)
 * ===============================================================
 * Gestiona el eje 'cliente' de precios: crear listas ("Mayorista",
 * "Restaurante"), elegir cómo calculan (un % sobre el base, o precio a
 * precio), cargar los precios en masa y marcar cuál se aplica por
 * defecto.
 *
 * El eje 'volumen' (a partir de N unidades) se muestra sólo como
 * referencia: se sigue gestionando donde estaba y no se toca desde
 * aquí, para no romper a quien ya lo usa.
 *
 * Toda la sección se oculta si la tienda no tiene el multiprecio
 * activado, salvo el interruptor para activarlo.
 */

const ConfigListasPrecio = (() => {

    const estado = {
        enabled: false,
        acumulan: false,
        listas: [],
        volumen: [],
        editando: null,      // tier_id en edición, null = alta nueva
        listaAbierta: null,  // tier_id cuya carga masiva está abierta
        productos: [],
        filtro: '',
    };

    function _api() {
        return `${window.location.origin}/api/v1`;
    }

    function _token() {
        return localStorage.getItem('access_token');
    }

    async function _fetch(path, opts = {}) {
        const resp = await fetch(`${_api()}/pricing${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_token()}`,
                ...(opts.headers || {}),
            },
        });
        if (!resp.ok) {
            let detalle = `HTTP ${resp.status}`;
            try {
                const j = await resp.json();
                detalle = j.detail || detalle;
            } catch (e) { /* sin cuerpo */ }
            const err = new Error(detalle);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    }

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    function _aviso(msg, tipo) {
        if (typeof showToast === 'function') return showToast(msg, tipo);
        alert(msg);
    }

    function _money(n) {
        return 'S/ ' + (Number(n) || 0).toFixed(2);
    }

    // ============================================
    // CARGA
    // ============================================

    async function cargar() {
        const card = document.getElementById('card-listas-precio');
        if (!card) return;

        try {
            const s = await _fetch('/estado');
            estado.enabled = s.enabled;
            estado.acumulan = s.acumulan;
            estado.listas = s.listas || [];
            estado.volumen = s.tiers_volumen || [];
            card.style.display = 'block';
            _pintar();
        } catch (e) {
            // 403 = no es dueño. La sección no se muestra.
            card.style.display = 'none';
        }
    }

    // ============================================
    // RENDER
    // ============================================

    function _pintar() {
        const cont = document.getElementById('listas-precio-body');
        if (!cont) return;

        cont.innerHTML = `
            ${_pintarInterruptores()}
            ${estado.enabled ? _pintarListas() : _pintarApagado()}
            ${estado.volumen.length ? _pintarVolumen() : ''}
        `;
        _conectarEventos();
    }

    function _pintarInterruptores() {
        return `
            <label style="display:flex;align-items:center;gap:9px;padding:8px 0;
                          font-size:0.75rem;cursor:pointer;font-weight:600">
                <input type="checkbox" id="chk-multiprecio" ${estado.enabled ? 'checked' : ''}
                    style="width:auto">
                Cobrar precios distintos según el tipo de cliente
            </label>
            ${estado.enabled ? `
            <label style="display:flex;align-items:center;gap:9px;padding:4px 0 10px 22px;
                          font-size:0.7rem;cursor:pointer;color:var(--text3)">
                <input type="checkbox" id="chk-acumulan" ${estado.acumulan ? 'checked' : ''}
                    style="width:auto">
                Acumular con el descuento por cantidad
                <span title="Apagado: se aplica el precio más bajo de los dos.
Encendido: primero el de la lista y sobre ese el de cantidad."
                      style="cursor:help">ⓘ</span>
            </label>` : ''}
        `;
    }

    function _pintarApagado() {
        return `
            <div style="font-size:0.68rem;color:var(--text3);line-height:1.55;
                        padding:10px;background:var(--bg2);border-radius:8px">
                Actívalo para cobrarle distinto a un mayorista, a un restaurante o a
                una institución. Puedes definir un <b>descuento en %</b> sobre tus
                precios, o cargar <b>precio por precio</b>.
                <br><br>
                Tus precios por cantidad (a partir de N unidades) siguen funcionando igual.
            </div>`;
    }

    function _pintarListas() {
        const filas = estado.listas.map(l => {
            const detalle = l.modo === 'descuento_pct'
                ? `−${Number(l.descuento_pct).toFixed(0)}% sobre el precio normal`
                : `${l.n_precios} producto${l.n_precios === 1 ? '' : 's'} con precio propio`;

            return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px;
                        background:var(--bg2);border:1px solid var(--border);
                        border-radius:8px;margin-bottom:6px;${l.is_active ? '' : 'opacity:.5'}">
                <span style="width:10px;height:10px;border-radius:50%;
                             background:${_esc(l.color || '#3b82f6')};flex-shrink:0"></span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:0.76rem;font-weight:700">
                        ${_esc(l.nombre)}
                        ${l.es_default ? '<span style="font-size:0.6rem;color:var(--orange);font-weight:600"> · POR DEFECTO</span>' : ''}
                        ${l.is_active ? '' : '<span style="font-size:0.6rem;color:var(--text3)"> · inactiva</span>'}
                    </div>
                    <div style="font-size:0.64rem;color:var(--text3)">${_esc(detalle)}</div>
                </div>
                ${l.modo === 'manual' ? `
                    <button data-precios="${l.id}" class="device-btn"
                        style="padding:6px 10px;font-size:0.66rem">
                        <i class="fas fa-table-list"></i> Precios
                    </button>` : ''}
                ${l.es_default ? '' : `
                    <button data-default="${l.id}" class="device-btn"
                        style="padding:6px 9px;font-size:0.66rem" title="Usar por defecto">
                        <i class="fas fa-star"></i>
                    </button>`}
                <button data-editar="${l.id}" class="device-btn"
                    style="padding:6px 9px;font-size:0.66rem" title="Editar">
                    <i class="fas fa-pen"></i>
                </button>
                <button data-borrar="${l.id}" class="device-btn device-btn-danger"
                    style="padding:6px 9px;font-size:0.66rem" title="Borrar">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
        }).join('');

        return `
            <div id="listas-precio-items" style="margin-top:8px">
                ${filas || `<div style="color:var(--text3);font-size:0.7rem;padding:10px">
                    Todavía no hay listas. Crea la primera abajo.</div>`}
            </div>
            <div class="register-box" style="margin-top:10px">
                <div style="font-size:0.72rem;font-weight:700;margin-bottom:8px;color:var(--text2)">
                    <span id="titulo-form-lista">Nueva lista</span>
                </div>
                <input type="text" id="lp-nombre" placeholder="Nombre (ej: Mayorista)" maxlength="50"
                    style="width:100%;padding:8px 10px;margin-bottom:6px;background:var(--bg2);
                           border:1px solid var(--border);border-radius:6px;color:var(--text);
                           font-size:0.75rem;font-family:var(--font)">
                <div style="display:flex;gap:6px;margin-bottom:6px">
                    <select id="lp-modo"
                        style="flex:1;padding:8px;background:var(--bg2);border:1px solid var(--border);
                               border-radius:6px;color:var(--text);font-size:0.72rem;font-family:var(--font)">
                        <option value="descuento_pct">Descuento en % sobre mis precios</option>
                        <option value="manual">Precio propio por producto</option>
                    </select>
                    <input type="number" id="lp-pct" placeholder="%" min="1" max="99" step="1"
                        style="width:78px;padding:8px;background:var(--bg2);border:1px solid var(--border);
                               border-radius:6px;color:var(--text);font-size:0.75rem;
                               font-family:var(--font);text-align:center">
                </div>
                <label style="display:flex;align-items:center;gap:7px;font-size:0.68rem;
                              color:var(--text3);margin-bottom:8px;cursor:pointer">
                    <input type="checkbox" id="lp-default" style="width:auto">
                    Aplicar a los clientes sin lista asignada
                </label>
                <div style="display:flex;gap:6px">
                    <button id="btn-guardar-lista" class="device-btn" style="flex:1;font-size:0.72rem">
                        <i class="fas fa-plus"></i> Crear lista
                    </button>
                    <button id="btn-cancelar-lista" class="device-btn"
                        style="display:none;padding:8px 12px;font-size:0.72rem">Cancelar</button>
                </div>
            </div>`;
    }

    function _pintarVolumen() {
        const filas = estado.volumen.map(t =>
            `<li style="margin-bottom:2px">${_esc(t.nombre)}${t.descripcion
                ? ` — <span style="color:var(--text3)">${_esc(t.descripcion)}</span>` : ''}</li>`
        ).join('');
        return `
            <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
                <div style="font-size:0.68rem;font-weight:700;color:var(--text2);margin-bottom:5px">
                    Precios por cantidad (ya configurados)
                </div>
                <ul style="font-size:0.66rem;color:var(--text2);padding-left:16px;margin:0">
                    ${filas}
                </ul>
                <div style="font-size:0.62rem;color:var(--text3);margin-top:6px">
                    Se siguen aplicando igual. Si un cliente tiene lista propia, se le
                    cobra ${estado.acumulan ? 'el de la lista y encima el de cantidad'
                                             : 'el más bajo de los dos'}.
                </div>
            </div>`;
    }

    // ============================================
    // EVENTOS
    // ============================================

    function _conectarEventos() {
        const chk = document.getElementById('chk-multiprecio');
        if (chk) chk.onchange = () => _guardarFlag('multiprecio_cliente_enabled', chk.checked);

        const acc = document.getElementById('chk-acumulan');
        if (acc) acc.onchange = () => _guardarFlag('descuentos_acumulan', acc.checked);

        const modo = document.getElementById('lp-modo');
        const pct = document.getElementById('lp-pct');
        if (modo && pct) {
            const sync = () => { pct.style.display = modo.value === 'descuento_pct' ? '' : 'none'; };
            modo.onchange = sync;
            sync();
        }

        const guardar = document.getElementById('btn-guardar-lista');
        if (guardar) guardar.onclick = _guardarLista;

        const cancelar = document.getElementById('btn-cancelar-lista');
        if (cancelar) cancelar.onclick = _cancelarEdicion;

        document.querySelectorAll('[data-editar]').forEach(b => {
            b.onclick = () => _editar(parseInt(b.dataset.editar, 10));
        });
        document.querySelectorAll('[data-borrar]').forEach(b => {
            b.onclick = () => _borrar(parseInt(b.dataset.borrar, 10));
        });
        document.querySelectorAll('[data-default]').forEach(b => {
            b.onclick = () => _marcarDefault(parseInt(b.dataset.default, 10));
        });
        document.querySelectorAll('[data-precios]').forEach(b => {
            b.onclick = () => abrirCargaMasiva(parseInt(b.dataset.precios, 10));
        });
    }

    /**
     * Los flags viven en store_config, que se guarda entero. Se lee lo
     * que ya hay y se reenvía con el campo cambiado, para no pisar el
     * resto de la configuración del negocio.
     */
    async function _guardarFlag(campo, valor) {
        try {
            const actual = await fetch(`${_api()}/store/config`, {
                headers: { 'Authorization': `Bearer ${_token()}` },
            }).then(r => r.json());

            const cfg = (actual && actual.config) ? { ...actual.config } : {};
            cfg[campo] = valor;
            delete cfg.facturalo_token;    // vienen enmascarados: no reenviarlos
            delete cfg.facturalo_secret;

            const resp = await fetch(`${_api()}/store/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token()}`,
                },
                body: JSON.stringify(cfg),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            _aviso(valor ? 'Activado' : 'Desactivado', 'success');
            await cargar();
        } catch (e) {
            console.error('[Listas] Error guardando flag:', e);
            _aviso('No se pudo guardar', 'error');
            await cargar();
        }
    }

    async function _guardarLista() {
        const nombre = (document.getElementById('lp-nombre').value || '').trim();
        const modo = document.getElementById('lp-modo').value;
        const pct = parseFloat(document.getElementById('lp-pct').value);
        const def = document.getElementById('lp-default').checked;

        if (!nombre) return _aviso('Ponle un nombre a la lista', 'warning');
        if (modo === 'descuento_pct' && (!pct || pct <= 0 || pct >= 100)) {
            return _aviso('El descuento debe estar entre 1 y 99', 'warning');
        }

        const cuerpo = {
            nombre, modo, es_default: def,
            descuento_pct: modo === 'descuento_pct' ? pct : null,
        };

        try {
            if (estado.editando) {
                await _fetch(`/listas/${estado.editando}`, {
                    method: 'PUT', body: JSON.stringify(cuerpo),
                });
                _aviso('Lista actualizada', 'success');
            } else {
                await _fetch('/listas', { method: 'POST', body: JSON.stringify(cuerpo) });
                _aviso('Lista creada', 'success');
            }
            _cancelarEdicion();
            await cargar();
        } catch (e) {
            _aviso(e.message || 'No se pudo guardar', 'error');
        }
    }

    function _editar(id) {
        const l = estado.listas.find(x => x.id === id);
        if (!l) return;
        estado.editando = id;

        document.getElementById('lp-nombre').value = l.nombre || '';
        document.getElementById('lp-modo').value = l.modo || 'manual';
        document.getElementById('lp-pct').value = l.descuento_pct || '';
        document.getElementById('lp-default').checked = !!l.es_default;
        document.getElementById('titulo-form-lista').textContent = `Editar «${l.nombre}»`;
        document.getElementById('btn-guardar-lista').innerHTML =
            '<i class="fas fa-save"></i> Guardar cambios';
        document.getElementById('btn-cancelar-lista').style.display = '';

        const modo = document.getElementById('lp-modo');
        document.getElementById('lp-pct').style.display =
            modo.value === 'descuento_pct' ? '' : 'none';
        document.getElementById('lp-nombre').focus();
    }

    function _cancelarEdicion() {
        estado.editando = null;
        const n = document.getElementById('lp-nombre');
        if (n) n.value = '';
        const p = document.getElementById('lp-pct');
        if (p) p.value = '';
        const d = document.getElementById('lp-default');
        if (d) d.checked = false;
        const t = document.getElementById('titulo-form-lista');
        if (t) t.textContent = 'Nueva lista';
        const g = document.getElementById('btn-guardar-lista');
        if (g) g.innerHTML = '<i class="fas fa-plus"></i> Crear lista';
        const c = document.getElementById('btn-cancelar-lista');
        if (c) c.style.display = 'none';
    }

    async function _borrar(id) {
        const l = estado.listas.find(x => x.id === id);
        if (!confirm(`¿Borrar la lista «${l ? l.nombre : ''}»?\n\n` +
                     `Los clientes que la tengan asignada volverán al precio normal.`)) return;
        try {
            await _fetch(`/listas/${id}`, { method: 'DELETE' });
            _aviso('Lista borrada', 'success');
            await cargar();
        } catch (e) {
            _aviso(e.message || 'No se pudo borrar', 'error');
        }
    }

    async function _marcarDefault(id) {
        try {
            await _fetch(`/listas/${id}`, {
                method: 'PUT', body: JSON.stringify({ es_default: true }),
            });
            _aviso('Lista por defecto actualizada', 'success');
            await cargar();
        } catch (e) {
            _aviso(e.message || 'No se pudo actualizar', 'error');
        }
    }

    // ============================================
    // CARGA MASIVA DE PRECIOS
    // ============================================

    /**
     * Tabla de todos los productos con su precio en esta lista. Los que
     * no tienen precio cargado salen primero y marcados: son los que el
     * dueño todavía debe completar (mientras tanto se les cobra el base).
     */
    async function abrirCargaMasiva(tierId) {
        const l = estado.listas.find(x => x.id === tierId);
        if (!l) return;

        estado.listaAbierta = tierId;
        estado.filtro = '';

        let modal = document.getElementById('modal-precios-lista');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'modal-precios-lista';
        modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);
            z-index:999999;display:flex;align-items:center;justify-content:center;padding:14px`;
        modal.innerHTML = `
            <div style="background:var(--bg,#12121f);border-radius:14px;padding:16px;
                        max-width:560px;width:100%;max-height:88vh;display:flex;
                        flex-direction:column;color:var(--text,#fff)">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span style="width:10px;height:10px;border-radius:50%;
                                 background:${_esc(l.color || '#3b82f6')}"></span>
                    <b style="font-size:0.9rem">${_esc(l.nombre)}</b>
                    <span id="precios-pendientes" style="font-size:0.66rem;color:var(--text3)"></span>
                    <button onclick="document.getElementById('modal-precios-lista').remove()"
                        style="margin-left:auto;background:none;border:none;color:var(--text3);
                               font-size:22px;cursor:pointer;line-height:1">×</button>
                </div>
                <input type="text" id="precios-filtro" placeholder="Buscar producto..."
                    style="width:100%;padding:9px 11px;margin-bottom:8px;background:var(--bg2,#1c1c2e);
                           border:1px solid var(--border,#333);border-radius:7px;
                           color:var(--text,#fff);font-size:0.78rem;font-family:inherit">
                <div id="precios-tabla" style="flex:1;overflow-y:auto;min-height:0">
                    <div style="color:var(--text3);font-size:0.72rem;padding:14px">Cargando...</div>
                </div>
                <div style="font-size:0.62rem;color:var(--text3);margin-top:8px;line-height:1.45">
                    Deja el campo vacío para quitar el precio: a ese producto se le cobrará
                    el precio normal.
                </div>
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);

        document.getElementById('precios-filtro').oninput = (e) => {
            estado.filtro = (e.target.value || '').toLowerCase();
            _pintarTablaPrecios();
        };

        try {
            const data = await _fetch(`/listas/${tierId}/precios`);
            estado.productos = data.productos || [];
            document.getElementById('precios-pendientes').textContent =
                data.sin_precio ? `· ${data.sin_precio} sin precio propio` : '· todos con precio';
            _pintarTablaPrecios();
        } catch (e) {
            document.getElementById('precios-tabla').innerHTML =
                `<div style="color:#f87171;font-size:0.72rem;padding:14px">
                    No se pudieron cargar los productos</div>`;
        }
    }

    function _pintarTablaPrecios() {
        const cont = document.getElementById('precios-tabla');
        if (!cont) return;

        const lista = estado.filtro
            ? estado.productos.filter(p => p.nombre.toLowerCase().includes(estado.filtro))
            : estado.productos;

        if (!lista.length) {
            cont.innerHTML = `<div style="color:var(--text3);font-size:0.72rem;padding:14px">
                Ningún producto coincide.</div>`;
            return;
        }

        cont.innerHTML = lista.map(p => `
            <div style="display:flex;align-items:center;gap:9px;padding:7px 4px;
                        border-bottom:1px solid var(--border,#2a2a3e)">
                <div style="flex:1;min-width:0">
                    <div style="font-size:0.74rem;font-weight:600;white-space:nowrap;
                                overflow:hidden;text-overflow:ellipsis">${_esc(p.nombre)}</div>
                    <div style="font-size:0.62rem;color:var(--text3)">
                        normal ${_money(p.precio_base)}
                        ${p.sin_precio ? ' · <span style="color:#f59e0b">sin precio propio</span>' : ''}
                    </div>
                </div>
                <input type="number" step="0.10" min="0" inputmode="decimal"
                    data-prod="${p.product_id}" value="${p.precio != null ? p.precio : ''}"
                    placeholder="${Number(p.precio_base).toFixed(2)}"
                    style="width:88px;padding:7px;background:var(--bg2,#1c1c2e);
                           border:1px solid ${p.sin_precio ? 'rgba(245,158,11,.4)' : 'var(--border,#333)'};
                           border-radius:6px;color:var(--text,#fff);font-size:0.76rem;
                           text-align:right;font-family:inherit">
            </div>`).join('');

        cont.querySelectorAll('input[data-prod]').forEach(inp => {
            inp.onblur = () => _guardarPrecio(inp);
            inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
        });
    }

    async function _guardarPrecio(inp) {
        const productId = parseInt(inp.dataset.prod, 10);
        const bruto = (inp.value || '').trim();
        const prod = estado.productos.find(p => p.product_id === productId);
        const anterior = prod ? prod.precio : null;

        const valor = bruto === '' ? null : parseFloat(bruto);
        if (valor === anterior) return;                 // sin cambios
        if (valor !== null && (isNaN(valor) || valor <= 0)) {
            inp.value = anterior != null ? anterior : '';
            return _aviso('El precio debe ser mayor a 0', 'warning');
        }

        try {
            await _fetch(`/listas/${estado.listaAbierta}/precios`, {
                method: 'PUT',
                body: JSON.stringify({ product_id: productId, precio: valor }),
            });
            if (prod) {
                prod.precio = valor;
                prod.sin_precio = valor === null;
            }
            inp.style.borderColor = valor === null
                ? 'rgba(245,158,11,.4)' : 'rgba(16,185,129,.55)';
            setTimeout(() => { inp.style.borderColor = 'var(--border,#333)'; }, 900);
        } catch (e) {
            inp.value = anterior != null ? anterior : '';
            _aviso(e.message || 'No se pudo guardar el precio', 'error');
        }
    }

    // Exponer lo que usan los onclick del HTML
    window.ConfigListasPrecio = { cargar, abrirCargaMasiva };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(cargar, 1000));
    } else {
        setTimeout(cargar, 1000);
    }

    return { cargar, abrirCargaMasiva };
})();
