/**
 * QueVendi — Print Agent Integration
 * =====================================
 * Conecta el flujo de ventas del dashboard con el Print Agent.
 * 
 * Al completar una venta y emitir boleta/factura:
 *   1. Facturalo.pro genera el comprobante (SUNAT)
 *   2. Este módulo envía los datos al Print Agent local
 *   3. Print Agent imprime el ticket ESC/POS instantáneamente
 *   4. El PDF queda disponible para descargar/compartir
 * 
 * Instalación:
 *   <script src="/static/js/print-agent-integration.js"></script>
 *   (después de print-agent-client.js y dashboard_principal.js)
 * 
 * Funciona automáticamente — no requiere configuración.
 * Si el Print Agent no está corriendo, no hace nada (fallback silencioso).
 */

const PrintAgentIntegration = (() => {

    let _enabled = false;
    let _autoprint = true; // Imprimir automáticamente al emitir
    let _emisorData = null;

    // ============================================
    // INIT
    // ============================================

    function init() {
        // Cargar datos del emisor
        _loadEmisorData();

        // Cargar preferencia de autoprint
        _autoprint = localStorage.getItem('autoprint_ticket') !== 'false';

        // Verificar si Print Agent está disponible
        _checkAgent();

        // Interceptar el flujo de emisión
        _hookBillingFlow();

        // Interceptar el modal de éxito del comprobante
        _hookSuccessModal();

        console.log(`[PrintIntegration] ✅ Listo. Autoprint: ${_autoprint ? 'ON' : 'OFF'}`);
    }

    function _loadEmisorData() {
        try {
            const config = JSON.parse(localStorage.getItem('store_config') || '{}');
            _emisorData = {
                ruc: config.ruc || localStorage.getItem('emisor_ruc') || '',
                razon_social: config.razon_social || localStorage.getItem('emisor_razon_social') || '',
                nombre_comercial: config.nombre_comercial || localStorage.getItem('emisor_nombre_comercial') || '',
                direccion: config.direccion || localStorage.getItem('emisor_direccion') || '',
                telefono: config.telefono || localStorage.getItem('emisor_telefono') || '',
                email: config.email || localStorage.getItem('emisor_email') || '',
                logo: config.logo || null,
                cod_establecimiento: config.cod_establecimiento || '0000',
                giro: config.giro || '',
                slogan: config.slogan || '',
                es_amazonia: config.es_amazonia !== false,
                tipo_igv: config.tipo_igv || '20',
            };
        } catch (e) {
            _emisorData = {};
        }
    }

    async function _checkAgent() {
        if (typeof PrintAgent !== 'undefined') {
            _enabled = await PrintAgent.isAvailable();
        }
    }

    // ============================================
    // HOOK 1: Interceptar _emitirBoletaConCliente
    // ============================================

    function _hookBillingFlow() {
        // Esperar a que dashboard_principal.js defina las funciones
        const checkInterval = setInterval(() => {
            // Hook en showComprobanteSuccessModal para capturar el comprobante emitido
            if (typeof window.showComprobanteSuccessModal === 'function' && !window._printHooked) {
                const original = window.showComprobanteSuccessModal;

                window.showComprobanteSuccessModal = function(comprobanteId, numeroFormato, tipoDoc, formato) {
                    // Llamar original primero
                    original.call(this, comprobanteId, numeroFormato, tipoDoc, formato);

                    // Auto-imprimir si está habilitado
                    if (_enabled && _autoprint) {
                        _printFromComprobante(comprobanteId, numeroFormato, tipoDoc);
                    }
                };

                window._printHooked = true;
                console.log('[PrintIntegration] ✅ Hook instalado en showComprobanteSuccessModal');
                clearInterval(checkInterval);
            }
        }, 1000);

        // Timeout después de 10 segundos
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    // ============================================
    // HOOK 2: Agregar botón "Imprimir Ticket" al modal
    // ============================================

    function _hookSuccessModal() {
        // Observar cuando se agrega el modal al DOM
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.id === 'comprobante-success-modal') {
                        _addPrintButton(node);
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true });
    }

    function _addPrintButton(modal) {
        if (!_enabled) return;

        // Buscar el contenedor de botones
        const btnContainer = modal.querySelector('div[style*="display: flex"][style*="gap"]');
        if (!btnContainer) return;

        // Verificar que no exista ya
        if (modal.querySelector('#btn-modal-print-agent')) return;

        // Crear botón de impresión directa
        const printBtn = document.createElement('button');
        printBtn.id = 'btn-modal-print-agent';
        printBtn.style.cssText = `
            flex: 1; padding: 10px; background: linear-gradient(135deg, #f59e0b, #d97706);
            border: none; border-radius: 8px; color: white; font-size: 13px;
            font-weight: 600; cursor: pointer; display: flex;
            align-items: center; justify-content: center; gap: 5px;
        `;
        printBtn.innerHTML = '<i class="fas fa-print"></i> Imprimir';

        // Obtener datos del comprobante del modal
        printBtn.onclick = async () => {
            printBtn.disabled = true;
            printBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Imprimiendo...';

            const numeroFormato = modal.querySelector('p[style*="a78bfa"]')?.textContent || '';
            const comprobanteId = modal.dataset.comprobanteId;

            const success = await _printLastSale(numeroFormato);

            printBtn.innerHTML = success
                ? '<i class="fas fa-check"></i> Impreso'
                : '<i class="fas fa-times"></i> Error';

            setTimeout(() => {
                printBtn.disabled = false;
                printBtn.innerHTML = '<i class="fas fa-print"></i> Imprimir';
            }, 2000);
        };

        // Insertar antes del botón de cerrar
        const closeBtn = btnContainer.querySelector('#btn-modal-close');
        if (closeBtn) {
            btnContainer.insertBefore(printBtn, closeBtn);
        } else {
            btnContainer.appendChild(printBtn);
        }
    }

    // ============================================
    // IMPRESIÓN — Desde comprobante emitido
    // ============================================

    async function _printFromComprobante(comprobanteId, numeroFormato, tipoDoc) {
        if (!_enabled || !_emisorData) return;

        try {
            // Obtener datos del comprobante del servidor
            const token = localStorage.getItem('access_token');
            const resp = await fetch(`/api/v1/billing/comprobante/${comprobanteId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!resp.ok) {
                console.warn('[PrintIntegration] No se pudo obtener comprobante:', resp.status);
                return;
            }

            const comp = await resp.json();

            // Construir datos para el ticket
            const ticketData = _buildTicketData(comp);

            // Enviar al Print Agent
            const result = await PrintAgent.printTicket(ticketData);

            if (result.success) {
                _showMiniToast('🖨️ Ticket impreso');
            }

        } catch (e) {
            console.warn('[PrintIntegration] Error:', e.message);
        }
    }

    /**
     * Imprimir la última venta realizada.
     * Busca en las ventas del día la más reciente.
     */
    async function _printLastSale(numeroFormato) {
        if (!_enabled || !_emisorData) return false;

        try {
            const token = localStorage.getItem('access_token');

            // Buscar ventas de hoy
            const salesResp = await fetch('/api/v1/sales/today', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!salesResp.ok) return false;
            const salesData = await salesResp.json();
            const sales = salesData.sales || salesData;

            if (!Array.isArray(sales) || sales.length === 0) return false;

            // Tomar la última venta
            const lastSale = sales[sales.length - 1] || sales[0];

            // Buscar comprobante de esta venta
            const compResp = await fetch(`/api/v1/billing/venta/${lastSale.id}/comprobante`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            let compData = null;
            if (compResp.ok) {
                const compInfo = await compResp.json();
                if (compInfo.tiene_comprobante && compInfo.comprobante_id) {
                    const detailResp = await fetch(`/api/v1/billing/comprobante/${compInfo.comprobante_id}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (detailResp.ok) compData = await detailResp.json();
                }
            }

            // Construir ticket
            const ticketData = compData
                ? _buildTicketData(compData)
                : _buildTicketFromSale(lastSale, numeroFormato);

            const result = await PrintAgent.printTicket(ticketData);
            return result.success;

        } catch (e) {
            console.warn('[PrintIntegration] Print error:', e.message);
            return false;
        }
    }

    // ============================================
    // CONSTRUIR DATOS DEL TICKET
    // ============================================

    /**
     * Desde datos completos de comprobante (servidor)
     */
    function _buildTicketData(comp) {
        const tipoIgv = _emisorData.tipo_igv || '20';
        const total = parseFloat(comp.total || 0);
        let opGravada = 0, opExonerada = 0, igv = 0;

        if (tipoIgv === '10') {
            opGravada = parseFloat(comp.subtotal || (total / 1.18).toFixed(2));
            igv = parseFloat(comp.igv || (total - opGravada).toFixed(2));
        } else {
            opExonerada = total;
        }

        // Parsear items
        const items = (comp.items || []).map(item => ({
            descripcion: item.descripcion || item.product_name || 'Producto',
            cantidad: parseFloat(item.cantidad || item.quantity || 1),
            unidad: item.unidad || item.unidad_medida || 'NIU',
            precio_unitario: parseFloat(item.precio_unitario || item.unit_price || 0),
        }));

        // Parsear fecha
        const fechaStr = comp.fecha_emision || new Date().toISOString();
        const fecha = new Date(fechaStr);

        return {
            emisor: _emisorData,
            logo: _emisorData.logo || null,
            cliente: {
                tipo_doc: comp.cliente?.tipo_doc || comp.cliente_tipo_doc || '0',
                num_doc: comp.cliente?.num_doc || comp.cliente_num_doc || '-',
                nombre: comp.cliente?.nombre || comp.cliente_nombre || 'CLIENTE VARIOS',
                direccion: comp.cliente?.direccion || comp.cliente_direccion || '',
            },
            tipo: comp.tipo || '03',
            serie: comp.serie || 'B001',
            numero: comp.numero || 0,
            numero_formato: comp.numero_formato || `${comp.serie}-${String(comp.numero).padStart(8, '0')}`,
            fecha: fecha.toLocaleDateString('es-PE'),
            hora: fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }),
            fecha_iso: fecha.toISOString().split('T')[0],
            items: items,
            total: total,
            op_exonerada: opExonerada,
            op_gravada: opGravada,
            igv: igv,
            payment_method: comp.payment_method || 'efectivo',
            is_credit: comp.is_credit || false,
            importe_letras: _numeroALetras(total),
            es_amazonia: _emisorData.es_amazonia,
            hash: comp.sunat_hash || comp.hash || '',
            verification_code: comp.verification_code || '',
        };
    }

    /**
     * Desde datos de venta (cuando no hay comprobante completo)
     */
    function _buildTicketFromSale(sale, numeroFormato) {
        const tipoIgv = _emisorData.tipo_igv || '20';
        const total = parseFloat(sale.total || 0);
        let opGravada = 0, opExonerada = 0, igv = 0;

        if (tipoIgv === '10') {
            opGravada = +(total / 1.18).toFixed(2);
            igv = +(total - opGravada).toFixed(2);
        } else {
            opExonerada = total;
        }

        const items = (sale.items || []).map(item => ({
            descripcion: item.product_name || 'Producto',
            cantidad: parseFloat(item.quantity || 1),
            unidad: 'NIU',
            precio_unitario: parseFloat(item.unit_price || 0),
        }));

        // Parsear número de formato
        let serie = 'B001', numero = 0;
        if (numeroFormato && numeroFormato.includes('-')) {
            const parts = numeroFormato.split('-');
            serie = parts[0];
            numero = parseInt(parts[1]) || 0;
        }

        const fecha = sale.sale_date ? new Date(sale.sale_date) : new Date();

        return {
            emisor: _emisorData,
            logo: _emisorData.logo || null,
            cliente: {
                tipo_doc: '0',
                num_doc: '-',
                nombre: sale.customer_name || 'CLIENTE VARIOS',
                direccion: '',
            },
            tipo: '03',
            serie: serie,
            numero: numero,
            numero_formato: numeroFormato || `${serie}-${String(numero).padStart(8, '0')}`,
            fecha: fecha.toLocaleDateString('es-PE'),
            hora: fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }),
            fecha_iso: fecha.toISOString().split('T')[0],
            items: items,
            total: total,
            op_exonerada: opExonerada,
            op_gravada: opGravada,
            igv: igv,
            payment_method: sale.payment_method || 'efectivo',
            is_credit: sale.is_credit || false,
            importe_letras: _numeroALetras(total),
            es_amazonia: _emisorData.es_amazonia,
        };
    }

    // ============================================
    // IMPRIMIR MANUALMENTE (API pública)
    // ============================================

    /**
     * Imprimir ticket de una venta específica.
     * Llamar desde consola o desde un botón custom.
     * @param {number} saleId - ID de la venta
     */
    async function printSale(saleId) {
        if (!_enabled) {
            await _checkAgent();
            if (!_enabled) {
                _showMiniToast('Print Agent no disponible', true);
                return false;
            }
        }

        _loadEmisorData();

        try {
            const token = localStorage.getItem('access_token');

            // Obtener comprobante de la venta
            const compResp = await fetch(`/api/v1/billing/venta/${saleId}/comprobante`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!compResp.ok) {
                _showMiniToast('Venta sin comprobante', true);
                return false;
            }

            const compInfo = await compResp.json();
            if (!compInfo.tiene_comprobante) {
                _showMiniToast('Venta sin comprobante emitido', true);
                return false;
            }

            // Obtener detalle completo
            const detailResp = await fetch(`/api/v1/billing/comprobante/${compInfo.comprobante_id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!detailResp.ok) {
                _showMiniToast('Error obteniendo comprobante', true);
                return false;
            }

            const comp = await detailResp.json();
            const ticketData = _buildTicketData(comp);
            const result = await PrintAgent.printTicket(ticketData);

            _showMiniToast(result.success ? '🖨️ Ticket impreso' : 'Error al imprimir', !result.success);
            return result.success;

        } catch (e) {
            _showMiniToast('Error: ' + e.message, true);
            return false;
        }
    }

    /**
     * Imprimir ticket custom (datos arbitrarios).
     * Para reimprimir, imprimir cotizaciones, etc.
     */
    async function printCustom(ticketData) {
        if (!_enabled) {
            await _checkAgent();
            if (!_enabled) return false;
        }

        // Merge con datos del emisor
        ticketData.emisor = ticketData.emisor || _emisorData;
        ticketData.es_amazonia = ticketData.es_amazonia ?? _emisorData?.es_amazonia;

        const result = await PrintAgent.printTicket(ticketData);
        return result.success;
    }

    /**
     * Toggle autoprint
     */
    function setAutoprint(enabled) {
        _autoprint = enabled;
        localStorage.setItem('autoprint_ticket', enabled ? 'true' : 'false');
        console.log(`[PrintIntegration] Autoprint: ${enabled ? 'ON' : 'OFF'}`);
    }

    function isAutoprint() { return _autoprint; }
    function isEnabled() { return _enabled; }

    // ============================================
    // HELPERS
    // ============================================

    function _showMiniToast(msg, isError) {
        if (typeof showToast === 'function') {
            showToast(msg, isError ? 'error' : 'success');
        } else {
            console.log(`[PrintIntegration] ${msg}`);
        }
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
    // AUTO-INIT
    // ============================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
    } else {
        setTimeout(init, 1500);
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    return {
        printSale,          // Imprimir comprobante de una venta por ID
        printCustom,        // Imprimir ticket con datos custom
        setAutoprint,       // Activar/desactivar autoprint
        isAutoprint,
        isEnabled,
    };

})();

window.PrintAgentIntegration = PrintAgentIntegration;
console.log('[PrintIntegration] 🔌 Módulo cargado');