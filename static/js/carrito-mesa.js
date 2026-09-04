/**
 * QueVendi — Carrito del Catálogo Virtual (pedido de mesa)
 * =========================================================
 * El cliente escanea el QR de su mesa, arma el pedido en su celular y
 * lo confirma. La comanda entra DIRECTO a cocina — no espera a que
 * nadie en caja la apruebe.
 *
 * Sustituye al flujo de chat paso a paso (`pedir-gratis` / `pedir-pago`),
 * que creaba una fila por producto en `carta_pedidos` y no servía para
 * un pedido de varios platos.
 *
 * El cliente NO paga desde aquí: paga a la mesera al final. El cobro
 * automático llega en una fase posterior.
 */

const CarritoMesa = (() => {

    const estado = {
        items: [],          // { id, name, price, cantidad, nota }
        mesa: null,
        telefono: null,
        enviando: false,
    };

    function _api() {
        return `${window.location.origin}/api/public/carta/${estado.telefono}`;
    }

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    const _fmt = (n) => `S/ ${(Number(n) || 0).toFixed(2)}`;

    // ============================================
    // INICIO
    // ============================================

    function init(telefono) {
        estado.telefono = telefono;
        estado.mesa = new URLSearchParams(location.search).get('mesa');
        if (estado.mesa) estado.mesa = estado.mesa.trim().slice(0, 50) || null;

        _pintarCabeceraMesa();
        _crearBarra();
        console.log(`[Carrito] Listo. Mesa: ${estado.mesa || '(sin mesa)'}`);
    }

    /** Si vino por QR de mesa, se anuncia bien visible arriba. */
    function _pintarCabeceraMesa() {
        if (!estado.mesa) return;
        if (document.getElementById('banner-mesa')) return;

        const b = document.createElement('div');
        b.id = 'banner-mesa';
        b.style.cssText = `
            position:sticky; top:0; z-index:60;
            background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff;
            padding:9px 14px; text-align:center;
            font-weight:800; font-size:15px; letter-spacing:.3px;
        `;
        b.textContent = `🍽️ Mesa ${estado.mesa}`;
        document.body.insertBefore(b, document.body.firstChild);
    }

    // ============================================
    // CARRITO
    // ============================================

    function agregar(producto, cantidad = 1, nota = null) {
        if (!producto) return;
        const existente = estado.items.find(i => i.id === producto.id && i.nota === nota);
        if (existente) {
            existente.cantidad += cantidad;
        } else {
            estado.items.push({
                id: producto.id,
                name: producto.name,
                price: Number(producto.price) || 0,
                cantidad: cantidad,
                nota: nota || null,
            });
        }
        _pintarBarra();
        _aviso(`${producto.name} agregado`);
    }

    function quitar(idx) {
        estado.items.splice(idx, 1);
        _pintarBarra();
        if (document.getElementById('modal-carrito')) abrir();
    }

    function cambiarCantidad(idx, delta) {
        const it = estado.items[idx];
        if (!it) return;
        it.cantidad += delta;
        if (it.cantidad <= 0) estado.items.splice(idx, 1);
        _pintarBarra();
        abrir();
    }

    const total = () => estado.items.reduce((s, i) => s + i.price * i.cantidad, 0);
    const unidades = () => estado.items.reduce((s, i) => s + i.cantidad, 0);

    // ============================================
    // BARRA INFERIOR
    // ============================================

    function _crearBarra() {
        if (document.getElementById('barra-carrito')) return;
        const b = document.createElement('div');
        b.id = 'barra-carrito';
        b.onclick = abrir;
        b.style.cssText = `
            position:fixed; left:0; right:0; bottom:0; z-index:9999;
            display:none; align-items:center; gap:12px;
            padding:14px 18px; cursor:pointer;
            background:linear-gradient(135deg,#10b981,#059669); color:#fff;
            box-shadow:0 -4px 20px rgba(0,0,0,.25);
            font-family:inherit;
        `;
        b.innerHTML = `
            <span id="bc-n" style="background:rgba(255,255,255,.25);border-radius:20px;
                  padding:5px 12px;font-weight:800;font-size:14px">0</span>
            <span style="flex:1;font-weight:700;font-size:15px">Ver mi pedido</span>
            <span id="bc-total" style="font-weight:800;font-size:17px">S/ 0.00</span>
        `;
        document.body.appendChild(b);
    }

    function _pintarBarra() {
        const b = document.getElementById('barra-carrito');
        if (!b) return;
        const n = unidades();
        b.style.display = n ? 'flex' : 'none';
        document.getElementById('bc-n').textContent = n;
        document.getElementById('bc-total').textContent = _fmt(total());
    }

    // ============================================
    // MODAL DEL PEDIDO
    // ============================================

    function abrir() {
        let m = document.getElementById('modal-carrito');
        if (m) m.remove();

        m = document.createElement('div');
        m.id = 'modal-carrito';
        // Hoja inferior en móvil; en pantallas anchas se centra para no
        // quedar pegada al borde. La caja ya limita su alto a 86vh.
        m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;
                           display:flex;align-items:flex-end;justify-content:center;
                           overflow-y:auto`;

        const filas = estado.items.map((i, idx) => `
            <div style="display:flex;align-items:center;gap:10px;padding:11px 0;
                        border-bottom:1px solid #eee">
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:14px;color:#1a1a2e">${_esc(i.name)}</div>
                    <div style="color:#64748b;font-size:12px">${_fmt(i.price)} c/u</div>
                    ${i.nota ? `<div style="color:#ef4444;font-size:12px">${_esc(i.nota)}</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                    <button onclick="CarritoMesa.cambiarCantidad(${idx},-1)"
                        style="width:32px;height:32px;border-radius:8px;border:1px solid #ddd;
                               background:#fff;font-size:17px;cursor:pointer">−</button>
                    <span style="min-width:22px;text-align:center;font-weight:800">${i.cantidad}</span>
                    <button onclick="CarritoMesa.cambiarCantidad(${idx},1)"
                        style="width:32px;height:32px;border-radius:8px;border:1px solid #ddd;
                               background:#fff;font-size:17px;cursor:pointer">+</button>
                </div>
                <div style="min-width:64px;text-align:right;font-weight:800;font-size:14px">
                    ${_fmt(i.price * i.cantidad)}
                </div>
            </div>`).join('');

        m.innerHTML = `
            <div style="background:#fff;border-radius:20px 20px 0 0;padding:20px;
                        width:100%;max-width:520px;max-height:86vh;display:flex;
                        flex-direction:column">
                <div style="display:flex;align-items:center;margin-bottom:10px">
                    <h3 style="margin:0;font-size:18px;color:#1a1a2e">
                        Mi pedido ${estado.mesa ? `· Mesa ${_esc(estado.mesa)}` : ''}
                    </h3>
                    <button onclick="document.getElementById('modal-carrito').remove()"
                        style="margin-left:auto;background:none;border:none;font-size:26px;
                               color:#94a3b8;cursor:pointer;line-height:1">×</button>
                </div>

                <div style="flex:1;overflow-y:auto;margin-bottom:12px">
                    ${filas || '<p style="color:#64748b;text-align:center;padding:26px">Tu pedido está vacío</p>'}
                </div>

                <textarea id="nota-pedido" rows="2" placeholder="¿Alguna indicación? (opcional)"
                    style="width:100%;border:1px solid #ddd;border-radius:10px;padding:10px;
                           font-family:inherit;font-size:14px;resize:none;margin-bottom:12px"></textarea>

                <div style="display:flex;align-items:center;margin-bottom:12px">
                    <span style="font-size:15px;color:#64748b">Total</span>
                    <span style="margin-left:auto;font-size:24px;font-weight:900;color:#10b981">
                        ${_fmt(total())}
                    </span>
                </div>

                <button id="btn-confirmar-pedido" onclick="CarritoMesa.confirmar()"
                    ${estado.items.length ? '' : 'disabled'}
                    style="width:100%;padding:16px;border:none;border-radius:12px;
                           background:${estado.items.length ? 'linear-gradient(135deg,#10b981,#059669)' : '#cbd5e1'};
                           color:#fff;font-size:16px;font-weight:800;cursor:pointer;
                           font-family:inherit">
                    Confirmar pedido
                </button>
                <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:9px">
                    Pagas a la mesera cuando termines
                </p>
            </div>`;

        m.addEventListener('click', e => { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
    }

    // ============================================
    // CONFIRMAR
    // ============================================

    async function confirmar() {
        if (!estado.items.length || estado.enviando) return;

        // Sin mesa el cliente NO está en el local: antes de enviar hay que
        // preguntarle cómo lo recibe y cómo pagará. Ese formulario vive en
        // carta_virtual.html y se encarga de enviar el pedido.
        if (!estado.mesa && typeof window.abrirConfirmacionRemota === 'function') {
            const m = document.getElementById('modal-carrito');
            if (m) m.remove();
            window.abrirConfirmacionRemota(estado.items, total());
            return;
        }

        const btn = document.getElementById('btn-confirmar-pedido');
        const nota = (document.getElementById('nota-pedido') || {}).value || '';
        estado.enviando = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando a cocina...'; }

        try {
            const resp = await fetch(`${_api()}/pedido`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mesa: estado.mesa,
                    nota: nota.trim() || null,
                    cliente_nombre: (window.cliente && window.cliente.nombre) || null,
                    items: estado.items.map(i => ({
                        producto_id: i.id,
                        cantidad: i.cantidad,
                        nota: i.nota,
                    })),
                }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }

            const data = await resp.json();
            estado.items = [];
            _pintarBarra();
            const m = document.getElementById('modal-carrito');
            if (m) m.remove();
            _pantallaConfirmado(data);

        } catch (e) {
            console.error('[Carrito] Error confirmando:', e);
            _aviso('No se pudo enviar el pedido. Intenta de nuevo.', true);
            if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
        } finally {
            estado.enviando = false;
        }
    }

    function _pantallaConfirmado(data) {
        const m = document.createElement('div');
        m.id = 'modal-confirmado';
        // `overflow-y:auto` en la capa y `max-height` en la caja: si el
        // contenido no cabe (pantalla baja, texto largo, zoom), se puede
        // desplazar. Sin esto el botón de cerrar se salía de la pantalla y
        // el cliente quedaba atrapado en el modal.
        m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10001;
                           display:flex;align-items:center;justify-content:center;
                           padding:20px;overflow-y:auto`;
        m.innerHTML = `
            <div style="background:#fff;border-radius:20px;padding:30px 24px;
                        max-width:360px;width:100%;text-align:center;
                        max-height:calc(100vh - 40px);overflow-y:auto;
                        margin:auto">
                <div style="font-size:56px;margin-bottom:8px">👨‍🍳</div>
                <h2 style="margin:0 0 6px;font-size:21px;color:#1a1a2e">¡Pedido enviado!</h2>
                <div style="font-size:44px;font-weight:900;color:#10b981;margin:10px 0">
                    #${data.numero}
                </div>
                <p style="color:#64748b;font-size:15px;line-height:1.55;margin-bottom:18px">
                    ${_esc(data.mensaje || 'Tu pedido llegó a cocina.')}
                </p>
                <div style="background:#f1f5f9;border-radius:10px;padding:12px;margin-bottom:18px">
                    <div style="color:#64748b;font-size:12px">Total aproximado</div>
                    <div style="font-size:22px;font-weight:800;color:#1a1a2e">
                        ${_fmt(data.total_estimado)}
                    </div>
                    <div style="color:#94a3b8;font-size:12px;margin-top:4px">
                        Pagas a la mesera al terminar
                    </div>
                </div>
                <button onclick="document.getElementById('modal-confirmado').remove()"
                    style="width:100%;padding:14px;border:none;border-radius:11px;
                           background:#1a1a2e;color:#fff;font-size:15px;font-weight:700;
                           cursor:pointer;font-family:inherit">
                    Seguir viendo la carta
                </button>
            </div>`;
        document.body.appendChild(m);
    }

    // ============================================
    // AVISOS
    // ============================================

    function _aviso(msg, error = false) {
        const t = document.createElement('div');
        t.style.cssText = `position:fixed;bottom:88px;left:50%;transform:translateX(-50%);
            background:${error ? '#ef4444' : '#1a1a2e'};color:#fff;padding:11px 20px;
            border-radius:10px;font-size:14px;font-weight:600;z-index:10002;
            box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:90%;text-align:center`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2200);
    }

    /** Lo usa el flujo remoto cuando su formulario ya envió el pedido. */
    function vaciar() {
        estado.items = [];
        _pintarBarra();
    }

    return { init, agregar, quitar, cambiarCantidad, abrir, confirmar, vaciar,
             get mesa() { return estado.mesa; },
             get items() { return estado.items; } };
})();

window.CarritoMesa = CarritoMesa;
