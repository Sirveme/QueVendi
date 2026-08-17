/**
 * QueVendi — Cobro con varios métodos de pago
 * ============================================
 * En un restaurante la mesa paga a medias todo el tiempo: S/40 por
 * Yape, S/20 en efectivo y S/12 con tarjeta. Antes había que elegir UN
 * método y el arqueo salía mal.
 *
 * Este modal deja registrar tantos pagos como haga falta hasta cubrir
 * el total. El botón de confirmar sólo se habilita cuando el saldo
 * llega a cero.
 *
 * El desglose es interno: la boleta SUNAT sale por el total, como
 * siempre.
 */

const CajaMultipago = (() => {

    const METODOS = [
        { id: 'efectivo',      nombre: 'Efectivo',      icono: '💵' },
        { id: 'yape',          nombre: 'Yape',          icono: '💜' },
        { id: 'plin',          nombre: 'Plin',          icono: '💙' },
        { id: 'tarjeta',       nombre: 'Tarjeta',       icono: '💳' },
        { id: 'transferencia', nombre: 'Transferencia', icono: '🏦' },
    ];

    const estado = {
        saleId: null,
        total: 0,
        pagos: [],
        metodoActivo: null,
        alTerminar: null,
        cerradaOk: false,
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

    const _fmt = (n) => `S/ ${(Number(n) || 0).toFixed(2)}`;

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    function _toast(msg, tipo) {
        if (typeof showToast === 'function') return showToast(msg, tipo);
        console.log(`[Multipago] ${msg}`);
    }

    const pagado = () => estado.pagos.reduce((s, p) => s + Number(p.monto), 0);
    const saldo = () => Math.max(0, +(estado.total - pagado()).toFixed(2));

    // ============================================
    // ENTRADA DESDE LA CAJA
    // ============================================

    /**
     * Cobra el carrito repartido entre varios métodos.
     *
     * Es la alternativa al botón COBRAR, que queda intacto. La diferencia
     * es el orden: aquí la venta se crea PRIMERO (hace falta un sale_id
     * para colgarle los pagos) y luego se reparte el importe. En el flujo
     * normal se elige el método antes.
     */
    async function cobrarMultiple() {
        const cart = (typeof AppState !== 'undefined' ? AppState.cart : []) || [];
        if (!cart.length) return _toast('El carrito está vacío', 'warning');

        // Mismas guardas que executeSale()
        if (typeof AppState !== 'undefined'
            && AppState.cajaAperturaRequerida && !AppState.cajaActiva) {
            return _toast('Debes abrir la caja antes de vender. Ve a Caja desde el menú.', 'error');
        }
        if (typeof AppState !== 'undefined' && AppState.paymentMethod === 'fiado') {
            return _toast('El fiado se cobra con el botón COBRAR, no por partes', 'warning');
        }

        const total = (typeof getCartTotal === 'function')
            ? getCartTotal()
            : cart.reduce((s, i) => s + i.price * i.quantity, 0);

        const loader = (typeof showLoader === 'function')
            ? showLoader('Preparando el cobro...') : null;

        let venta;
        try {
            const resp = await fetch(`${_api()}/sales`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token()}`,
                },
                body: JSON.stringify({
                    items: cart.map(i => ({
                        product_id: i.id,
                        quantity: parseFloat(i.quantity),
                        unit_price: parseFloat(i.price),
                        subtotal: parseFloat(i.price) * parseFloat(i.quantity),
                    })),
                    // El detalle real queda en sale_pagos; esto es el resumen.
                    payment_method: 'multiple',
                    payment_reference: null,
                    customer_name: null,
                    is_credit: false,
                }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            venta = await resp.json();
        } catch (e) {
            console.error('[Multipago] No se pudo crear la venta:', e);
            _toast('No se pudo iniciar el cobro', 'error');
            return;
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }

        // Guardado para cerrar la venta cuando se cubra el total
        const snapshot = cart.slice();

        abrir(venta.id, total, () => _cerrarVenta(venta, total, snapshot));
    }

    /**
     * Cobro cubierto: se limpia el carrito y se muestra el ticket, igual
     * que hace executeSale() al terminar.
     */
    function _cerrarVenta(venta, total, snapshot) {
        try {
            if (typeof CocinaEnviar !== 'undefined' && venta.id) {
                CocinaEnviar.enlazarVenta(venta.id).catch(() => {});
            }

            if (typeof AppState !== 'undefined') {
                window._lastSalePayment = { method: 'multiple', isCredit: false, creditDays: 0 };
                window._ultimaVentaBT = {
                    sale_number: venta.sale_number || venta.id || '',
                    total: total,
                    payment_method: 'Múltiple',
                    items: snapshot.map(i => ({
                        name: i.name, quantity: i.quantity, price: i.price,
                    })),
                };

                AppState.dailySales += total;
                if (typeof updateGoalProgress === 'function') updateGoalProgress();
            }

            // El ticket con sus botones de imprimir/compartir
            if (typeof handlePrint === 'function') handlePrint('simple', venta, total);

            if (typeof AppState !== 'undefined') {
                AppState.cart = [];
                if (typeof saveCart === 'function') saveCart();
                if (typeof renderCart === 'function') renderCart();
                if (typeof selectPaymentUI === 'function') selectPaymentUI('efectivo');
                AppState.paymentMethod = 'efectivo';
            }
            if (typeof playSound === 'function') playSound('success');

        } catch (e) {
            console.error('[Multipago] Error cerrando la venta:', e);
        }
    }

    // ============================================
    // APERTURA
    // ============================================

    /**
     * @param {number} saleId  venta ya creada
     * @param {number} total   importe a cubrir
     * @param {Function} alTerminar  se llama cuando el saldo queda en 0
     */
    function abrir(saleId, total, alTerminar = null) {
        estado.saleId = saleId;
        estado.total = Number(total) || 0;
        estado.pagos = [];
        estado.metodoActivo = null;
        estado.alTerminar = alTerminar;
        estado.cerradaOk = false;
        _pintar();
    }

    function _pintar() {
        let m = document.getElementById('modal-multipago');
        if (m) m.remove();

        m = document.createElement('div');
        m.id = 'modal-multipago';
        m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999999;
                           display:flex;align-items:center;justify-content:center;padding:16px`;

        const cubierto = saldo() <= 0.009;

        const botones = METODOS.map(mt => `
            <button onclick="CajaMultipago.elegirMetodo('${mt.id}')"
                style="flex:1;min-width:88px;padding:11px 6px;border-radius:10px;
                       border:2px solid ${estado.metodoActivo === mt.id ? '#f59e0b' : 'rgba(255,255,255,.12)'};
                       background:${estado.metodoActivo === mt.id ? 'rgba(245,158,11,.18)' : 'rgba(255,255,255,.05)'};
                       color:#e2e8f0;font-size:12px;font-weight:700;cursor:pointer;
                       font-family:inherit">
                <div style="font-size:19px">${mt.icono}</div>${mt.nombre}
            </button>`).join('');

        const lista = estado.pagos.map((p, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                        background:rgba(255,255,255,.05);border-radius:8px;margin-bottom:6px">
                <span style="font-size:17px">${METODOS.find(m => m.id === p.metodo)?.icono || '💰'}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:700;color:#e2e8f0">
                        ${_esc(METODOS.find(m => m.id === p.metodo)?.nombre || p.metodo)}
                    </div>
                    ${p.referencia ? `<div style="font-size:11px;color:#94a3b8">${_esc(p.referencia)}</div>` : ''}
                </div>
                <div style="font-weight:800;font-size:14px;color:#10b981">${_fmt(p.monto)}</div>
                <button onclick="CajaMultipago.quitar(${i})"
                    style="background:none;border:none;color:#ef4444;font-size:17px;
                           cursor:pointer;padding:0 4px">×</button>
            </div>`).join('');

        m.innerHTML = `
            <div style="background:#1a1a2e;border-radius:18px;padding:20px;max-width:430px;
                        width:100%;color:#fff;max-height:94vh;overflow-y:auto">
                <div style="text-align:center;margin-bottom:14px">
                    <div style="color:#94a3b8;font-size:12px">Total de la venta</div>
                    <div style="font-size:30px;font-weight:900">${_fmt(estado.total)}</div>
                    <div style="margin-top:6px;font-size:15px;font-weight:800;
                                color:${cubierto ? '#10b981' : '#f59e0b'}">
                        ${cubierto ? '✓ Cubierto' : `Falta ${_fmt(saldo())}`}
                    </div>
                </div>

                ${lista ? `<div style="margin-bottom:12px">${lista}</div>` : ''}

                ${cubierto ? '' : `
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
                        ${botones}
                    </div>

                    ${estado.metodoActivo ? `
                        <div style="background:rgba(255,255,255,.05);border-radius:10px;
                                    padding:12px;margin-bottom:12px">
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px">
                                Monto
                            </label>
                            <input type="number" id="mp-monto" step="0.10" min="0.10"
                                value="${saldo().toFixed(2)}" inputmode="decimal"
                                style="width:100%;padding:11px;border-radius:8px;
                                       border:2px solid rgba(255,255,255,.15);
                                       background:rgba(255,255,255,.08);color:#fff;
                                       font-size:20px;font-weight:800;text-align:center;
                                       font-family:inherit;margin-bottom:8px">
                            <input type="text" id="mp-ref" maxlength="100"
                                placeholder="Nº de operación / últimos 4 dígitos (opcional)"
                                style="width:100%;padding:9px;border-radius:8px;
                                       border:1px solid rgba(255,255,255,.12);
                                       background:rgba(255,255,255,.06);color:#fff;
                                       font-size:12px;font-family:inherit;margin-bottom:10px">
                            <button onclick="CajaMultipago.agregar()"
                                style="width:100%;padding:12px;border:none;border-radius:9px;
                                       background:linear-gradient(135deg,#3b82f6,#1d4ed8);
                                       color:#fff;font-weight:700;font-size:14px;cursor:pointer;
                                       font-family:inherit">
                                + Agregar pago
                            </button>
                        </div>` : ''}
                `}

                <div style="display:flex;gap:8px">
                    <button onclick="CajaMultipago.cerrar()"
                        style="padding:13px 16px;border:none;border-radius:10px;
                               background:rgba(255,255,255,.1);color:#94a3b8;
                               font-size:14px;cursor:pointer;font-family:inherit">
                        Cancelar
                    </button>
                    <button onclick="CajaMultipago.confirmar()" ${cubierto ? '' : 'disabled'}
                        style="flex:1;padding:13px;border:none;border-radius:10px;
                               background:${cubierto ? 'linear-gradient(135deg,#10b981,#059669)' : 'rgba(255,255,255,.08)'};
                               color:${cubierto ? '#fff' : '#64748b'};font-weight:800;
                               font-size:15px;cursor:${cubierto ? 'pointer' : 'not-allowed'};
                               font-family:inherit">
                        Confirmar cobro
                    </button>
                </div>
            </div>`;

        document.body.appendChild(m);
        setTimeout(() => document.getElementById('mp-monto')?.focus(), 60);
    }

    // ============================================
    // ACCIONES
    // ============================================

    function elegirMetodo(id) {
        estado.metodoActivo = id;
        _pintar();
    }

    async function agregar() {
        const monto = parseFloat((document.getElementById('mp-monto') || {}).value || 0);
        const ref = ((document.getElementById('mp-ref') || {}).value || '').trim();

        if (!estado.metodoActivo) return _toast('Elige un método de pago', 'warning');
        if (!monto || monto <= 0) return _toast('Ingresa un monto válido', 'warning');
        if (monto - saldo() > 0.009) {
            return _toast(`El monto supera lo que falta (${_fmt(saldo())})`, 'warning');
        }

        try {
            const resp = await fetch(`${_api()}/sales/${estado.saleId}/pagos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token()}`,
                },
                body: JSON.stringify({
                    metodo: estado.metodoActivo, monto: monto, referencia: ref || null,
                }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            estado.pagos.push(data.pago);
            estado.metodoActivo = null;
            _pintar();
        } catch (e) {
            console.error('[Multipago] Error agregando pago:', e);
            _toast(e.message || 'No se pudo registrar el pago', 'error');
        }
    }

    async function quitar(idx) {
        const pago = estado.pagos[idx];
        if (!pago) return;
        try {
            const resp = await fetch(`${_api()}/sales/${estado.saleId}/pagos/${pago.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${_token()}` },
            });
            if (resp.status === 403) return _toast('Solo el dueño puede quitar un pago', 'warning');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            estado.pagos.splice(idx, 1);
            _pintar();
        } catch (e) {
            _toast('No se pudo quitar el pago', 'error');
        }
    }

    function confirmar() {
        if (saldo() > 0.009) return;
        estado.cerradaOk = true;
        cerrar();
        _toast(`✅ Cobrado ${_fmt(estado.total)} en ${estado.pagos.length} pago(s)`, 'success');
        if (typeof estado.alTerminar === 'function') {
            estado.alTerminar({ pagos: estado.pagos, total: estado.total });
        }
    }

    /**
     * Cancelar deja la venta ya creada sin cobrar, y eso descuadraría el
     * arqueo. Si no se registró ningún pago, se anula sola. Si ya había
     * pagos, se avisa: borrarlos en silencio sería peor.
     */
    async function cerrar() {
        document.getElementById('modal-multipago')?.remove();

        if (estado.cerradaOk || !estado.saleId) return;

        if (estado.pagos.length === 0) {
            try {
                await fetch(`${_api()}/sales/${estado.saleId}/void`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${_token()}` },
                });
                console.log(`[Multipago] Venta ${estado.saleId} anulada al cancelar`);
            } catch (e) {
                console.warn('[Multipago] No se pudo anular la venta:', e);
            }
        } else {
            _toast(
                `⚠️ La venta #${estado.saleId} quedó con ${_fmt(pagado())} cobrados ` +
                `de ${_fmt(estado.total)}. Complétala o anúlala desde Reportes.`,
                'warning'
            );
        }
    }

    return { abrir, cobrarMultiple, elegirMetodo, agregar, quitar, confirmar, cerrar,
             get saldo() { return saldo(); } };
})();

window.CajaMultipago = CajaMultipago;
