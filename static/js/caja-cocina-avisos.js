/**
 * QueVendi — Aviso a caja cuando un pedido está listo
 * ====================================================
 * Escucha el canal `caja:{store_id}` y avisa al cajero en cuanto cocina
 * termina una comanda: sonido corto + badge con el número.
 *
 * Al pulsar el badge se ve qué comandas están listas, para poder
 * llamarlas por número y marcarlas entregadas.
 *
 * Se activa solo si el negocio tiene el módulo cocina encendido; en una
 * bodega no aparece nada.
 */

const CajaCocinaAvisos = (() => {

    const HEARTBEAT_MS = 30000;
    const RECONNECT_BASE_MS = 3000;
    const RECONNECT_MAX_MS = 30000;

    const estado = {
        storeId: null,
        listas: [],        // comandas listas sin entregar
        ws: null,
        hb: null,
        intentos: 0,
        audioCtx: null,
        activo: false,
    };

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

    async function _fetch(path, opts = {}) {
        const resp = await fetch(`${_api()}/cocina${path}`, {
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
        try {
            const s = await _fetch('/sesion');
            estado.storeId = s.store_id;
            estado.activo = true;
        } catch (e) {
            // 403 = cocina desactivada. Es el caso normal en una bodega.
            return;
        }

        _crearBadge();
        document.addEventListener('click', _desbloquearAudio, { once: true });
        _conectar();
        console.log('[CajaCocina] 🔔 Avisos de cocina activos');
    }

    // ============================================
    // WEBSOCKET
    // ============================================

    function _conectar() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/ws/caja/${estado.storeId}`
                  + `?token=${encodeURIComponent(_token() || '')}`;

        try { estado.ws = new WebSocket(url); }
        catch (e) { return _reconectar(); }

        estado.ws.onopen = () => {
            estado.intentos = 0;
            clearInterval(estado.hb);
            estado.hb = setInterval(() => {
                try { estado.ws.send('ping'); } catch (e) {}
            }, HEARTBEAT_MS);
        };

        estado.ws.onmessage = (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.tipo === 'comanda_lista') _pedidoListo(msg);
            if (msg.tipo === 'comanda_catalogo') _pedidoDesdeCatalogo(msg);
        };

        estado.ws.onclose = (ev) => {
            clearInterval(estado.hb);
            if ([4001, 4003, 4004].includes(ev.code)) return;  // no insistir
            _reconectar();
        };

        estado.ws.onerror = () => {};
    }

    function _reconectar() {
        estado.intentos++;
        const espera = Math.min(RECONNECT_BASE_MS * estado.intentos, RECONNECT_MAX_MS);
        setTimeout(() => {
            if (!estado.ws || estado.ws.readyState !== WebSocket.OPEN) _conectar();
        }, espera);
    }

    // ============================================
    // AVISO
    // ============================================

    function _pedidoListo(msg) {
        if (estado.listas.some(c => c.comanda_id === msg.comanda_id)) return;

        estado.listas.push({ comanda_id: msg.comanda_id, numero: msg.numero });
        _pintarBadge();
        _campanita();

        if (typeof showToast === 'function') {
            showToast(`🍽️ Pedido #${msg.numero} listo para entregar`, 'success');
        }
    }

    /**
     * Un cliente pidió desde su celular y el pedido ya está en cocina.
     * El aviso es informativo, no exige acción: por eso un solo tono
     * grave y un toast, sin el badge verde de "listo para entregar".
     */
    function _pedidoDesdeCatalogo(msg) {
        _tonoSuave();
        const donde = msg.mesa ? `Mesa ${msg.mesa}` : 'Para llevar';
        if (typeof showToast === 'function') {
            showToast(`📱 ${donde} pidió por la carta — comanda #${msg.numero}`, 'info');
        }
        console.log('[CajaCocina] Pedido desde catálogo:', msg);
    }

    // ============================================
    // BADGE
    // ============================================

    function _crearBadge() {
        if (document.getElementById('badge-cocina')) return;

        const b = document.createElement('div');
        b.id = 'badge-cocina';
        b.onclick = _abrirPanel;
        b.style.cssText = `
            position:fixed; right:16px; bottom:88px; z-index:9998;
            display:none; align-items:center; gap:8px;
            padding:12px 18px; border-radius:26px;
            background:linear-gradient(135deg,#10b981,#059669); color:#fff;
            font-family:inherit; font-size:14px; font-weight:800;
            box-shadow:0 6px 22px rgba(16,185,129,.45); cursor:pointer;
        `;
        b.innerHTML = `<span style="font-size:18px">🍽️</span>
                       <span id="badge-cocina-txt">0 listos</span>`;
        document.body.appendChild(b);

        const st = document.createElement('style');
        st.textContent = `@keyframes latidoCocina {
            0%,100% { transform:scale(1); } 50% { transform:scale(1.07); } }
            #badge-cocina.pulso { animation:latidoCocina .9s ease 3; }`;
        document.head.appendChild(st);
    }

    function _pintarBadge() {
        const b = document.getElementById('badge-cocina');
        const t = document.getElementById('badge-cocina-txt');
        if (!b || !t) return;

        const n = estado.listas.length;
        if (!n) { b.style.display = 'none'; return; }

        b.style.display = 'flex';
        t.textContent = n === 1
            ? `Pedido #${estado.listas[0].numero} listo`
            : `${n} pedidos listos`;

        b.classList.remove('pulso');
        void b.offsetWidth;      // reiniciar la animación
        b.classList.add('pulso');
    }

    // ============================================
    // PANEL
    // ============================================

    function _abrirPanel() {
        let m = document.getElementById('modal-cocina-listos');
        if (m) m.remove();

        m = document.createElement('div');
        m.id = 'modal-cocina-listos';
        m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999999;
                           display:flex;align-items:center;justify-content:center;padding:16px`;

        const filas = estado.listas.map(c => `
            <div style="display:flex;align-items:center;gap:12px;padding:13px;
                        background:rgba(255,255,255,.05);border-radius:10px;margin-bottom:8px">
                <div style="font-size:26px;font-weight:900;color:#10b981;min-width:52px">
                    #${c.numero}
                </div>
                <div style="flex:1;color:#94a3b8;font-size:13px">Listo para entregar</div>
                <button onclick="CajaCocinaAvisos.entregar(${c.comanda_id})"
                    style="padding:11px 15px;border:none;border-radius:9px;
                           background:linear-gradient(135deg,#10b981,#059669);
                           color:#fff;font-weight:700;font-size:13px;cursor:pointer">
                    Entregar
                </button>
            </div>`).join('');

        m.innerHTML = `
            <div style="background:#1a1a2e;border-radius:16px;padding:20px;
                        max-width:400px;width:100%;color:#fff">
                <div style="display:flex;align-items:center;margin-bottom:14px">
                    <h3 style="margin:0;font-size:17px">🍽️ Pedidos listos</h3>
                    <button onclick="document.getElementById('modal-cocina-listos').remove()"
                        style="margin-left:auto;background:none;border:none;color:#94a3b8;
                               font-size:24px;cursor:pointer;line-height:1">×</button>
                </div>
                ${filas || '<div style="color:#94a3b8;font-size:13px;padding:16px;text-align:center">No hay pedidos listos.</div>'}
            </div>`;

        m.addEventListener('click', e => { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
    }

    async function entregar(comandaId) {
        try {
            await _fetch(`/comanda/${comandaId}/estado`, {
                method: 'PUT',
                body: JSON.stringify({ estado: 'served' }),
            });
            estado.listas = estado.listas.filter(c => c.comanda_id !== comandaId);
            _pintarBadge();

            const m = document.getElementById('modal-cocina-listos');
            if (m) { m.remove(); if (estado.listas.length) _abrirPanel(); }

            if (typeof showToast === 'function') showToast('Pedido entregado', 'success');
        } catch (e) {
            if (typeof showToast === 'function') showToast('No se pudo marcar como entregado', 'error');
        }
    }

    // ============================================
    // SONIDO
    // ============================================

    function _desbloquearAudio() {
        try {
            if (!estado.audioCtx) {
                estado.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (estado.audioCtx.state === 'suspended') estado.audioCtx.resume();
        } catch (e) {}
    }

    /** Un solo tono grave y corto: avisa sin exigir atención inmediata. */
    function _tonoSuave() {
        try {
            _desbloquearAudio();
            const ctx = estado.audioCtx;
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 520;
            osc.type = 'sine';
            gain.gain.value = 0.14;
            const t = ctx.currentTime;
            osc.start(t); osc.stop(t + 0.18);
        } catch (e) {}
    }

    /** Dos notas ascendentes: se distingue del sonido de venta completada. */
    function _campanita() {
        try {
            _desbloquearAudio();
            const ctx = estado.audioCtx;
            if (!ctx) return;
            [[880, 0], [1180, 0.13]].forEach(([freq, delay]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = 0.2;
                const t = ctx.currentTime + delay;
                osc.start(t); osc.stop(t + 0.14);
            });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1200));
    } else {
        setTimeout(init, 1200);
    }

    return { init, entregar };
})();

window.CajaCocinaAvisos = CajaCocinaAvisos;
