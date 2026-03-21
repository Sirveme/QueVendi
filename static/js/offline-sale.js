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

            // 5. Ocultar loader ANTES de mostrar modal
            if (typeof hideLoader === 'function') hideLoader();

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
            // hideLoader ya se llamó antes del modal, esto es por si acaso
            setTimeout(() => {
                if (typeof hideLoader === 'function') hideLoader();
            }, 350);
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
        // Construir un objeto comp compatible con buildTicketHtmlDesdeComprobante
        const sc = JSON.parse(localStorage.getItem('store_config') || '{}');
        const comp = {
            tipo:             '03',
            serie:            sc.serie_boleta || 'B001',
            numero:           verificationCode,
            numero_formato:   verificationCode,
            fecha_emision:    saleData.sale_date || new Date().toISOString(),
            total:            total,
            igv:              0,
            subtotal:         total,
            payment_method:   saleData.payment_method || 'efectivo',
            is_credit:        saleData.is_credit || false,
            usuario_nombre:   localStorage.getItem('user_name') || 'vendedor',
            sunat_description: verificationCode,
            cliente: {
                tipo_doc:  '0',
                num_doc:   '00000000',
                nombre:    saleData.customer_name || 'CLIENTE VARIOS',
                direccion: null,
            },
            items: (saleData.items || []).map(i => ({
                descripcion:    i.product_name || 'Producto',
                cantidad:       i.quantity,
                precio_unitario: i.unit_price,
                valor_venta:    i.subtotal,
                unidad:         i.unit || 'NIU',
            })),
            emisor: {
                ruc:              sc.ruc              || localStorage.getItem('store_ruc') || '',
                razon_social:     sc.razon_social     || localStorage.getItem('store_name') || '',
                nombre_comercial: sc.nombre_comercial || localStorage.getItem('store_name') || '',
                direccion:        sc.direccion        || '',
                telefono:         sc.telefono         || '',
            },
        };

        // 1. Intentar Print Agent (impresora térmica)
        fetch('http://localhost:9638/print/ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comprobante_id: null, ...comp, offline: true }),
            signal: AbortSignal.timeout(2000)
        }).then(r => {
            if (r.ok) console.log('[OfflineSale] ✅ Impreso por Print Agent');
        }).catch(() => {
            console.log('[OfflineSale] Sin Print Agent — ticket en modal');
        });

        // 2. Mostrar ticket HTML en el modal de éxito (reemplaza el código de verificación)
        setTimeout(() => {
            if (typeof window.buildTicketHtmlDesdeComprobante === 'function') {
                const ticketContainer = document.getElementById('offline-ticket-preview');
                if (ticketContainer) {
                    ticketContainer.innerHTML = window.buildTicketHtmlDesdeComprobante(comp);
                }
            }
        }, 100);
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
            background: rgba(0, 0, 0, 0.85); z-index: 999999;
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

                <!-- Ticket preview -->
                <div id="offline-ticket-preview" style="
                    max-height:55vh;overflow-y:auto;
                    background:#f5f5f5;border-radius:10px;
                    padding:8px;margin-bottom:16px;
                    display:flex;justify-content:center;
                ">
                    <div style="color:#94a3b8;font-size:12px;padding:16px">
                        <span style="color:#f59e0b">⬡</span> ${verificationCode}
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
                        <i class="fas fa-print"></i> Reimprimir
                    </button>
                    <button onclick="
                            document.getElementById('offline-sale-success-modal').remove();
                            if(typeof AppState !== 'undefined'){ AppState.cart=[]; AppState.paymentMethod='efectivo'; }
                            if(typeof saveCart === 'function') saveCart();
                            if(typeof renderCart === 'function') renderCart();
                            if(typeof selectPaymentUI === 'function') selectPaymentUI('efectivo');
                            if(typeof hideLoader === 'function') hideLoader();
                        " style="
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