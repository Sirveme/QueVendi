/**
 * QueVendi — Offline Billing Module
 * ===================================
 * Genera comprobantes electrónicos REALES sin internet.
 * 
 * Flujo:
 *   1. Owner registra dispositivo → recibe serie (B001)
 *   2. Reserva bloque de correlativos (B001: 1-50)
 *   3. Al vender offline, toma siguiente número de IndexedDB
 *   4. Genera ticket HTML completo con QR → imprime directo
 *   5. Encola comprobante para envío a Facturalo/SUNAT cuando haya internet
 * 
 * Dependencias:
 *   - OfflineDB (offline-db.js) — para correlatives store
 *   - OfflineSync (offline-sync.js) — para detectar conectividad
 * 
 * Uso:
 *   await OfflineBilling.init();
 *   const result = await OfflineBilling.emitirLocal(saleData, 'boleta');
 *   // result = { serie: "B001", numero: 42, numero_formato: "B001-00000042", printed: true }
 */

const OfflineBilling = (() => {

    // ============================================
    // CONFIG
    // ============================================

    let _config = {
        apiBase: '',
        // Datos del emisor (se cargan del servidor o localStorage)
        emisor: {
            ruc: '',
            razon_social: '',
            nombre_comercial: '',
            direccion: '',
            telefono: '',
            email: ''
        },
        // Serie asignada a este dispositivo
        serie_boleta: null,
        serie_factura: null,
        device_id: null,
        // Mínimo de correlativos restantes para pedir más
        min_remaining: 10,
        // Afectación IGV (20=Exonerado para Amazonía, 10=Gravado)
        tipo_afectacion_igv: '20',
        // Ticket width
        ticketWidth: '80mm',
        // Es Amazonía
        es_amazonia: true,
    };

    let _initialized = false;
    let _registered = false;

    // ============================================
    // INICIALIZACIÓN
    // ============================================

    async function init() {
        if (_initialized) return;

        _config.apiBase = `${window.location.origin}/api/v1`;
        _config.device_id = await OfflineDB.meta.getDeviceId();

        // Cargar datos del emisor desde localStorage/servidor
        _loadEmisorData();

        // Cargar serie asignada (si existe)
        const savedSerie = await OfflineDB.meta.get('billing_serie_boleta');
        if (savedSerie) {
            _config.serie_boleta = savedSerie.value;
            _registered = true;
        }

        const savedSerieF = await OfflineDB.meta.get('billing_serie_factura');
        if (savedSerieF) _config.serie_factura = savedSerieF.value;

        // Cargar config de afectación IGV
        const savedIgv = await OfflineDB.meta.get('billing_tipo_afectacion');
        if (savedIgv) _config.tipo_afectacion_igv = savedIgv.value;

        _initialized = true;

        // Verificar si necesitamos más correlativos
        await _checkAndRefillBlock();

        console.log(`[OfflineBilling] ✅ Listo. Serie: ${_config.serie_boleta || 'NO REGISTRADO'}, Device: ${_config.device_id}`);
    }

    function _loadEmisorData() {
        _config.emisor.ruc = localStorage.getItem('emisor_ruc') || '';
        _config.emisor.razon_social = localStorage.getItem('emisor_razon_social') || localStorage.getItem('store_name') || '';
        _config.emisor.nombre_comercial = localStorage.getItem('emisor_nombre_comercial') || _config.emisor.razon_social;
        _config.emisor.direccion = localStorage.getItem('emisor_direccion') || '';
        _config.emisor.telefono = localStorage.getItem('emisor_telefono') || '';
        _config.emisor.email = localStorage.getItem('emisor_email') || '';
    }

    // ============================================
    // REGISTRO DE DISPOSITIVO
    // ============================================

    /**
     * Registrar este dispositivo con el servidor.
     * Requiere internet. El owner lo hace una vez.
     * @param {string} deviceName - Nombre descriptivo ("Celular Juan", "Caja 1")
     */
    async function registerDevice(deviceName = '') {
        const token = _getToken();
        if (!token) throw new Error('No autenticado');

        const resp = await fetch(`${_config.apiBase}/billing/offline/device/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                device_id: _config.device_id,
                device_name: deviceName || `Dispositivo ${_config.device_id}`,
                tipo: '03'  // Boleta por defecto
            })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `Error ${resp.status}`);
        }

        const data = await resp.json();
        _config.serie_boleta = data.serie;
        _registered = true;

        // Guardar en IndexedDB
        await OfflineDB.meta.set('billing_serie_boleta', data.serie);
        await OfflineDB.meta.set('billing_device_name', deviceName);

        // Reservar primer bloque
        await reserveBlock(data.serie);

        console.log(`[OfflineBilling] ✅ Registrado: ${data.serie}`);
        return data;
    }

    // ============================================
    // RESERVAR BLOQUE DE CORRELATIVOS
    // ============================================

    /**
     * Pedir un bloque de números al servidor.
     * Se guardan en IndexedDB para uso offline.
     */
    async function reserveBlock(serie = null, cantidad = 50) {
        serie = serie || _config.serie_boleta;
        if (!serie) throw new Error('Sin serie asignada. Registra el dispositivo primero.');

        const token = _getToken();
        if (!token) throw new Error('No autenticado');

        const resp = await fetch(`${_config.apiBase}/billing/offline/reserve-block`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                serie: serie,
                device_id: _config.device_id,
                cantidad: cantidad
            })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `Error ${resp.status}`);
        }

        const data = await resp.json();

        // Guardar bloque en IndexedDB
        await OfflineDB.correlatives.saveBlock(serie, data.desde, data.hasta);

        console.log(`[OfflineBilling] 📦 Bloque: ${serie} ${data.desde}-${data.hasta} (${data.cantidad} números)`);
        return data;
    }

    /**
     * Verificar si quedan suficientes correlativos y pedir más si necesario
     */
    async function _checkAndRefillBlock() {
        if (!_config.serie_boleta || !_registered) return;

        const remaining = await OfflineDB.correlatives.getRemaining(_config.serie_boleta);

        if (remaining < _config.min_remaining) {
            // Intentar pedir más si hay internet
            const online = typeof OfflineSync !== 'undefined' ? OfflineSync.isOnline() : navigator.onLine;
            if (online) {
                try {
                    await reserveBlock(_config.serie_boleta);
                } catch (e) {
                    console.warn(`[OfflineBilling] No se pudo refill: ${e.message}`);
                }
            } else {
                console.warn(`[OfflineBilling] ⚠️ Quedan ${remaining} correlativos y no hay internet`);
            }
        }
    }

    // ============================================
    // EMISIÓN LOCAL (OFFLINE)
    // ============================================

    /**
     * Emitir un comprobante localmente.
     * NO necesita internet. Toma número de IndexedDB.
     * @param {Object} saleData - Datos de la venta (items, total, payment_method, etc.)
     * @param {string} tipo - "boleta" o "factura"
     * @param {Object} cliente - {tipo_doc, num_doc, nombre, direccion}
     * @returns {Object} - {serie, numero, numero_formato, printed}
     */
    async function emitirLocal(saleData, tipo = 'boleta', cliente = null) {
        if (!_initialized) await init();

        const serie = tipo === 'factura' ? _config.serie_factura : _config.serie_boleta;
        if (!serie) {
            throw new Error('Dispositivo no registrado. Configura facturación offline en Ajustes.');
        }

        // 1. Obtener siguiente número
        const next = await OfflineDB.correlatives.getNext(serie);
        if (!next) {
            throw new Error(`Sin números disponibles para ${serie}. Conéctate a internet para reservar más.`);
        }

        const { correlativo } = next;
        const numero_formato = `${serie}-${String(correlativo).zfill(8)}`;

        // 2. Datos del comprobante
        const ahora = new Date();
        const clienteData = cliente || {
            tipo_doc: '0',
            num_doc: '00000000',
            nombre: 'CLIENTE VARIOS',
            direccion: ''
        };

        const comprobante = {
            serie: serie,
            numero: correlativo,
            numero_formato: numero_formato,
            tipo: tipo === 'factura' ? '01' : '03',
            tipo_nombre: tipo === 'factura' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA',
            fecha: ahora.toLocaleDateString('es-PE'),
            hora: ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
            fecha_iso: ahora.toISOString().split('T')[0],
            hora_iso: ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            emisor: { ..._config.emisor },
            cliente: clienteData,
            items: saleData.items.map(item => ({
                descripcion: item.product_name || item.name || `Producto #${item.product_id}`,
                cantidad: parseFloat(item.quantity),
                unidad: item.unit || 'NIU',
                precio_unitario: parseFloat(item.unit_price || item.price),
                subtotal: parseFloat(item.subtotal || (item.quantity * (item.unit_price || item.price)))
            })),
            total: parseFloat(saleData.total),
            payment_method: saleData.payment_method || 'efectivo',
            is_credit: saleData.is_credit || false,
            es_amazonia: _config.es_amazonia,
            telefono_emisor: _config.emisor.telefono,
            verification_code: saleData.verification_code || null,
        };

        // 3. Calcular totales
        const total = comprobante.total;
        if (_config.tipo_afectacion_igv === '10') {
            comprobante.op_gravada = +(total / 1.18).toFixed(2);
            comprobante.igv = +(total - comprobante.op_gravada).toFixed(2);
            comprobante.op_exonerada = 0;
        } else {
            comprobante.op_gravada = 0;
            comprobante.igv = 0;
            comprobante.op_exonerada = total;
        }

        // 4. Generar importe en letras
        comprobante.importe_letras = _numeroALetras(total);

        // 5. Generar ticket HTML
        const ticketHtml = _generateTicketHtml(comprobante);

        // 6. Imprimir
        _printHtml(ticketHtml);

        // 7. Encolar para sync con Facturalo/SUNAT
        await _queueForSync(comprobante, saleData);

        // 8. Verificar si necesitamos más correlativos
        await _checkAndRefillBlock();

        console.log(`[OfflineBilling] ✅ Emitido: ${numero_formato} (S/ ${total.toFixed(2)})`);

        return {
            serie: serie,
            numero: correlativo,
            numero_formato: numero_formato,
            total: total,
            printed: true
        };
    }

    // ============================================
    // GENERADOR DE TICKET HTML (sin servidor)
    // ============================================

    function _generateTicketHtml(comp) {
        const e = comp.emisor;
        const c = comp.cliente;
        const w = _config.ticketWidth;

        // QR data (formato SUNAT estándar)
        const qrData = `${e.ruc}|${comp.tipo}|${comp.serie}|${comp.numero}|${comp.igv.toFixed(2)}|${comp.total.toFixed(2)}|${comp.fecha_iso}|${c.tipo_doc}|${c.num_doc}|`;

        // Items HTML
        const itemsHtml = comp.items.map(item => {
            const total = (item.cantidad * item.precio_unitario).toFixed(2);
            return `<tr>
                <td style="text-align:left;font-size:9px;font-weight:bold;padding:1px 0">${_esc(item.descripcion)}</td>
                <td style="text-align:center;font-size:9px;padding:1px 2px">${item.cantidad % 1 === 0 ? item.cantidad : item.cantidad.toFixed(2)}</td>
                <td style="text-align:center;font-size:8px;padding:1px 2px">${item.unidad}</td>
                <td style="text-align:right;font-size:9px;padding:1px 0">${item.precio_unitario.toFixed(2)}</td>
                <td style="text-align:right;font-size:9px;padding:1px 0">${total}</td>
            </tr>`;
        }).join('');

        // Método de pago label
        const pagos = { efectivo:'Efectivo', yape:'Yape', plin:'Plin', tarjeta:'Tarjeta', fiado:'Crédito' };
        const pagoLabel = pagos[comp.payment_method] || comp.payment_method;

        // Totales
        let totalesHtml = '';
        if (comp.op_exonerada > 0) totalesHtml += `<div class="tot-row"><span>Op. Exonerada:</span><span>S/ ${comp.op_exonerada.toFixed(2)}</span></div>`;
        if (comp.op_gravada > 0) totalesHtml += `<div class="tot-row"><span>Op. Gravada:</span><span>S/ ${comp.op_gravada.toFixed(2)}</span></div>`;
        if (comp.igv > 0) totalesHtml += `<div class="tot-row"><span>IGV 18%:</span><span>S/ ${comp.igv.toFixed(2)}</span></div>`;

        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Ticket ${comp.numero_formato}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;width:${w};padding:3mm;color:#000;font-size:10px}
.center{text-align:center}
.bold{font-weight:bold}
.divider{border-top:1px dashed #000;margin:4px 0}
.ruc{font-size:12px;font-weight:bold;text-align:center;margin:4px 0}
.tipo{font-size:10px;font-weight:bold;text-align:center}
.serie{font-size:13px;font-weight:bold;text-align:center;margin:2px 0}
table{width:100%;border-collapse:collapse}
th{font-size:8px;text-align:left;border-bottom:1px solid #000;padding:2px 0}
.tot-row{display:flex;justify-content:space-between;font-size:9px;padding:1px 0}
.total-big{display:flex;justify-content:space-between;font-size:12px;font-weight:bold;margin:3px 0}
.letras{font-size:8px;text-align:center;margin:3px 0}
.catalogo{border:1.5px solid #4a90d9;border-radius:3px;padding:4px;margin:5px 0;text-align:center}
.catalogo-url{font-size:10px;font-weight:bold;color:#4a90d9}
.qr-section{display:flex;gap:3mm;align-items:flex-start;margin:5px 0}
.qr-section img{width:18mm;height:18mm}
.qr-text{font-size:7px;color:#555;flex:1}
.footer{text-align:center;font-size:7px;color:#555;margin-top:5px}
.amazonia{text-align:center;font-weight:bold;font-size:8px;margin:5px 0}
@media print{body{width:auto;padding:0}}
</style>
</head><body>

<!-- EMISOR -->
<div class="center bold" style="font-size:12px">${_esc(e.nombre_comercial || e.razon_social)}</div>
<div class="center" style="font-size:8px;color:#333">${_esc(e.direccion)}</div>
${e.telefono ? `<div class="center" style="font-size:8px;color:#333">Tel: ${e.telefono}${e.email ? '  ' + e.email : ''}</div>` : ''}

<div class="ruc">RUC: ${e.ruc}</div>
<div class="divider"></div>

<!-- TIPO DOCUMENTO -->
<div class="tipo">${comp.tipo_nombre}</div>
<div class="serie">${comp.numero_formato}</div>

<div style="display:flex;justify-content:space-between;font-size:8px;color:#555">
    <span>Fecha: ${comp.fecha}  Hora: ${comp.hora}</span>
    <span>F. Pago: ${comp.is_credit ? 'Crédito' : 'Contado'}</span>
</div>
<div class="divider"></div>

<!-- CLIENTE -->
<div style="font-size:9px;margin:3px 0">
<div class="bold">CLIENTE:</div>
<div>${c.tipo_doc === '6' ? 'RUC' : c.tipo_doc === '1' ? 'DNI' : 'Doc'}: ${c.num_doc || '-'}</div>
<div>Nombre: ${_esc((c.nombre || 'CLIENTE VARIOS').substring(0, 35))}</div>
${c.direccion ? `<div>Dirección: ${_esc(c.direccion.substring(0, 35))}</div>` : ''}
</div>
<div class="divider"></div>

<!-- ITEMS -->
<table>
<thead><tr>
    <th style="text-align:left">Producto</th>
    <th style="text-align:center">Cant</th>
    <th style="text-align:center">Unid</th>
    <th style="text-align:right">Precio</th>
    <th style="text-align:right">Total</th>
</tr></thead>
<tbody>${itemsHtml}</tbody>
</table>
<div class="divider"></div>

<!-- TOTALES -->
${totalesHtml}
<div class="total-big"><span>TOTAL:</span><span>S/ ${comp.total.toFixed(2)}</span></div>
<div style="font-size:8px">Forma de pago: ${pagoLabel}</div>
<div class="letras">[son: ${comp.importe_letras}]</div>

${comp.telefono_emisor ? `
<!-- CATÁLOGO VIRTUAL -->
<div class="catalogo">
    <div style="font-size:8px;color:#333">HAZ TUS PEDIDOS EN LÍNEA GRATIS</div>
    <div class="catalogo-url">HTTPS://QUEVENDI.PRO/${comp.telefono_emisor}</div>
    <div style="font-size:7px;color:#555">PARA RECOJOS O DELIVERY</div>
</div>
` : ''}

<!-- QR + VERIFICACIÓN -->
<div class="qr-section">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}"
         alt="QR" onerror="this.style.display='none'">
    <div class="qr-text">
        Representación impresa de la<br>${comp.tipo_nombre}.<br><br>
        Verifique en:<br>
        <b>https://facturalo.pro/verificar</b><br>
        o en https://sunat.gob.pe
    </div>
</div>

${comp.es_amazonia ? `
<div class="divider"></div>
<div class="amazonia">"BIENES TRANSFERIDOS EN LA AMAZONÍA<br>PARA SER CONSUMIDOS EN LA MISMA"</div>
` : ''}

<!-- FOOTER -->
<div class="divider" style="margin-top:4px"></div>
<div class="footer">
    Sistema de Ventas: <b>https://quevendi.pro</b><br>
    Facturación: <b>https://facturalo.pro</b><br>
    El favorito de los bodegueros
</div>

</body></html>`;
    }

    // ============================================
    // IMPRIMIR
    // ============================================

    function _printHtml(html) {
        const win = window.open('', '_blank', 'width=320,height=800');
        if (!win) {
            // Fallback: crear iframe oculto
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:320px;height:800px';
            document.body.appendChild(iframe);
            iframe.contentDocument.write(html);
            iframe.contentDocument.close();
            setTimeout(() => {
                try { iframe.contentWindow.print(); } catch (e) {}
                setTimeout(() => iframe.remove(), 2000);
            }, 300);
            return;
        }

        win.document.write(html);
        win.document.close();
        setTimeout(() => {
            try { win.print(); } catch (e) {}
            setTimeout(() => { try { win.close(); } catch (e) {} }, 1000);
        }, 300);
    }

    // ============================================
    // COLA DE SYNC
    // ============================================

    async function _queueForSync(comprobante, saleData) {
        // Guardar en meta de IndexedDB como cola
        const queue = (await OfflineDB.meta.get('billing_sync_queue'))?.value || [];
        queue.push({
            serie: comprobante.serie,
            numero: comprobante.numero,
            tipo: comprobante.tipo,
            fecha_emision: comprobante.fecha_iso,
            hora_emision: comprobante.hora_iso,
            cliente_tipo_doc: comprobante.cliente.tipo_doc,
            cliente_num_doc: comprobante.cliente.num_doc,
            cliente_nombre: comprobante.cliente.nombre,
            cliente_direccion: comprobante.cliente.direccion,
            items: comprobante.items,
            total: comprobante.total,
            payment_method: comprobante.payment_method,
            is_credit: comprobante.is_credit,
            sale_local_id: saleData.local_id || null,
            verification_code: comprobante.verification_code,
            queued_at: new Date().toISOString()
        });
        await OfflineDB.meta.set('billing_sync_queue', queue);
    }

    /**
     * Enviar comprobantes encolados al servidor.
     * Se llama cuando hay internet.
     */
    async function syncQueue() {
        const queueData = await OfflineDB.meta.get('billing_sync_queue');
        const queue = queueData?.value || [];
        if (queue.length === 0) return { synced: 0, errors: 0 };

        const token = _getToken();
        if (!token) return { synced: 0, errors: 0 };

        try {
            const resp = await fetch(`${_config.apiBase}/billing/offline/sync-comprobantes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    device_id: _config.device_id,
                    comprobantes: queue
                })
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const result = await resp.json();

            // Limpiar cola de los exitosos
            const exitosos = new Set(
                result.resultados.filter(r => r.success).map(r => `${r.serie}-${r.numero}`)
            );
            const remaining = queue.filter(c => !exitosos.has(`${c.serie}-${c.numero}`));
            await OfflineDB.meta.set('billing_sync_queue', remaining);

            console.log(`[OfflineBilling] Sync: ${result.exitosos} OK, ${result.fallidos} errores`);
            return { synced: result.exitosos, errors: result.fallidos };

        } catch (e) {
            console.warn(`[OfflineBilling] Sync failed: ${e.message}`);
            return { synced: 0, errors: queue.length };
        }
    }

    // ============================================
    // HELPERS
    // ============================================

    function _getToken() {
        if (typeof getAuthToken === 'function') return getAuthToken();
        return localStorage.getItem('access_token');
    }

    function _esc(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function _numeroALetras(num) {
        const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
        const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
        const especiales = { 11:'ONCE', 12:'DOCE', 13:'TRECE', 14:'CATORCE', 15:'QUINCE',
            16:'DIECISEIS', 17:'DIECISIETE', 18:'DIECIOCHO', 19:'DIECINUEVE',
            21:'VEINTIUNO', 22:'VEINTIDOS', 23:'VEINTITRES', 24:'VEINTICUATRO', 25:'VEINTICINCO',
            26:'VEINTISEIS', 27:'VEINTISIETE', 28:'VEINTIOCHO', 29:'VEINTINUEVE' };
        const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
            'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

        const entero = Math.floor(num);
        const decimales = Math.round((num - entero) * 100);

        function convertir(n) {
            if (n === 0) return 'CERO';
            if (n === 100) return 'CIEN';
            if (especiales[n]) return especiales[n];

            let texto = '';
            if (n >= 1000) {
                const miles = Math.floor(n / 1000);
                texto += (miles === 1 ? 'MIL' : convertir(miles) + ' MIL');
                n %= 1000;
                if (n > 0) texto += ' ';
            }
            if (n >= 100) {
                texto += centenas[Math.floor(n / 100)];
                n %= 100;
                if (n > 0) texto += ' ';
            }
            if (especiales[n]) {
                texto += especiales[n];
            } else {
                if (n >= 10) {
                    texto += decenas[Math.floor(n / 10)];
                    n %= 10;
                    if (n > 0) texto += ' Y ';
                }
                texto += unidades[n];
            }
            return texto;
        }

        return `${convertir(entero)} CON ${String(decimales).padStart(2, '0')}/100 SOLES`;
    }

    // ============================================
    // ESTADO
    // ============================================

    async function getStatus() {
        const serie = _config.serie_boleta;
        const remaining = serie ? await OfflineDB.correlatives.getRemaining(serie) : 0;
        const queueData = await OfflineDB.meta.get('billing_sync_queue');
        const queueSize = (queueData?.value || []).length;

        return {
            registered: _registered,
            device_id: _config.device_id,
            serie_boleta: _config.serie_boleta,
            serie_factura: _config.serie_factura,
            correlativos_disponibles: remaining,
            comprobantes_en_cola: queueSize,
            emisor_ruc: _config.emisor.ruc,
            emisor_nombre: _config.emisor.razon_social
        };
    }

    function isRegistered() { return _registered; }
    function getSerie(tipo = 'boleta') {
        return tipo === 'factura' ? _config.serie_factura : _config.serie_boleta;
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    // Polyfill: String.zfill
    if (!String.prototype.zfill) {
        String.prototype.zfill = function(n) { return this.padStart(n, '0'); };
        Number.prototype.zfill = function(n) { return String(this).padStart(n, '0'); };
    }

    return {
        init,
        registerDevice,
        reserveBlock,
        emitirLocal,
        syncQueue,
        getStatus,
        isRegistered,
        getSerie,
    };

})();

window.OfflineBilling = OfflineBilling;
console.log('[OfflineBilling] 📄 Módulo cargado');

// ============================================
// HOOK: Sincronizar cola cuando hay internet
// ============================================
if (typeof OfflineSync !== 'undefined') {
    // Registrar listener para cuando vuelve internet
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (typeof OfflineSync !== 'undefined' && OfflineSync.onStatusChange) {
                OfflineSync.onStatusChange(async (isOnline) => {
                    if (isOnline && OfflineBilling.isRegistered()) {
                        console.log('[OfflineBilling] 🔄 Internet detectado, sincronizando cola...');
                        await OfflineBilling.syncQueue();
                    }
                });
            }
        }, 2000);
    });
}