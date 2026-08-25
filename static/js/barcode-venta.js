/**
 * QueVendi — Código de barras en la pantalla de venta
 * ====================================================
 * Dos formas de entrar un código, una sola forma de resolverlo:
 *
 *   1. Lector físico (USB/Bluetooth) — se comporta como un teclado:
 *      teclea el código en el buscador y manda Enter. No hace falta
 *      driver ni permiso; funciona con el input que ya existe.
 *   2. Cámara del celular — botón "Escanear" con html5-qrcode.
 *
 * Ambas terminan en `resolver()`, que pide el producto al backend y lo
 * suma al carrito sin pasar por la lista de resultados.
 *
 * Todo esto sólo aparece si la tienda tiene `barcode_enabled`. Una
 * bodega que no use códigos ve exactamente la misma pantalla de antes.
 */

const BarcodeVenta = (() => {

    // Un lector teclea mucho más rápido que una persona: si entre dos
    // pulsaciones pasan menos de este tiempo, es hardware, no un dedo.
    const MS_ENTRE_TECLAS_LECTOR = 35;
    const LARGO_MINIMO_CODIGO = 6;

    const CDN_HTML5_QRCODE =
        'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';

    const estado = {
        activo: false,
        escaner: null,
        ultimaTecla: 0,
        pareceLector: false,
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
        console.log('[Barcode] ' + tipo + ': ' + msg);
    }

    // ============================================
    // ARRANQUE
    // ============================================

    async function init() {
        try {
            const resp = await fetch(`${_api()}/products/barcode/estado`, {
                headers: { 'Authorization': `Bearer ${_token()}` },
            });
            if (!resp.ok) return;
            const s = await resp.json();
            if (!s.enabled) return;

            estado.activo = true;
            _montarBotonEscanear();
            _vigilarLector();
            console.log(`[Barcode] Activo — ${s.con_codigo}/${s.total} productos con código`);
        } catch (e) {
            // Sin flag o sin sesión: la caja sigue como siempre.
        }
    }

    // ============================================
    // RESOLUCIÓN DEL CÓDIGO
    // ============================================

    /**
     * Busca el código y lo agrega al carrito.
     * @returns {Promise<boolean>} true si encontró producto.
     */
    async function resolver(codigo) {
        const limpio = (codigo || '').trim();
        if (!limpio) return false;

        try {
            const resp = await fetch(
                `${_api()}/products/barcode/${encodeURIComponent(limpio)}`,
                { headers: { 'Authorization': `Bearer ${_token()}` } });

            if (resp.status === 404) {
                _toast(`Código ${limpio} no está registrado`, 'warning');
                _sugerirAlta(limpio);
                return false;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const p = await resp.json();
            _agregar(p);
            return true;

        } catch (e) {
            console.error('[Barcode] Error resolviendo:', e);
            _toast('No se pudo buscar el código', 'error');
            return false;
        }
    }

    function _agregar(p) {
        if (typeof addToCart !== 'function') {
            _toast('No se pudo agregar al carrito', 'error');
            return;
        }
        addToCart({
            id: p.id,
            name: p.name,
            sale_price: p.sale_price,
            unit: p.unit,
            stock: p.stock,
            code: p.barcode,
        });
        _toast(`${p.name}`, 'success');
        if (typeof playSound === 'function') playSound('success');

        const input = document.getElementById('search-input');
        if (input) input.value = '';
        const res = document.getElementById('search-results');
        if (res) res.style.display = 'none';
    }

    /**
     * Código desconocido: se avisa y se deja el foco listo para buscar
     * el producto por nombre, en vez de dejar al cajero sin salida.
     */
    function _sugerirAlta(codigo) {
        const input = document.getElementById('search-input');
        if (input) {
            input.value = '';
            input.placeholder = `Código ${codigo} sin asignar — busca el producto`;
            setTimeout(() => { input.placeholder = 'Buscar producto...'; }, 6000);
            input.focus();
        }
    }

    // ============================================
    // LECTOR FÍSICO
    // ============================================

    /**
     * Detecta la ráfaga de teclas de un lector y resuelve el código
     * directo, sin esperar a la lista de resultados.
     */
    function _vigilarLector() {
        const input = document.getElementById('search-input');
        if (!input) return;

        input.addEventListener('keydown', (e) => {
            const ahora = Date.now();
            if (e.key.length === 1) {
                estado.pareceLector = (ahora - estado.ultimaTecla) < MS_ENTRE_TECLAS_LECTOR;
                estado.ultimaTecla = ahora;
                return;
            }
            if (e.key !== 'Enter') return;

            const texto = input.value.trim();
            // Ráfaga de teclas + longitud de código = lector físico.
            if (estado.pareceLector && texto.length >= LARGO_MINIMO_CODIGO) {
                e.preventDefault();
                e.stopPropagation();
                resolver(texto);
                estado.pareceLector = false;
            }
        }, true);   // captura: corre antes del listener de Enter existente
    }

    // ============================================
    // CÁMARA
    // ============================================

    function _montarBotonEscanear() {
        if (document.getElementById('btn-escanear')) return;
        const cont = document.querySelector('.search-container');
        if (!cont) return;

        const btn = document.createElement('button');
        btn.id = 'btn-escanear';
        btn.type = 'button';
        btn.title = 'Escanear código';
        btn.onclick = abrirEscaner;
        btn.style.cssText =
            'background:transparent;border:none;color:#94a3b8;' +
            'font-size:17px;cursor:pointer;padding:0 10px;';
        btn.innerHTML = '<i class="fas fa-barcode"></i>';

        const mics = cont.querySelector('.mic-buttons');
        if (mics) cont.insertBefore(btn, mics);
        else cont.appendChild(btn);
    }

    function _cargarLibreria() {
        return new Promise((resolve, reject) => {
            if (window.Html5Qrcode) return resolve();
            const s = document.createElement('script');
            s.src = CDN_HTML5_QRCODE;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('No se pudo cargar el escáner'));
            document.head.appendChild(s);
        });
    }

    async function abrirEscaner() {
        // Sin getUserMedia no hay nada que intentar (http sin localhost,
        // navegador viejo, WebView limitado).
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return _sinCamara('Tu dispositivo no permite escanear');
        }

        try {
            await _cargarLibreria();
        } catch (e) {
            return _sinCamara('No se pudo cargar el escáner');
        }

        _modalEscaner();

        try {
            estado.escaner = new Html5Qrcode('lector-camara');
            await estado.escaner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 260, height: 160 } },
                (texto) => { _cerrarEscaner(); resolver(texto); },
                () => {}    // lecturas fallidas por fotograma: normal
            );
        } catch (e) {
            console.warn('[Barcode] Cámara denegada o no disponible:', e);
            _cerrarEscaner();
            _sinCamara('No se pudo abrir la cámara');
        }
    }

    function _sinCamara(motivo) {
        _toast(`${motivo}. Usa un lector o busca por nombre.`, 'warning');
        const input = document.getElementById('search-input');
        if (input) input.focus();
    }

    function _modalEscaner() {
        let m = document.getElementById('modal-escaner');
        if (m) m.remove();

        m = document.createElement('div');
        m.id = 'modal-escaner';
        m.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.92);' +
            'z-index:999999;display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;padding:16px';
        m.innerHTML = `
            <div style="color:#fff;font-size:15px;font-weight:600;margin-bottom:12px">
                Apunta al código de barras
            </div>
            <div id="lector-camara" style="width:100%;max-width:380px;
                 border-radius:14px;overflow:hidden;background:#000"></div>
            <button onclick="BarcodeVenta.cerrarEscaner()"
                style="margin-top:16px;padding:13px 30px;border:none;border-radius:10px;
                       background:rgba(255,255,255,.12);color:#fff;font-size:15px;
                       font-weight:600;cursor:pointer;font-family:inherit">
                Cancelar
            </button>`;
        document.body.appendChild(m);
    }

    function _cerrarEscaner() {
        if (estado.escaner) {
            estado.escaner.stop()
                .then(() => estado.escaner.clear())
                .catch(() => {})
                .finally(() => { estado.escaner = null; });
        }
        const m = document.getElementById('modal-escaner');
        if (m) m.remove();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1000);
    }

    return { init, resolver, abrirEscaner, cerrarEscaner: _cerrarEscaner };
})();

window.BarcodeVenta = BarcodeVenta;
