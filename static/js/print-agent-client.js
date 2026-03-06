/**
 * QueVendi — Print Agent Client
 * ================================
 * Conecta el navegador con el Print Agent local (localhost:9638).
 * 
 * Uso:
 *   const ok = await PrintAgent.isAvailable();   // ¿Está corriendo?
 *   await PrintAgent.testPrint();                  // Página de prueba
 *   await PrintAgent.printTicket(comprobanteData); // Ticket completo
 * 
 * Si el agent no está corriendo, hace fallback a window.print().
 */

const PrintAgent = (() => {

    const AGENT_URL = 'http://localhost:9638';
    const TIMEOUT = 5000;

    let _available = null;  // null = no verificado, true/false

    // ============================================
    // VERIFICACIÓN
    // ============================================

    /**
     * ¿El Print Agent está corriendo?
     */
    async function isAvailable() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2000);

            const resp = await fetch(`${AGENT_URL}/status`, {
                signal: controller.signal
            });
            clearTimeout(timer);

            if (resp.ok) {
                const data = await resp.json();
                _available = true;
                console.log(`[PrintAgent] ✅ Conectado: v${data.version} en ${data.hostname}`);
                return true;
            }
        } catch (e) {
            _available = false;
        }
        return false;
    }

    // ============================================
    // IMPRESIÓN
    // ============================================

    /**
     * Imprimir ticket de comprobante.
     * Si el agent está disponible → impresión directa ESC/POS.
     * Si no → fallback a window.print() con HTML.
     */
    async function printTicket(data) {
        // Verificar si el agent está corriendo
        if (_available === null) {
            await isAvailable();
        }

        if (_available) {
            return await _printViaAgent(data);
        } else {
            console.warn('[PrintAgent] No disponible, usando window.print()');
            return _printViaWindow(data);
        }
    }

    /**
     * Enviar ticket al Print Agent local
     */
    async function _printViaAgent(data) {
        try {
            const resp = await fetch(`${AGENT_URL}/print/ticket`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(TIMEOUT)
            });

            const result = await resp.json();

            if (result.success) {
                console.log(`[PrintAgent] ✅ Impreso: ${data.numero_formato}`);
                _showToast('🖨️ Ticket impreso', 'success');
                return { success: true, method: 'agent' };
            } else {
                console.error(`[PrintAgent] ❌ ${result.error}`);
                _showToast(`Error: ${result.error}`, 'error');
                return { success: false, error: result.error, method: 'agent' };
            }
        } catch (e) {
            console.error('[PrintAgent] Error de conexión:', e.message);
            // Agent se desconectó — intentar window.print
            _available = false;
            return _printViaWindow(data);
        }
    }

    /**
     * Fallback: imprimir via window.print() (HTML)
     */
    function _printViaWindow(data) {
        // Usar OfflineBilling si está disponible
        if (typeof OfflineBilling !== 'undefined' && OfflineBilling._generateTicketHtml) {
            const html = OfflineBilling._generateTicketHtml(data);
            const win = window.open('', '_blank', 'width=320,height=800');
            if (win) {
                win.document.write(html);
                win.document.close();
                setTimeout(() => {
                    try { win.print(); } catch (e) {}
                    setTimeout(() => win.close(), 1000);
                }, 300);
            }
        } else {
            // Fallback mínimo
            window.print();
        }
        return { success: true, method: 'window.print' };
    }

    // ============================================
    // UTILIDADES
    // ============================================

    /**
     * Página de prueba
     */
    async function testPrint() {
        if (_available === null) await isAvailable();

        if (!_available) {
            _showToast('Print Agent no disponible. Inícialo primero.', 'error');
            return { success: false, error: 'Agent no disponible' };
        }

        try {
            const resp = await fetch(`${AGENT_URL}/print/test`, { method: 'POST' });
            const result = await resp.json();

            if (result.success) {
                _showToast('🖨️ Página de prueba impresa', 'success');
            } else {
                _showToast(`Error: ${result.error}`, 'error');
            }
            return result;
        } catch (e) {
            _showToast('No se pudo conectar al Print Agent', 'error');
            return { success: false, error: e.message };
        }
    }

    /**
     * Estado del agent
     */
    async function getStatus() {
        try {
            const resp = await fetch(`${AGENT_URL}/status`);
            return await resp.json();
        } catch (e) {
            return { status: 'offline', error: e.message };
        }
    }

    /**
     * Imprimir texto simple
     */
    async function printText(text) {
        if (!_available) return { success: false };
        const resp = await fetch(`${AGENT_URL}/print/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        return await resp.json();
    }

    // ============================================
    // HELPERS
    // ============================================

    function _showToast(msg, type) {
        if (typeof showToast === 'function') {
            showToast(msg, type);
        } else {
            console.log(`[PrintAgent] ${type}: ${msg}`);
        }
    }

    // ============================================
    // AUTO-CHECK al cargar
    // ============================================

    // Verificar si el agent está corriendo cuando carga la página
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(isAvailable, 1000));
    } else {
        setTimeout(isAvailable, 1000);
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    return {
        isAvailable,
        printTicket,
        testPrint,
        getStatus,
        printText,
        AGENT_URL,
    };

})();

window.PrintAgent = PrintAgent;
console.log('[PrintAgent] 📡 Cliente cargado');