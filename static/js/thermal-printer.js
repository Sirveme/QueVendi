/**
 * QueVendi — ESC/POS Thermal Printer via WebUSB
 * ================================================
 * Imprime directo a impresoras térmicas POS-80 sin diálogo.
 * 
 * Características:
 *   - Conexión directa WebUSB (Chrome 61+)
 *   - Comandos ESC/POS nativos (negritas, centrado, tamaños)
 *   - Tildes y ñ correctas (codepage PC858 / Latin-1)
 *   - Corte automático de papel
 *   - Sin drivers del sistema
 *   - Sin diálogo de impresión
 *   - Impresión instantánea
 * 
 * Uso:
 *   await ThermalPrinter.connect();     // Pide permiso USB (una vez)
 *   await ThermalPrinter.printTicket(comprobanteData);
 *   await ThermalPrinter.testPrint();   // Página de prueba
 * 
 * Compatible: Chrome, Edge (Chromium), Opera — NO Firefox, NO Safari
 */

const ThermalPrinter = (() => {

    // ============================================
    // ESTADO
    // ============================================

    let _device = null;
    let _interface = null;
    let _endpoint = null;
    let _connected = false;

    // POS-8370 USB IDs (y compatibles genéricos)
    const KNOWN_VENDORS = [
        { vendorId: 0x0416, productId: 0x5011 },  // POS-8370
        { vendorId: 0x0483, productId: 0x5743 },  // POS-80 genérico
        { vendorId: 0x0493, productId: 0x8760 },  // Epson compatible
        { vendorId: 0x04B8, productId: 0x0202 },  // Epson TM series
        { vendorId: 0x1FC9, productId: 0x2016 },  // Xprinter
    ];

    // ============================================
    // ESC/POS COMMANDS
    // ============================================

    const ESC = 0x1B;
    const GS  = 0x1D;
    const LF  = 0x0A;

    const CMD = {
        INIT:           [ESC, 0x40],                    // Inicializar impresora
        LF:             [LF],                           // Salto de línea
        CUT:            [GS, 0x56, 0x41, 0x03],         // Corte parcial (3 líneas de avance)
        CUT_FULL:       [GS, 0x56, 0x00],               // Corte total

        // Alineación
        ALIGN_LEFT:     [ESC, 0x61, 0x00],
        ALIGN_CENTER:   [ESC, 0x61, 0x01],
        ALIGN_RIGHT:    [ESC, 0x61, 0x02],

        // Negrita
        BOLD_ON:        [ESC, 0x45, 0x01],
        BOLD_OFF:       [ESC, 0x45, 0x00],

        // Tamaño de texto
        SIZE_NORMAL:    [GS, 0x21, 0x00],               // 1x1
        SIZE_DOUBLE_H:  [GS, 0x21, 0x01],               // 2x alto
        SIZE_DOUBLE_W:  [GS, 0x21, 0x10],               // 2x ancho
        SIZE_DOUBLE:    [GS, 0x21, 0x11],               // 2x2

        // Subrayado
        UNDERLINE_ON:   [ESC, 0x2D, 0x01],
        UNDERLINE_OFF:  [ESC, 0x2D, 0x00],

        // Codepage para caracteres españoles
        // PC858 = Western European con € y tildes
        CODEPAGE_PC858: [ESC, 0x74, 0x13],
        // PC437 = US con algunos especiales
        CODEPAGE_PC437: [ESC, 0x74, 0x00],
        // Latin-1 (ISO 8859-1)
        CODEPAGE_LATIN1:[ESC, 0x74, 0x10],
        // Windows 1252
        CODEPAGE_WIN1252:[ESC, 0x74, 0x10],

        // Interlineado
        LINE_SPACING_DEFAULT: [ESC, 0x32],
        LINE_SPACING_SET:     [ESC, 0x33],               // + 1 byte (n dots)

        // Modo carácter internacional: España
        CHARSET_SPAIN:  [ESC, 0x52, 0x07],
    };

    // ============================================
    // MAPA DE CARACTERES ESPAÑOL → PC858/Latin-1
    // ============================================

    const CHAR_MAP = {
        'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
        'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
        'ñ': 0xA4, 'Ñ': 0xA5,
        'ü': 0x81, 'Ü': 0x9A,
        '¿': 0xA8, '¡': 0xAD,
        '°': 0xF8,
        '€': 0xD5,
        '©': 0xB8,
    };

    // ============================================
    // CONEXIÓN WebUSB
    // ============================================

    /**
     * Conectar a la impresora USB.
     * Pide permiso al usuario (gesto requerido: click).
     * @returns {Promise<boolean>}
     */
    async function connect() {
        if (_connected && _device) return true;

        if (!navigator.usb) {
            throw new Error('WebUSB no soportado. Usa Chrome o Edge.');
        }

        try {
            // Pedir permiso — muestra diálogo de selección USB
            _device = await navigator.usb.requestDevice({
                filters: KNOWN_VENDORS
            });

            await _device.open();

            // Buscar la interfaz de impresora
            const config = _device.configuration;
            if (!config) {
                await _device.selectConfiguration(1);
            }

            // Buscar interfaz con endpoint bulk OUT
            for (const iface of _device.configuration.interfaces) {
                for (const alt of iface.alternates) {
                    for (const ep of alt.endpoints) {
                        if (ep.direction === 'out' && ep.type === 'bulk') {
                            _interface = iface;
                            _endpoint = ep;
                            break;
                        }
                    }
                    if (_endpoint) break;
                }
                if (_endpoint) break;
            }

            if (!_endpoint) {
                throw new Error('No se encontró endpoint de impresión');
            }

            await _device.claimInterface(_interface.interfaceNumber);

            _connected = true;
            console.log(`[ThermalPrinter] ✅ Conectado: ${_device.productName || 'POS80'} (endpoint ${_endpoint.endpointNumber})`);

            return true;

        } catch (error) {
            _connected = false;
            if (error.name === 'NotFoundError') {
                throw new Error('No se seleccionó impresora. Intenta de nuevo.');
            }
            throw error;
        }
    }

    /**
     * Reconectar automáticamente si ya teníamos permiso
     */
    async function autoReconnect() {
        if (_connected) return true;
        if (!navigator.usb) return false;

        try {
            const devices = await navigator.usb.getDevices();
            if (devices.length > 0) {
                _device = devices[0];
                await _device.open();

                const config = _device.configuration;
                if (!config) await _device.selectConfiguration(1);

                for (const iface of _device.configuration.interfaces) {
                    for (const alt of iface.alternates) {
                        for (const ep of alt.endpoints) {
                            if (ep.direction === 'out' && ep.type === 'bulk') {
                                _interface = iface;
                                _endpoint = ep;
                            }
                        }
                    }
                }

                if (_endpoint) {
                    await _device.claimInterface(_interface.interfaceNumber);
                    _connected = true;
                    console.log(`[ThermalPrinter] ✅ Reconectado: ${_device.productName || 'POS80'}`);
                    return true;
                }
            }
        } catch (e) {
            console.warn('[ThermalPrinter] Auto-reconnect falló:', e.message);
        }
        return false;
    }

    function isConnected() { return _connected; }

    async function disconnect() {
        if (_device) {
            try {
                await _device.releaseInterface(_interface.interfaceNumber);
                await _device.close();
            } catch (e) {}
            _device = null;
            _endpoint = null;
            _connected = false;
            console.log('[ThermalPrinter] Desconectado');
        }
    }

    // ============================================
    // ENVÍO DE DATOS
    // ============================================

    async function _send(data) {
        if (!_connected || !_device || !_endpoint) {
            throw new Error('Impresora no conectada');
        }

        const buffer = new Uint8Array(data);

        // Enviar en chunks de 64 bytes (límite USB bulk)
        const CHUNK = 64;
        for (let i = 0; i < buffer.length; i += CHUNK) {
            const chunk = buffer.slice(i, i + CHUNK);
            await _device.transferOut(_endpoint.endpointNumber, chunk);
        }
    }

    // ============================================
    // CODIFICACIÓN DE TEXTO
    // ============================================

    /**
     * Convierte texto español a bytes PC858/compatible.
     * Maneja á, é, í, ó, ú, ñ, Ñ, ¿, ¡
     */
    function _encodeText(text) {
        const bytes = [];
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (CHAR_MAP[ch] !== undefined) {
                bytes.push(CHAR_MAP[ch]);
            } else {
                const code = ch.charCodeAt(0);
                bytes.push(code <= 0xFF ? code : 0x3F); // '?' para no reconocidos
            }
        }
        return bytes;
    }

    // ============================================
    // BUILDER — API FLUIDA
    // ============================================

    class TicketBuilder {
        constructor() {
            this.buffer = [];
            // Init + codepage español
            this.raw(CMD.INIT);
            this.raw(CMD.CODEPAGE_PC858);
            this.raw(CMD.CHARSET_SPAIN);
            this.raw(CMD.LINE_SPACING_DEFAULT);
        }

        raw(bytes) {
            this.buffer.push(...bytes);
            return this;
        }

        // Texto
        text(str) {
            this.buffer.push(..._encodeText(str));
            return this;
        }

        // Salto de línea
        nl(n = 1) {
            for (let i = 0; i < n; i++) this.raw(CMD.LF);
            return this;
        }

        // Línea completa (texto + salto)
        line(str) {
            return this.text(str).nl();
        }

        // Alineación
        center() { return this.raw(CMD.ALIGN_CENTER); }
        left()   { return this.raw(CMD.ALIGN_LEFT); }
        right()  { return this.raw(CMD.ALIGN_RIGHT); }

        // Negrita
        bold(on = true) { return this.raw(on ? CMD.BOLD_ON : CMD.BOLD_OFF); }

        // Tamaños
        sizeNormal()  { return this.raw(CMD.SIZE_NORMAL); }
        sizeDouble()  { return this.raw(CMD.SIZE_DOUBLE); }
        sizeDoubleH() { return this.raw(CMD.SIZE_DOUBLE_H); }
        sizeDoubleW() { return this.raw(CMD.SIZE_DOUBLE_W); }

        // Tamaño personalizado (ancho 1-8, alto 1-8)
        size(w, h) {
            const val = ((w - 1) << 4) | (h - 1);
            return this.raw([GS, 0x21, val]);
        }

        // Subrayado
        underline(on = true) { return this.raw(on ? CMD.UNDERLINE_ON : CMD.UNDERLINE_OFF); }

        // Línea separadora
        separator(char = '-', width = 48) {
            return this.line(char.repeat(width));
        }

        // Separador punteado
        dashes(width = 48) {
            return this.separator('-', width);
        }

        dots(width = 48) {
            return this.separator('.', width);
        }

        // Línea con texto izq y derecha (formato tabla)
        columns(left, right, width = 48) {
            const spaces = width - left.length - right.length;
            const gap = spaces > 0 ? ' '.repeat(spaces) : ' ';
            return this.line(left + gap + right);
        }

        // Línea con 3 columnas
        columns3(c1, c2, c3, w1 = 24, w2 = 10, w3 = 14) {
            const s1 = c1.substring(0, w1).padEnd(w1);
            const s2 = c2.substring(0, w2).padEnd(w2);
            const s3 = c3.substring(0, w3).padStart(w3);
            return this.line(s1 + s2 + s3);
        }

        // Línea con 4 columnas (Cant Unid Precio Total)
        columns4(c1, c2, c3, c4) {
            const s = `${c1.padEnd(24)}${c2.padStart(5)} ${c3.padStart(5)} ${c4.padStart(8)}`;
            return this.line(s);
        }

        // Línea con 5 columnas (Producto Cant Unid Precio Total)
        row5(prod, cant, unid, precio, total) {
            const s = `${prod.substring(0, 22).padEnd(22)} ${cant.padStart(4)} ${unid.padEnd(4)} ${precio.padStart(7)} ${total.padStart(7)}`;
            return this.line(s);
        }

        // Avance de papel
        feed(lines = 3) {
            return this.raw([ESC, 0x64, lines]);
        }

        // Corte de papel
        cut(partial = true) {
            this.feed(3);
            return this.raw(partial ? CMD.CUT : CMD.CUT_FULL);
        }

        // QR Code (impresoras que soportan GS (k) — la mayoría POS-80)
        qr(data, size = 6) {
            const dataBytes = _encodeText(data);
            const len = dataBytes.length + 3;
            const pL = len % 256;
            const pH = Math.floor(len / 256);

            return this
                // Modelo QR: Model 2
                .raw([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
                // Tamaño módulo (1-16, default 3)
                .raw([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size])
                // Error correction: L=48, M=49, Q=50, H=51
                .raw([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 49])
                // Almacenar datos
                .raw([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30])
                .raw(dataBytes)
                // Imprimir QR
                .raw([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
        }

        // Obtener bytes finales
        build() {
            return new Uint8Array(this.buffer);
        }

        // Enviar a impresora
        async print() {
            await _send(this.buffer);
        }
    }

    function ticket() {
        return new TicketBuilder();
    }

    // ============================================
    // IMPRIMIR TICKET DE COMPROBANTE
    // ============================================

    /**
     * Imprime un ticket de comprobante electrónico completo.
     * @param {Object} data - Datos del comprobante
     */
    async function printTicket(data) {
        if (!_connected) {
            const reconnected = await autoReconnect();
            if (!reconnected) throw new Error('Impresora no conectada. Usa ThermalPrinter.connect()');
        }

        const e = data.emisor || {};
        const c = data.cliente || {};
        const items = data.items || [];

        const tipoNombre = data.tipo === '01' ? 'FACTURA ELECTRÓNICA' :
                           data.tipo === '07' ? 'NOTA DE CRÉDITO' :
                           'BOLETA DE VENTA ELECTRÓNICA';

        const t = ticket();

        // ── HEADER: EMISOR ──
        t.center().bold().sizeDoubleW()
         .line(e.nombre_comercial || e.razon_social || 'MI NEGOCIO')
         .sizeNormal().bold(false);

        if (e.direccion) t.center().line(e.direccion);

        let contacto = '';
        if (e.telefono) contacto += `Teléfono: ${e.telefono}`;
        if (e.email) contacto += (contacto ? '  ' : '') + e.email;
        if (contacto) t.center().line(contacto);

        t.nl();

        // ── RUC ──
        t.center().bold().sizeDoubleH()
         .line(`RUC: ${e.ruc || ''}`)
         .sizeNormal().bold(false);

        t.dashes();

        // ── TIPO DOCUMENTO ──
        t.center().bold()
         .line(tipoNombre)
         .sizeDoubleH()
         .line(data.numero_formato || '')
         .sizeNormal().bold(false);

        t.nl();

        // ── FECHA / FORMA PAGO ──
        t.left();
        const formaPago = data.is_credit ? 'Crédito' : 'Contado';
        t.columns(`Fecha: ${data.fecha || ''}  Hora: ${data.hora || ''}`, `F. Pago: ${formaPago}`);

        t.dashes();

        // ── CLIENTE ──
        const tipoDocLabel = c.tipo_doc === '6' ? 'RUC' : c.tipo_doc === '1' ? 'DNI' : 'Doc';

        t.bold().line('CLIENTE:').bold(false);
        t.line(`${tipoDocLabel}: ${c.num_doc || '-'}`);
        t.line(`Nombre: ${(c.nombre || 'CLIENTE VARIOS').substring(0, 38)}`);
        if (c.direccion && c.direccion !== '-') {
            t.line(`Dirección: ${c.direccion.substring(0, 35)}`);
        }

        t.dashes();

        // ── TABLA DE ITEMS ──
        t.bold()
         .row5('Producto', 'Cant', 'Unid', 'Precio', 'Total')
         .bold(false);

        for (const item of items) {
            const cant = item.cantidad % 1 === 0
                ? String(item.cantidad)
                : item.cantidad.toFixed(2);
            const precio = item.precio_unitario.toFixed(2);
            const total = (item.cantidad * item.precio_unitario).toFixed(2);
            const unid = (item.unidad || 'NIU').substring(0, 4);

            t.row5(
                (item.descripcion || '').substring(0, 22),
                cant, unid, precio, total
            );
        }

        t.dashes();

        // ── TOTALES ──
        if (data.op_exonerada > 0) t.columns('Op. Exonerada:', `S/ ${data.op_exonerada.toFixed(2)}`);
        if (data.op_gravada > 0)   t.columns('Op. Gravada:', `S/ ${data.op_gravada.toFixed(2)}`);
        if (data.igv > 0)          t.columns('IGV 18%:', `S/ ${data.igv.toFixed(2)}`);

        t.bold().sizeDoubleH()
         .columns('TOTAL:', `S/ ${data.total.toFixed(2)}`)
         .sizeNormal().bold(false);

        t.nl();

        // ── FORMA DE PAGO ──
        const pagos = { efectivo:'Efectivo', yape:'Yape', plin:'Plin', tarjeta:'Tarjeta', fiado:'Crédito' };
        t.line(`Forma de pago: ${pagos[data.payment_method] || data.payment_method || 'Efectivo'}`);

        // ── IMPORTE EN LETRAS ──
        if (data.importe_letras) {
            t.line(`[son: ${data.importe_letras}]`);
        }

        t.nl();

        // ── CATÁLOGO VIRTUAL ──
        if (e.telefono) {
            t.dashes();
            t.center().bold()
             .line('HAZ TUS PEDIDOS EN LÍNEA GRATIS')
             .sizeDoubleH()
             .line(`QUEVENDI.PRO/${e.telefono}`)
             .sizeNormal()
             .line('PARA RECOJOS O DELIVERY')
             .bold(false);
        }

        t.nl();

        // ── QR CODE ──
        const qrData = `${e.ruc}|${data.tipo}|${data.serie}|${data.numero}|${(data.igv || 0).toFixed(2)}|${data.total.toFixed(2)}|${data.fecha_iso || ''}|${c.tipo_doc || '0'}|${c.num_doc || ''}|`;

        t.center()
         .qr(qrData, 5)
         .nl();

        // ── VERIFICACIÓN ──
        t.center()
         .line('Representación impresa de la')
         .line(tipoNombre + '.')
         .nl()
         .line('Verifique en:')
         .bold().line('https://facturalo.pro/verificar').bold(false)
         .line('o en https://sunat.gob.pe');

        // ── HASH ──
        if (data.hash) {
            t.nl().left().line(`Resumen: ${data.hash}`);
        }

        // ── CÓDIGO INTERNO ──
        if (data.verification_code) {
            t.line(`Interno: ${data.verification_code}`);
        }

        // ── LEYENDA AMAZONÍA ──
        if (data.es_amazonia) {
            t.nl().dashes()
             .center().bold()
             .line('"BIENES TRANSFERIDOS EN LA AMAZONÍA')
             .line('PARA SER CONSUMIDOS EN LA MISMA"')
             .bold(false);
        }

        t.nl();

        // ── FOOTER ──
        t.dashes();
        t.center()
         .line('Sistema de Ventas:')
         .bold().line('https://quevendi.pro').bold(false)
         .line('Usado en todo el Perú')
         .nl()
         .line('Sistema de Facturación:')
         .bold().line('https://facturalo.pro').bold(false)
         .line('Preferido por Contadores y Empresas')
         .nl()
         .line('El favorito de los bodegueros');

        // ── CORTE ──
        t.cut();

        // ── ENVIAR ──
        await t.print();

        console.log(`[ThermalPrinter] ✅ Ticket impreso: ${data.numero_formato}`);
    }

    // ============================================
    // PÁGINA DE PRUEBA
    // ============================================

    async function testPrint() {
        if (!_connected) {
            const reconnected = await autoReconnect();
            if (!reconnected) throw new Error('Impresora no conectada');
        }

        const t = ticket();

        t.center().bold().sizeDouble()
         .line('PRUEBA POS-80')
         .sizeNormal().bold(false)
         .nl();

        t.dashes();

        t.center()
         .line('Tildes: á é í ó ú')
         .line('Ñ: Amazonía Electrónica')
         .line('¿Funciona? ¡Sí!')
         .nl();

        t.dashes();

        t.left()
         .bold().line('Negrita activa').bold(false)
         .line('Normal')
         .underline().line('Subrayado').underline(false)
         .nl();

        t.left()
         .columns('Izquierda', 'Derecha')
         .columns('Cemento Sol 42.5kg', 'S/ 32.00')
         .columns('TOTAL:', 'S/ 64.00')
         .nl();

        t.center()
         .bold().sizeDoubleH()
         .line('S/ 64.00')
         .sizeNormal().bold(false)
         .nl();

        t.center().line('QR Code:').nl();
        t.qr('https://quevendi.pro', 5).nl();

        t.dashes();

        t.center()
         .line('QueVendi.pro')
         .line('Impresión directa ESC/POS')
         .line(new Date().toLocaleString('es-PE'))
         .nl();

        t.cut();
        await t.print();

        console.log('[ThermalPrinter] ✅ Página de prueba impresa');
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    return {
        connect,
        autoReconnect,
        disconnect,
        isConnected,
        ticket,         // Builder para tickets custom
        printTicket,    // Imprime comprobante completo
        testPrint,      // Página de prueba
    };

})();

window.ThermalPrinter = ThermalPrinter;
console.log('[ThermalPrinter] 🖨️ Módulo ESC/POS cargado');