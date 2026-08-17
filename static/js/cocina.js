/**
 * QueVendi — Pantalla de cocina
 * ==============================
 * Lista simple de comandas pendientes. Un pedido = una tarjeta.
 * Pensada para una tablet colgada junto a la plancha o un celular.
 *
 * UX portada de cocina_movil.js de Metraes (el diseño, no el código):
 *   · beep sintetizado con AudioContext — sin archivos de audio
 *   · reconexión con backoff creciente y tope
 *   · heartbeat cada 30 s
 *   · indicador de conexión siempre visible
 *   · temporizador de espera con colores (verde → ámbar → rojo)
 *   · respaldo REST si el WebSocket no da señales
 *
 * Deliberadamente NO portado: estaciones de cocina, filtros por zona,
 * badges de delivery y el acordeón. QueVendi apunta a restaurantes
 * chicos: cajero pide, cocina prepara, se entrega.
 *
 * Autenticación: ?device_token=XXX en la URL. La pantalla no tiene
 * login porque nadie va a escribir una contraseña con las manos llenas.
 */

const Cocina = (() => {

    const HEARTBEAT_MS = 30000;
    const RECONNECT_BASE_MS = 3000;
    const RECONNECT_MAX_MS = 30000;
    const REFRESCO_REST_MS = 60000;   // red de seguridad por si se pierde un evento
    const TICK_TIMER_MS = 15000;      // recalcular minutos de espera

    const MIN_AVISO = 10;   // ámbar
    const MIN_TARDE = 20;   // rojo

    // Voz: pausa antes de hablar (deja que la UI pinte) y silencio
    // entre anuncios para que no suenen pegados.
    const TTS_RETARDO_MS = 300;
    const TTS_SILENCIO_MS = 500;

    const estado = {
        comandas: [],
        storeId: null,
        deviceToken: null,
        ws: null,
        hb: null,
        intentos: 0,
        sonido: true,
        audioCtx: null,
        vistos: new Set(),
        // 'tts' | 'beep' | 'off' — lo decide el negocio en su configuración
        audioMode: 'tts',
        voz: null,
        colaVoz: [],
        hablando: false,
        avisoVozDado: false,
    };

    // ============================================
    // ARRANQUE
    // ============================================

    async function init() {
        const params = new URLSearchParams(location.search);
        estado.deviceToken = params.get('device_token');
        estado.sonido = localStorage.getItem('cocina_sonido') !== 'off';
        _pintarBotonSonido();

        document.getElementById('btn-sonido').onclick = _toggleSonido;

        // Desbloquear el audio en el primer toque (política de los navegadores)
        document.addEventListener('click', _desbloquearAudio, { once: true });
        document.addEventListener('touchstart', _desbloquearAudio, { once: true });

        try {
            const s = await _fetch('/sesion');
            estado.storeId = s.store_id;
            estado.audioMode = s.audio_mode || 'tts';
            document.getElementById('negocio').textContent = s.negocio || '';
        } catch (e) {
            return _mostrarError(e);
        }

        _prepararVoz();
        console.log(`[Cocina] Modo de audio: ${estado.audioMode}`);

        await cargar();
        _conectarWS();

        setInterval(cargar, REFRESCO_REST_MS);
        setInterval(_render, TICK_TIMER_MS);
    }

    // ============================================
    // DATOS
    // ============================================

    function _auth(url) {
        const base = `${location.origin}/api/v1/cocina${url}`;
        if (!estado.deviceToken) return base;
        return base + (base.includes('?') ? '&' : '?') +
               'device_token=' + encodeURIComponent(estado.deviceToken);
    }

    async function _fetch(url, opts = {}) {
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        const jwt = localStorage.getItem('access_token');
        if (!estado.deviceToken && jwt) headers['Authorization'] = `Bearer ${jwt}`;

        const resp = await fetch(_auth(url), { ...opts, headers });
        if (!resp.ok) {
            const err = new Error(`HTTP ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    }

    async function cargar() {
        try {
            const data = await _fetch('/pendientes');
            estado.comandas = data.comandas || [];
            estado.comandas.forEach(c => estado.vistos.add(c.id));
            _render();
        } catch (e) {
            if (e.status === 401 || e.status === 403) _mostrarError(e);
            else console.warn('[Cocina] No se pudo refrescar:', e.message);
        }
    }

    // ============================================
    // WEBSOCKET
    // ============================================

    function _conectarWS() {
        if (!estado.storeId) return;

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let url = `${proto}//${location.host}/ws/cocina/${estado.storeId}?`;
        url += estado.deviceToken
            ? 'device_token=' + encodeURIComponent(estado.deviceToken)
            : 'token=' + encodeURIComponent(localStorage.getItem('access_token') || '');

        _estadoWS(false);
        try { estado.ws = new WebSocket(url); }
        catch (e) { return _reconectar(); }

        estado.ws.onopen = () => {
            _estadoWS(true);
            estado.intentos = 0;
            clearInterval(estado.hb);
            estado.hb = setInterval(() => {
                try { estado.ws.send('ping'); } catch (e) {}
            }, HEARTBEAT_MS);
            cargar();   // por si nos perdimos algo mientras estábamos caídos
        };

        estado.ws.onmessage = (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.tipo === 'pong') return;
            _procesarEvento(msg);
        };

        estado.ws.onclose = (ev) => {
            _estadoWS(false);
            clearInterval(estado.hb);
            // 4001 credencial inválida, 4003 tienda ajena, 4004 cocina apagada:
            // reintentar no arregla nada.
            if ([4001, 4003, 4004].includes(ev.code)) {
                return _mostrarError({ status: 401, code: ev.code });
            }
            _reconectar();
        };

        estado.ws.onerror = () => {};
    }

    function _reconectar() {
        estado.intentos++;
        const espera = Math.min(RECONNECT_BASE_MS * estado.intentos, RECONNECT_MAX_MS);
        console.log(`[Cocina] Reintentando en ${espera / 1000}s (intento ${estado.intentos})`);
        setTimeout(() => {
            if (!estado.ws || estado.ws.readyState !== WebSocket.OPEN) _conectarWS();
        }, espera);
    }

    function _procesarEvento(msg) {
        if (msg.tipo === 'comanda_nueva' && msg.comanda) {
            const c = msg.comanda;
            if (!estado.comandas.some(x => x.id === c.id)) {
                estado.comandas.push(c);
                if (!estado.vistos.has(c.id)) {
                    estado.vistos.add(c.id);
                    _avisarPedidoNuevo(c);
                    _toast(c.mesa ? `Mesa ${c.mesa} — #${c.numero}` : `Comanda #${c.numero}`);
                }
            }
            _render(c.id);
            return;
        }
        // Cualquier otro cambio: pedir el estado real en vez de adivinarlo.
        cargar();
    }

    function _estadoWS(conectado) {
        const el = document.getElementById('ws-estado');
        const txt = document.getElementById('ws-txt');
        if (!el) return;
        el.className = 'pill ' + (conectado ? 'on' : 'off');
        txt.textContent = conectado ? 'En vivo' : 'Reconectando';
    }

    // ============================================
    // ACCIONES
    // ============================================

    async function empezar(itemId) { await _estadoItem(itemId, 'preparing'); }
    async function listo(itemId)   { await _estadoItem(itemId, 'ready'); }

    async function _estadoItem(itemId, nuevo) {
        try {
            await _fetch(`/item/${itemId}/estado`, {
                method: 'PUT',
                body: JSON.stringify({ estado: nuevo }),
            });
            await cargar();
        } catch (e) {
            _toast(e.status === 409 ? 'Ese cambio no es válido' : 'No se pudo actualizar');
            await cargar();
        }
    }

    async function entregar(comandaId) {
        try {
            await _fetch(`/comanda/${comandaId}/estado`, {
                method: 'PUT',
                body: JSON.stringify({ estado: 'served' }),
            });
            estado.comandas = estado.comandas.filter(c => c.id !== comandaId);
            _render();
            _toast('Pedido entregado');
        } catch (e) {
            _toast('No se pudo marcar como entregado');
            await cargar();
        }
    }

    // ============================================
    // RENDER
    // ============================================

    function _minutos(iso) {
        if (!iso) return 0;
        return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    }

    function _render(destacarId = null) {
        const lista = document.getElementById('lista');
        const vacio = document.getElementById('vacio');
        if (!lista) return;

        // Más antiguas primero: lo que lleva más rato es lo más urgente.
        const orden = [...estado.comandas].sort(
            (a, b) => new Date(a.sent_at || 0) - new Date(b.sent_at || 0)
        );

        vacio.style.display = orden.length ? 'none' : 'block';
        lista.innerHTML = orden.map(c => _tarjeta(c, c.id === destacarId)).join('');
    }

    function _tarjeta(c, destacar) {
        const min = _minutos(c.sent_at);
        const clase = min >= MIN_TARDE ? 'late' : (min >= MIN_AVISO ? 'warn' : '');
        const items = c.items || [];
        const todosListos = items.length > 0 && items.every(i => i.estado === 'ready');

        const filas = items.map(i => {
            const esListo = i.estado === 'ready';
            const btn = esListo
                ? `<button class="accion hecho" disabled>✓ Listo</button>`
                : (i.estado === 'preparing'
                    ? `<button class="accion listo" onclick="Cocina.listo(${i.id})">Listo</button>`
                    : `<button class="accion empezar" onclick="Cocina.empezar(${i.id})">Empezar</button>`);

            return `
                <div class="item ${esListo ? 'listo' : ''}">
                    <div class="cant">${_fmtCant(i.cantidad)}</div>
                    <div class="txt">
                        <div class="nombre">${_esc(i.nombre)}</div>
                        ${i.nota ? `<div class="nota">${_esc(i.nota)}</div>` : ''}
                    </div>
                    ${btn}
                </div>`;
        }).join('');

        const mesa = (c.mesa || '').trim();
        // Marca los pedidos que el propio cliente mandó desde su celular:
        // nadie en caja los revisó antes de llegar aquí.
        const delCatalogo = (c.origen || 'caja').startsWith('catalogo');

        return `
            <div class="comanda ${c.estado === 'preparing' ? 'preparing' : ''} ${destacar ? 'nueva' : ''}">
                <div class="cab">
                    ${mesa ? `<div class="mesa">MESA ${_esc(mesa)}</div>` : ''}
                    <div class="num">#${c.numero}${delCatalogo ? ' <span class="origen">📱</span>' : ''}</div>
                    <div class="meta">
                        ${c.cajero_nombre ? `<b>${_esc(c.cajero_nombre)}</b><br>` : ''}
                        ${_hora(c.sent_at)}
                        ${c.nota ? `<br><b>${_esc(c.nota)}</b>` : ''}
                    </div>
                    <div class="timer ${clase}">${min}m</div>
                </div>
                <div class="items">${filas}</div>
                ${todosListos ? `
                    <div class="pie">
                        <button class="btn-entregar" onclick="Cocina.entregar(${c.id})">
                            ✓ ENTREGADO
                        </button>
                    </div>` : ''}
            </div>`;
    }

    function _fmtCant(c) {
        const f = parseFloat(c);
        return Number.isInteger(f) ? String(f) : String(f);
    }

    function _hora(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }

    function _esc(t) {
        const d = document.createElement('div');
        d.textContent = t == null ? '' : String(t);
        return d.innerHTML;
    }

    // ============================================
    // VOZ (TTS)
    // ============================================
    //
    // El cocinero no toca la pantalla ni siempre la está mirando: con
    // las manos en la plancha, oír el pedido vale más que verlo.

    function _prepararVoz() {
        if (!('speechSynthesis' in window)) {
            console.warn('[Cocina] Este navegador no tiene voz sintetizada; se usará solo el pitido');
            if (estado.audioMode === 'tts') estado.audioMode = 'beep';
            return;
        }
        _elegirVoz();
        // Chrome carga las voces de forma asíncrona.
        window.speechSynthesis.onvoiceschanged = _elegirVoz;
    }

    /** Preferencia: es-PE → es-ES → es-MX → cualquier español. */
    function _elegirVoz() {
        let voces = [];
        try { voces = window.speechSynthesis.getVoices() || []; } catch (e) { return; }
        if (!voces.length) return;

        const español = voces.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
        if (!español.length) {
            console.warn('[Cocina] Sin voces en español: se usará solo el pitido');
            if (estado.audioMode === 'tts') {
                estado.audioMode = 'beep';
                // Avisar UNA vez en pantalla: si no, en la instalación se
                // ve que "no habla" y no se sabe que faltan las voces.
                if (!estado.avisoVozDado) {
                    estado.avisoVozDado = true;
                    setTimeout(() => _toast(
                        'Este equipo no tiene voces en español: solo sonará el aviso'
                    ), 1500);
                }
            }
            return;
        }

        const porLang = (p) => español.find(v => (v.lang || '').toLowerCase().replace('_', '-') === p);
        estado.voz = porLang('es-pe') || porLang('es-es') || porLang('es-mx') || español[0];
        console.log(`[Cocina] Voz: ${estado.voz.name} (${estado.voz.lang})`);
    }

    /**
     * Texto que se lee en voz alta.
     *   "Mesa 4: 2 Arroz con pollo sin frejoles, Sopa"
     *   "Sin mesa: Ceviche mixto"
     */
    function construirAnuncio(comanda) {
        const mesa = (comanda.mesa || '').trim();
        const cabecera = mesa ? `Mesa ${mesa}` : 'Sin mesa';

        const partes = (comanda.items || []).map(i => {
            const cant = parseFloat(i.cantidad) || 1;
            let t = cant > 1 ? `${cant} ${i.nombre}` : `${i.nombre}`;
            if (i.nota) t += ` ${i.nota}`;
            return t;
        });

        return `${cabecera}: ${partes.join(', ')}`;
    }

    function _anunciar(comanda) {
        if (estado.audioMode !== 'tts' || !estado.voz) return;
        estado.colaVoz.push(construirAnuncio(comanda));
        if (!estado.hablando) _procesarColaVoz();
    }

    /**
     * Cola FIFO: si entran tres pedidos seguidos se leen los tres en
     * orden. Cortar el anuncio anterior haría perder un pedido.
     */
    function _procesarColaVoz() {
        if (!estado.colaVoz.length) { estado.hablando = false; return; }

        estado.hablando = true;
        const texto = estado.colaVoz.shift();

        let u;
        try {
            u = new SpeechSynthesisUtterance(texto);
        } catch (e) {
            estado.hablando = false;
            return;
        }

        if (estado.voz) { u.voice = estado.voz; u.lang = estado.voz.lang; }
        u.rate = 0.95;    // algo más lento: hay ruido de cocina
        u.pitch = 1.0;
        u.volume = 1.0;

        const seguir = () => setTimeout(_procesarColaVoz, TTS_SILENCIO_MS);
        u.onend = seguir;
        u.onerror = (e) => {
            console.warn('[Cocina] Error hablando:', e.error);
            seguir();
        };

        try {
            window.speechSynthesis.speak(u);
            console.log(`[Cocina] 🔊 "${texto}"`);
        } catch (e) {
            estado.hablando = false;
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

    /**
     * Aviso al entrar un pedido, según lo que haya elegido el negocio:
     *   tts  → pitido corto y después el pedido leído en voz alta
     *   beep → sólo el pitido
     *   off  → nada
     *
     * En modo voz el pitido va igual: hace levantar la vista antes de
     * que empiece a hablar.
     */
    function _avisarPedidoNuevo(comanda) {
        if (estado.audioMode === 'off') return;

        _beep(estado.audioMode === 'tts' ? 1 : 2);

        if (estado.audioMode === 'tts') {
            // Pequeña pausa: la UI termina de pintar y el pitido no se
            // solapa con la voz.
            setTimeout(() => _anunciar(comanda), TTS_RETARDO_MS);
        }
    }

    function _beep(veces = 2) {
        if (!estado.sonido) return;
        try {
            _desbloquearAudio();
            const ctx = estado.audioCtx;
            if (!ctx) return;
            for (let i = 0; i < veces; i++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = 880;
                osc.type = 'square';
                gain.gain.value = 0.22;
                const t = ctx.currentTime + i * 0.28;
                osc.start(t); osc.stop(t + 0.16);
            }
        } catch (e) {}
    }

    function _toggleSonido() {
        estado.sonido = !estado.sonido;
        localStorage.setItem('cocina_sonido', estado.sonido ? 'on' : 'off');
        _pintarBotonSonido();
        if (estado.sonido) {
            _beep(1);
        } else {
            // Silenciar corta también lo que se esté leyendo.
            try { window.speechSynthesis.cancel(); } catch (e) {}
            estado.colaVoz = [];
            estado.hablando = false;
        }
    }

    function _pintarBotonSonido() {
        const b = document.getElementById('btn-sonido');
        if (!b) return;
        b.textContent = estado.sonido ? '🔔' : '🔕';
        b.className = 'btn-icono' + (estado.sonido ? '' : ' mute');
    }

    // ============================================
    // AVISOS
    // ============================================

    function _toast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2600);
    }

    function _mostrarError(e) {
        document.getElementById('lista').innerHTML = '';
        document.getElementById('vacio').style.display = 'none';
        const box = document.getElementById('error');
        box.style.display = 'block';

        if (e && e.code === 4004) {
            document.getElementById('error-titulo').textContent = 'Cocina desactivada';
            document.getElementById('error-texto').innerHTML =
                'El módulo cocina no está activado para este negocio.<br>' +
                'Actívalo en Configuración del negocio.';
        } else if (e && e.status === 403) {
            document.getElementById('error-titulo').textContent = 'Sin permiso';
            document.getElementById('error-texto').innerHTML =
                'Esta cuenta no puede ver la cocina de este negocio.';
        }
        try { estado.ws && estado.ws.close(); } catch (err) {}
        clearInterval(estado.hb);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        empezar, listo, entregar, cargar,
        construirAnuncio,                       // expuesto para pruebas
        _estado: estado,
    };
})();

window.Cocina = Cocina;
