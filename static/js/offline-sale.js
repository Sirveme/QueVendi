/**
 * QueVendi - Offline Sale Handler
 * =================================
 * Intercepta el flujo de venta cuando no hay internet.
 * En vez de fallar, guarda la venta en IndexedDB y genera
 * un ticket con URL de verificación para el cliente.
 * 
 * Flujo:
 *   1. Usuario presiona COBRAR
 *   2. OfflineSale.intercept() verifica si hay internet
 *   3. Si HAY internet → flujo normal (processSale existente)
 *   4. Si NO hay internet → guarda en IndexedDB → imprime ticket offline
 *   5. Cuando hay internet → OfflineSync sincroniza automáticamente
 *   6. Cliente consulta su comprobante en facturalo.pro/v/CODIGO
 * 
 * Integración:
 *   Se engancha en executeSale() existente. No reemplaza, intercepta.
 * 
 * Uso:
 *   // Se auto-instala al cargar. No requiere init() manual.
 *   // Para forzar venta offline (testing):
 *   OfflineSale.forceOfflineSale(saleData);
 */

const OfflineSale = (() => {

    // ============================================
    // CONFIG
    // ============================================

    const CONFIG = {
        // URL base para verificación de comprobantes
        verificationBaseUrl: 'https://facturalo.pro/v',

        // Datos del emisor (se llenan en init)
        emisor: {
            ruc: '',
            razon_social: '',
            direccion: '',
            nombre_comercial: ''
        },

        // Tamaño del ticket (80mm)
        ticketWidth: '80mm'
    };

    let _installed = false;

    // ============================================
    // INSTALACIÓN (AUTO)
    // ============================================

    /**
     * Instalar interceptor en el flujo de venta existente.
     * Se llama automáticamente cuando el DOM está listo.
     */
    function install() {
        if (_installed) return;

        // Guardar referencia a la función original
        if (typeof window.executeSale === 'function') {
            window._originalExecuteSale = window.executeSale;

            // Reemplazar con versión que intercepta offline
            window.executeSale = async function(total, printType = 'none') {
                // ¿Hay internet?
                const online = typeof OfflineSync !== 'undefined'
                    ? OfflineSync.isOnline()
                    : navigator.onLine;

                if (online) {
                    // Online → flujo normal
                    return window._originalExecuteSale(total, printType);
                } else {
                    // Offline → nuestro flujo
                    return handleOfflineSale(total, printType);
                }
            };

            _installed = true;
            console.log('[OfflineSale] ✅ Interceptor instalado en executeSale()');
        } else {
            console.warn('[OfflineSale] ⚠️ executeSale() no encontrada. Reintentando en 1s...');
            setTimeout(install, 1000);
        }
    }

    // ============================================
    // FLUJO DE VENTA OFFLINE
    // ============================================

    /**
     * Procesar una venta sin internet.
     * @param {number} total - Total de la venta
     * @param {string} printType - Tipo de impresión solicitada
     */
    async function handleOfflineSale(total, printType) {
        console.log(`[OfflineSale] 🔴 Venta offline: S/. ${total.toFixed(2)}`);

        const loader = typeof showLoader === 'function'
            ? showLoader('Guardando venta offline...')
            : null;

        try {
            // 1. Construir datos de la venta
            const saleData = buildSaleData(total);

            // 2. Guardar en IndexedDB
            const token = typeof getAuthToken === 'function'
                ? getAuthToken()
                : localStorage.getItem('access_token');

            const localId = await OfflineDB.sales.queue(saleData, token);

            // 3. Obtener la venta guardada (con verification_code)
            const savedSale = await OfflineDB.sales.getAll(1);
            const offlineSale = savedSale.find(s => s.local_id === localId);
            const verificationCode = offlineSale?.verification_code || `VNT-${localId}`;

            console.log(`[OfflineSale] 📝 Guardada: local_id=${localId}, code=${verificationCode}`);

            // 4. Manejar impresión
            if (printType && printType !== 'none') {
                printOfflineTicket(saleData, total, verificationCode, printType);
            }

            // 5. Mostrar modal de éxito offline
            showOfflineSuccessModal(total, verificationCode, localId);

            // 6. Limpiar carrito
            if (typeof AppState !== 'undefined') {
                AppState.cart = [];
                if (typeof saveCart === 'function') saveCart();
                if (typeof renderCart === 'function') renderCart();

                // Reset método de pago
                if (typeof selectPaymentUI === 'function') selectPaymentUI('efectivo');
                AppState.paymentMethod = 'efectivo';
            }

            // 7. Actualizar meta del día (local)
            if (typeof AppState !== 'undefined') {
                AppState.dailySales += total;
                if (typeof updateGoalProgress === 'function') updateGoalProgress();
            }

            // 8. Sonido y feedback
            if (typeof playSound === 'function') playSound('success');
            if (typeof AudioAssistant !== 'undefined') {
                AudioAssistant.speak(
                    `Venta de ${total.toFixed(2)} soles guardada. ` +
                    `Se sincronizará cuando haya internet.`
                );
            }

            // 9. Registrar Background Sync
            if ('serviceWorker' in navigator && 'SyncManager' in window) {
                try {
                    const reg = await navigator.serviceWorker.ready;
                    await reg.sync.register('sync-sales');
                } catch (e) { /* no crítico */ }
            }

            return { success: true, local_id: localId, verification_code: verificationCode };

        } catch (error) {
            console.error('[OfflineSale] ❌ Error:', error);
            _showToast(`Error al guardar venta: ${error.message}`, 'error');
            return { success: false, error: error.message };

        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }
    }

    // ============================================
    // CONSTRUIR DATOS DE VENTA
    // ============================================

    /**
     * Construir el objeto de venta desde el estado del carrito.
     * Mismo formato que envía executeSale() al servidor.
     */
    function buildSaleData(total) {
        const cart = AppState?.cart || [];
        const paymentMethod = AppState?.paymentMethod || 'efectivo';

        // Datos de fiado si aplica
        let customerData = null;
        if (paymentMethod === 'fiado') {
            customerData = {
                nombre: document.getElementById('modal-fiado-nombre')?.value.trim() || null,
                telefono: document.getElementById('modal-fiado-telefono')?.value.trim() || null,
                direccion: document.getElementById('modal-fiado-direccion')?.value.trim() || null,
                dni: document.getElementById('modal-fiado-dni')?.value.trim() || null,
                dias: parseInt(document.getElementById('modal-fiado-dias')?.value) || 7,
                referencia: document.getElementById('modal-fiado-referencia')?.value.trim() || null
            };
        }

        return {
            items: cart.map(item => ({
                product_id: item.id,
                product_name: item.name,       // Guardar nombre para ticket offline
                quantity: parseFloat(item.quantity),
                unit_price: parseFloat(item.price),
                unit: item.unit || 'unidad',
                subtotal: parseFloat(item.price) * parseFloat(item.quantity)
            })),
            payment_method: paymentMethod,
            payment_reference: null,
            customer_name: customerData?.nombre || null,
            is_credit: paymentMethod === 'fiado',
            credit_data: customerData,
            total: total,
            sale_date: new Date().toISOString(),
            offline: true
        };
    }

    // ============================================
    // TICKET OFFLINE
    // ============================================

    /**
     * Imprimir ticket de venta offline.
     * Incluye URL de verificación y QR (a la URL, no fiscal).
     */
    function printOfflineTicket(saleData, total, verificationCode, printType) {
        const verificationUrl = `${CONFIG.verificationBaseUrl}/${verificationCode}`;
        const now = new Date(saleData.sale_date);
        const fecha = now.toLocaleDateString('es-PE');
        const hora = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

        // Datos del emisor (desde localStorage o config)
        const emisorRuc = localStorage.getItem('emisor_ruc') || CONFIG.emisor.ruc || '—';
        const emisorNombre = localStorage.getItem('store_name') || CONFIG.emisor.nombre_comercial || 'MI BODEGA';
        const emisorDireccion = localStorage.getItem('emisor_direccion') || CONFIG.emisor.direccion || '';

        // Items
        const itemsHtml = saleData.items.map(item => {
            const name = item.product_name || `Producto #${item.product_id}`;
            const qty = item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(3);
            return `
                <tr>
                    <td style="text-align:left; padding: 2px 0;">${name}</td>
                    <td style="text-align:center; padding: 2px 4px;">${qty}</td>
                    <td style="text-align:right; padding: 2px 0;">S/. ${item.subtotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        // Método de pago
        const metodoPago = {
            'efectivo': 'EFECTIVO',
            'yape': 'YAPE',
            'plin': 'PLIN',
            'tarjeta': 'TARJETA',
            'fiado': 'FIADO'
        }[saleData.payment_method] || saleData.payment_method.toUpperCase();

        // QR usando API pública de Google Charts (funciona offline si ya se cacheó)
        // Fallback: solo mostrar URL como texto
        const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(verificationUrl)}&choe=UTF-8`;

        const ticketHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ticket Offline - ${verificationCode}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            width: ${CONFIG.ticketWidth};
            padding: 5mm;
            color: #000;
        }
        .header { text-align: center; margin-bottom: 8px; }
        .store-name { font-size: 16px; font-weight: bold; }
        .store-ruc { font-size: 11px; color: #333; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        .total-row { font-weight: bold; font-size: 14px; }
        .verification {
            text-align: center;
            margin: 10px 0;
            padding: 8px;
            border: 2px dashed #333;
            border-radius: 4px;
        }
        .verification-title {
            font-size: 10px;
            color: #555;
            margin-bottom: 6px;
            line-height: 1.3;
        }
        .verification-code {
            font-size: 13px;
            font-weight: bold;
            letter-spacing: 0.5px;
            word-break: break-all;
        }
        .verification-url {
            font-size: 9px;
            color: #555;
            margin-top: 4px;
            word-break: break-all;
        }
        .qr-container {
            text-align: center;
            margin: 8px 0;
        }
        .qr-container img {
            width: 120px;
            height: 120px;
        }
        .offline-notice {
            text-align: center;
            font-size: 10px;
            margin-top: 8px;
            padding: 6px;
            background: #f5f5f5;
            border-radius: 4px;
            line-height: 1.4;
        }
        .footer {
            text-align: center;
            margin-top: 8px;
            font-size: 10px;
            color: #555;
        }
        @media print {
            body { width: auto; padding: 0; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="store-name">${_escapeHtml(emisorNombre)}</div>
        ${emisorRuc !== '—' ? `<div class="store-ruc">RUC: ${emisorRuc}</div>` : ''}
        ${emisorDireccion ? `<div class="store-ruc">${_escapeHtml(emisorDireccion)}</div>` : ''}
    </div>

    <div class="divider"></div>

    <div style="text-align: center; font-size: 11px; font-weight: bold; margin: 4px 0;">
        NOTA DE VENTA
    </div>
    <div style="text-align: center; font-size: 10px; color: #555;">
        ${fecha} — ${hora}
    </div>

    <div class="divider"></div>

    <table>
        <thead>
            <tr>
                <th style="text-align:left; font-size:10px;">Producto</th>
                <th style="text-align:center; font-size:10px;">Cant</th>
                <th style="text-align:right; font-size:10px;">Subtotal</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHtml}
        </tbody>
    </table>

    <div class="divider"></div>

    <table>
        <tr class="total-row">
            <td>TOTAL:</td>
            <td style="text-align:right">S/. ${total.toFixed(2)}</td>
        </tr>
        <tr>
            <td style="font-size:11px;">Pago:</td>
            <td style="text-align:right; font-size:11px;">${metodoPago}</td>
        </tr>
        ${saleData.is_credit ? `
        <tr>
            <td style="font-size:11px;">Cliente:</td>
            <td style="text-align:right; font-size:11px;">${_escapeHtml(saleData.customer_name || '—')}</td>
        </tr>
        ` : ''}
    </table>

    <div class="divider"></div>

    <div class="verification">
        <div class="verification-title">
            Tu comprobante electrónico estará<br>
            disponible en las próximas 24 horas:
        </div>
        <div class="verification-code">${verificationCode}</div>
        <div class="verification-url">${verificationUrl}</div>
    </div>

    <div class="qr-container">
        <img src="${qrUrl}"
             alt="QR Verificación"
             onerror="this.style.display='none'">
    </div>

    <div class="offline-notice">
        NOTA DE VENTA — No es comprobante fiscal.<br>
        Tu boleta/factura se emitirá automáticamente<br>
        y podrás consultarla escaneando el QR<br>
        o ingresando a la URL indicada.
    </div>

    <div class="footer">
        ¡Gracias por su compra!<br>
        Generado por QueVendi
    </div>
</body>
</html>`;

        // Abrir ventana de impresión
        const printWindow = window.open('', '_blank', 'width=320,height=700');
        if (!printWindow) {
            _showToast('Permite popups para imprimir el ticket', 'warning');
            return;
        }

        printWindow.document.write(ticketHtml);
        printWindow.document.close();

        setTimeout(() => {
            try { printWindow.print(); } catch (e) { /* ignore */ }
            setTimeout(() => {
                try { printWindow.close(); } catch (e) { /* ignore */ }
            }, 1000);
        }, 300);
    }

    // ============================================
    // MODAL DE ÉXITO OFFLINE
    // ============================================

    /**
     * Mostrar confirmación visual de venta guardada offline
     */
    function showOfflineSuccessModal(total, verificationCode, localId) {
        const verificationUrl = `${CONFIG.verificationBaseUrl}/${verificationCode}`;

        let modal = document.getElementById('offline-sale-success-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'offline-sale-success-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.85); z-index: 10006;
            display: flex; align-items: center; justify-content: center;
            backdrop-filter: blur(4px); padding: 20px;
        `;

        modal.innerHTML = `
            <div style="
                background: #1a1a2e; border-radius: 20px; padding: 28px;
                max-width: 400px; width: 100%; text-align: center; color: white;
            ">
                <!-- Ícono -->
                <div style="
                    width: 70px; height: 70px; margin: 0 auto 16px;
                    background: rgba(245, 158, 11, 0.15);
                    border: 2px solid rgba(245, 158, 11, 0.4);
                    border-radius: 50%; display: flex;
                    align-items: center; justify-content: center;
                    font-size: 32px;
                ">📡</div>

                <!-- Título -->
                <h3 style="margin: 0 0 4px; font-size: 20px; color: #f59e0b;">
                    Venta guardada offline
                </h3>
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 16px;">
                    Se sincronizará automáticamente cuando haya internet
                </p>

                <!-- Total -->
                <div style="
                    background: rgba(245, 158, 11, 0.1);
                    border: 1px solid rgba(245, 158, 11, 0.2);
                    border-radius: 12px; padding: 14px; margin-bottom: 16px;
                ">
                    <div style="color: #94a3b8; font-size: 12px;">Total</div>
                    <div style="font-size: 32px; font-weight: 700; color: #f59e0b;">
                        S/. ${total.toFixed(2)}
                    </div>
                </div>

                <!-- Código verificación -->
                <div style="
                    background: rgba(255,255,255,0.05);
                    border-radius: 10px; padding: 12px; margin-bottom: 16px;
                ">
                    <div style="color: #64748b; font-size: 11px; margin-bottom: 4px;">
                        Código de verificación
                    </div>
                    <div style="
                        font-family: 'Space Grotesk', monospace;
                        font-size: 16px; font-weight: 600;
                        letter-spacing: 1px; color: #e2e8f0;
                    ">${verificationCode}</div>
                    <div style="color: #475569; font-size: 10px; margin-top: 4px;">
                        ${verificationUrl}
                    </div>
                </div>

                <!-- Acciones -->
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button onclick="OfflineSale.reprintTicket(${localId})" style="
                        flex: 1; padding: 12px; border: none; border-radius: 10px;
                        background: rgba(255,255,255,0.1); color: #e2e8f0;
                        font-size: 14px; cursor: pointer; display: flex;
                        align-items: center; justify-content: center; gap: 6px;
                    ">
                        <i class="fas fa-print"></i> Imprimir ticket
                    </button>
                    <button onclick="document.getElementById('offline-sale-success-modal').remove()" style="
                        flex: 1; padding: 12px; border: none; border-radius: 10px;
                        background: linear-gradient(135deg, #f59e0b, #d97706);
                        color: white; font-size: 14px; font-weight: 600;
                        cursor: pointer; display: flex;
                        align-items: center; justify-content: center; gap: 6px;
                    ">
                        <i class="fas fa-arrow-right"></i> Siguiente venta
                    </button>
                </div>

                <!-- Info pendientes -->
                <div id="offline-modal-pending-info" style="
                    color: #64748b; font-size: 12px;
                ">
                    Cargando estado...
                </div>
            </div>
        `;

        // Click fuera para cerrar
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // ESC para cerrar
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(modal);

        // Actualizar info de pendientes
        _updateModalPendingInfo();
    }

    async function _updateModalPendingInfo() {
        const infoEl = document.getElementById('offline-modal-pending-info');
        if (!infoEl || !OfflineDB.isReady()) return;

        try {
            const count = await OfflineDB.sales.getPendingCount();
            infoEl.textContent = count === 1
                ? '📤 1 venta pendiente de sincronizar'
                : `📤 ${count} ventas pendientes de sincronizar`;
        } catch (e) {
            infoEl.textContent = '';
        }
    }

    // ============================================
    // REIMPRIMIR TICKET
    // ============================================

    /**
     * Reimprimir ticket de una venta offline guardada
     * @param {number} localId
     */
    async function reprintTicket(localId) {
        if (!OfflineDB.isReady()) {
            _showToast('Base de datos no disponible', 'error');
            return;
        }

        try {
            const allSales = await OfflineDB.sales.getAll(100);
            const sale = allSales.find(s => s.local_id === localId);

            if (!sale) {
                _showToast('Venta no encontrada', 'error');
                return;
            }

            const total = sale.data.total || sale.data.items.reduce(
                (sum, i) => sum + (i.subtotal || 0), 0
            );

            printOfflineTicket(sale.data, total, sale.verification_code, 'simple');
            _showToast('🖨️ Reimprimiendo ticket...', 'info');

        } catch (error) {
            console.error('[OfflineSale] Error reimprimiendo:', error);
            _showToast('Error al reimprimir', 'error');
        }
    }

    // ============================================
    // VERIFICAR VENTAS OFFLINE (consulta local)
    // ============================================

    /**
     * Verificar estado de una venta por código.
     * Útil para atención al cliente.
     * @param {string} code - Código VNT-...
     * @returns {Promise<Object|null>}
     */
    async function checkSaleStatus(code) {
        if (!OfflineDB.isReady()) return null;

        const sale = await OfflineDB.sales.getByVerificationCode(code);
        if (!sale) return null;

        return {
            code: sale.verification_code,
            status: sale.status,
            synced: sale.synced,
            total: sale.data.total,
            items: sale.data.items.length,
            payment_method: sale.data.payment_method,
            created_at: sale.created_at,
            synced_at: sale.synced_at,
            server_id: sale.server_sale_id,
            customer: sale.data.customer_name
        };
    }

    // ============================================
    // FORZAR VENTA OFFLINE (testing/manual)
    // ============================================

    /**
     * Forzar una venta offline incluso estando online.
     * Útil para testing o cuando el servidor está caído.
     */
    async function forceOfflineSale() {
        if (!OfflineDB.isReady()) {
            _showToast('Inicializa OfflineDB primero', 'error');
            return;
        }

        const cart = AppState?.cart || [];
        if (cart.length === 0) {
            _showToast('El carrito está vacío', 'warning');
            return;
        }

        const total = cart.reduce((sum, item) =>
            sum + (parseFloat(item.price) * parseFloat(item.quantity)), 0
        );

        return handleOfflineSale(total, 'simple');
    }

    // ============================================
    // HELPERS
    // ============================================

    function _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function _showToast(message, type) {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`[OfflineSale] ${type}: ${message}`);
        }
    }

    // ============================================
    // AUTO-INSTALL
    // ============================================

    // Instalar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Esperar a que dashboard_principal.js defina executeSale
            setTimeout(install, 500);
        });
    } else {
        setTimeout(install, 500);
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    return {
        install,
        handleOfflineSale,
        forceOfflineSale,
        reprintTicket,
        checkSaleStatus,
        printOfflineTicket
    };

})();

// ============================================
// EXPORT
// ============================================

window.OfflineSale = OfflineSale;
if (typeof module !== 'undefined' && module.exports) module.exports = OfflineSale;

console.log('[OfflineSale] 🧾 Módulo cargado');