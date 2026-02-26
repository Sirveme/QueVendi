/**
 * QueVendi - Offline Sync Manager
 * =================================
 * Detecta conexión, sincroniza automáticamente, muestra estado visual.
 * 
 * Responsabilidades:
 *   1. Detectar online/offline con verificación real (no solo navigator.onLine)
 *   2. Mostrar indicador visual persistente del estado de conexión
 *   3. Sincronizar ventas pendientes automáticamente al recuperar internet
 *   4. Sincronizar catálogo de productos periódicamente
 *   5. Comunicarse con Service Worker para Background Sync
 *   6. Mostrar badge de ventas pendientes
 * 
 * Uso:
 *   await OfflineSync.init();      // Después de OfflineDB.init()
 *   OfflineSync.isOnline();        // Estado actual
 *   OfflineSync.forceSyncNow();    // Sync manual
 */

const OfflineSync = (() => {

    // ============================================
    // CONFIG
    // ============================================

    const CONFIG = {
        // Verificación real de conectividad (no solo navigator.onLine)
        pingUrl: '/api/v1/health',       // Endpoint ligero del servidor
        pingInterval: 30_000,             // Verificar cada 30s cuando online
        pingIntervalOffline: 10_000,      // Verificar cada 10s cuando offline (detectar reconexión rápido)
        pingTimeout: 5_000,               // Timeout de 5s para el ping

        // Sync automático
        syncDelayAfterOnline: 3_000,      // Esperar 3s después de reconexión antes de sync
        catalogSyncInterval: 15 * 60_000, // Sync catálogo cada 15 min
        salesRetryInterval: 60_000,       // Reintentar ventas con error cada 60s

        // UI
        toastDuration: 4_000,
        pendingBadgeSelector: '#offline-pending-badge',
        statusIndicatorId: 'offline-status-indicator'
    };

    // ============================================
    // ESTADO
    // ============================================

    let _online = navigator.onLine;
    let _initialized = false;
    let _pingTimer = null;
    let _catalogSyncTimer = null;
    let _salesRetryTimer = null;
    let _syncing = false;
    let _listeners = [];  // callbacks registrados por otros módulos
    let _lastPingOk = null;
    let _consecutiveFailures = 0;

    // ============================================
    // INICIALIZACIÓN
    // ============================================

    /**
     * Inicializar el sync manager.
     * Llamar DESPUÉS de OfflineDB.init()
     */
    async function init() {
        if (_initialized) return;
        _initialized = true;

        console.log('[OfflineSync] Inicializando...');

        // 1. Inyectar UI (indicador de estado + badge)
        _injectStatusUI();

        // 2. Escuchar eventos del navegador
        window.addEventListener('online', _handleBrowserOnline);
        window.addEventListener('offline', _handleBrowserOffline);

        // 3. Escuchar mensajes del Service Worker
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', _handleSWMessage);
        }

        // 4. Verificación inicial real
        await _checkConnection();

        // 5. Iniciar ping periódico
        _startPingLoop();

        // 6. Iniciar sync periódico de catálogo
        _startCatalogSyncLoop();

        // 7. Iniciar retry de ventas con error
        _startSalesRetryLoop();

        // 8. Actualizar badge de pendientes
        await _updatePendingBadge();

        console.log(`[OfflineSync] ✅ Listo. Estado: ${_online ? '🟢 Online' : '🔴 Offline'}`);
    }

    // ============================================
    // DETECCIÓN DE CONEXIÓN
    // ============================================

    /**
     * navigator.onLine es poco confiable (solo detecta cable/wifi,
     * no si realmente hay internet). Hacemos ping real al servidor.
     */
    async function _checkConnection() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.pingTimeout);

            const response = await fetch(CONFIG.pingUrl, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
                headers: { 'X-Ping': 'offline-sync' }
            });

            clearTimeout(timeout);

            if (response.ok) {
                _lastPingOk = Date.now();
                _consecutiveFailures = 0;

                if (!_online) {
                    _setOnline(true);
                }
                return true;
            } else {
                throw new Error(`HTTP ${response.status}`);
            }

        } catch (error) {
            _consecutiveFailures++;

            // Solo marcar offline después de 2 fallos consecutivos
            // (evitar falsos negativos por un ping lento)
            if (_online && _consecutiveFailures >= 2) {
                _setOnline(false);
            }
            return false;
        }
    }

    /**
     * Cambiar estado online/offline y disparar efectos
     */
    function _setOnline(isOnline) {
        const wasOnline = _online;
        _online = isOnline;

        console.log(`[OfflineSync] ${isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}`);

        // Actualizar UI
        _updateStatusUI();

        // Notificar listeners
        _listeners.forEach(fn => {
            try { fn(isOnline); } catch (e) { console.error('[OfflineSync] Listener error:', e); }
        });

        // Si pasó de offline → online: sincronizar
        if (isOnline && !wasOnline) {
            _onReconnect();
        }

        // Si pasó de online → offline: notificar
        if (!isOnline && wasOnline) {
            _onDisconnect();
        }

        // Ajustar frecuencia de ping
        _startPingLoop();
    }

    function _handleBrowserOnline() {
        console.log('[OfflineSync] 📡 navigator: online');
        // No confiar ciegamente, verificar con ping real
        _checkConnection();
    }

    function _handleBrowserOffline() {
        console.log('[OfflineSync] 📡 navigator: offline');
        _setOnline(false);
    }

    // ============================================
    // RECONEXIÓN Y DESCONEXIÓN
    // ============================================

    function _onReconnect() {
        console.log('[OfflineSync] 🔄 Reconexión detectada. Iniciando sync...');

        _showToast('🟢 Conexión restaurada. Sincronizando...', 'success');

        // Esperar un momento (la conexión puede ser inestable al inicio)
        setTimeout(async () => {
            // Verificar que sigue online
            const stillOnline = await _checkConnection();
            if (!stillOnline) return;

            // 1. Sincronizar ventas pendientes
            await syncPendingSales();

            // 2. Sincronizar catálogo
            await syncCatalog();

            // 3. Registrar Background Sync para futuro
            _registerBackgroundSync();

        }, CONFIG.syncDelayAfterOnline);
    }

    function _onDisconnect() {
        console.log('[OfflineSync] ⚡ Desconexión detectada');

        _showToast('🔴 Sin conexión. Las ventas se guardarán localmente.', 'warning', 6000);

        // Registrar Background Sync (se ejecutará cuando vuelva internet)
        _registerBackgroundSync();
    }

    // ============================================
    // SINCRONIZACIÓN DE VENTAS
    // ============================================

    /**
     * Sincronizar todas las ventas pendientes con el servidor.
     * @returns {Promise<{synced: number, errors: number}>}
     */
    async function syncPendingSales() {
        if (_syncing) {
            console.log('[OfflineSync] Ya sincronizando, skip');
            return { synced: 0, errors: 0 };
        }

        if (!OfflineDB.isReady()) {
            console.warn('[OfflineSync] OfflineDB no inicializada');
            return { synced: 0, errors: 0 };
        }

        _syncing = true;
        _updateStatusUI('syncing');

        let synced = 0;
        let errors = 0;

        try {
            const pending = await OfflineDB.sales.getPending();

            if (pending.length === 0) {
                console.log('[OfflineSync] No hay ventas pendientes');
                return { synced: 0, errors: 0 };
            }

            console.log(`[OfflineSync] 📤 Sincronizando ${pending.length} ventas...`);
            _showToast(`📤 Sincronizando ${pending.length} venta${pending.length > 1 ? 's' : ''}...`, 'info');

            for (const sale of pending) {
                if (sale.status === 'syncing') continue;
                if (sale.retry_count >= 5) continue;

                try {
                    // Verificar que el token sigue válido
                    const token = sale.token || getAuthToken();
                    if (!token) {
                        await OfflineDB.sales.markError(sale.local_id, 'Sin token de autenticación');
                        errors++;
                        continue;
                    }

                    const response = await fetch(`${_getApiBase()}/sales`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'X-Offline-Sale': 'true',
                            'X-Local-Id': String(sale.local_id),
                            'X-Verification-Code': sale.verification_code || '',
                            'X-Created-At': sale.created_at || ''
                        },
                        body: JSON.stringify(sale.data)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        const serverId = result.id || result.sale_id;

                        await OfflineDB.sales.markSynced(sale.local_id, serverId);
                        synced++;

                        console.log(`[OfflineSync] ✅ Venta ${sale.local_id} → server #${serverId}`);

                    } else if (response.status === 401) {
                        // Token expirado — no reintentar con el mismo token
                        await OfflineDB.sales.markError(sale.local_id, 'Token expirado');
                        errors++;
                        console.warn(`[OfflineSync] ⚠️ Venta ${sale.local_id}: token expirado`);

                    } else if (response.status === 409) {
                        // Venta duplicada (ya existía en servidor) — marcar como synced
                        const errData = await response.json().catch(() => ({}));
                        const existingId = errData.sale_id || errData.existing_id;
                        await OfflineDB.sales.markSynced(sale.local_id, existingId || -1);
                        synced++;
                        console.log(`[OfflineSync] ↔️ Venta ${sale.local_id} ya existía en servidor`);

                    } else {
                        const errText = await response.text().catch(() => '');
                        await OfflineDB.sales.markError(sale.local_id, `HTTP ${response.status}: ${errText}`);
                        errors++;
                    }

                } catch (fetchError) {
                    // Perdió conexión durante el sync
                    console.warn(`[OfflineSync] Conexión perdida durante sync de venta ${sale.local_id}`);
                    _setOnline(false);
                    break; // Parar, se reintentará cuando vuelva internet
                }

                // Pequeña pausa entre ventas (no saturar servidor)
                await _sleep(300);
            }

        } catch (error) {
            console.error('[OfflineSync] Error general en sync:', error);

        } finally {
            _syncing = false;
            _updateStatusUI();
            await _updatePendingBadge();
        }

        // Resumen
        if (synced > 0 || errors > 0) {
            const msg = synced > 0
                ? `✅ ${synced} venta${synced > 1 ? 's' : ''} sincronizada${synced > 1 ? 's' : ''}`
                : `⚠️ ${errors} error${errors > 1 ? 'es' : ''} al sincronizar`;

            _showToast(msg, synced > 0 ? 'success' : 'warning');
            console.log(`[OfflineSync] Resultado: ${synced} synced, ${errors} errors`);
        }

        return { synced, errors };
    }

    // ============================================
    // SINCRONIZACIÓN DE CATÁLOGO
    // ============================================

    /**
     * Sincronizar catálogo de productos desde el servidor
     */
    async function syncCatalog() {
        if (!_online || !OfflineDB.isReady()) return;

        try {
            console.log('[OfflineSync] 📦 Sincronizando catálogo...');

            const token = _getAuthToken();
            if (!token) return;

            const result = await OfflineDB.products.syncFromServer(token, _getApiBase());

            if (result.added > 0 || result.updated > 0 || result.removed > 0) {
                console.log(`[OfflineSync] 📦 Catálogo: +${result.added}, ~${result.updated}, -${result.removed}`);
            }

        } catch (error) {
            // No es crítico — el catálogo anterior sigue disponible
            console.warn('[OfflineSync] Error sync catálogo:', error.message);
        }
    }

    // ============================================
    // BACKGROUND SYNC
    // ============================================

    async function _registerBackgroundSync() {
        if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;

        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.sync.register('sync-sales');
            console.log('[OfflineSync] 📋 Background sync registrado');
        } catch (error) {
            console.warn('[OfflineSync] Background sync no disponible:', error.message);
        }
    }

    function _handleSWMessage(event) {
        const { type, title, body } = event.data || {};

        switch (type) {
            case 'SYNC_CATALOG':
                // SW pide que sincronicemos catálogo
                syncCatalog();
                break;

            case 'SYNC_COMPLETE':
                _showToast('✅ Sincronización completada', 'success');
                _updatePendingBadge();
                break;

            case 'SYNC_ERROR':
                _showToast('⚠️ Error en sincronización', 'warning');
                break;

            case 'SHOW_TOAST':
                _showToast(`${title}: ${body}`, 'info');
                break;

            case 'SW_VERSION':
                console.log('[OfflineSync] SW version:', event.data.version);
                break;
        }
    }

    // ============================================
    // LOOPS PERIÓDICOS
    // ============================================

    function _startPingLoop() {
        if (_pingTimer) clearInterval(_pingTimer);

        const interval = _online ? CONFIG.pingInterval : CONFIG.pingIntervalOffline;

        _pingTimer = setInterval(() => {
            _checkConnection();
        }, interval);
    }

    function _startCatalogSyncLoop() {
        if (_catalogSyncTimer) clearInterval(_catalogSyncTimer);

        _catalogSyncTimer = setInterval(() => {
            if (_online && !_syncing) {
                syncCatalog();
            }
        }, CONFIG.catalogSyncInterval);
    }

    function _startSalesRetryLoop() {
        if (_salesRetryTimer) clearInterval(_salesRetryTimer);

        _salesRetryTimer = setInterval(async () => {
            if (!_online || _syncing || !OfflineDB.isReady()) return;

            // Resetear ventas con error para reintentar
            const reset = await OfflineDB.sales.resetErrors();
            if (reset > 0) {
                console.log(`[OfflineSync] 🔄 ${reset} ventas reseteadas para retry`);
                await syncPendingSales();
            }
        }, CONFIG.salesRetryInterval);
    }

    // ============================================
    // UI: INDICADOR DE ESTADO
    // ============================================

    function _injectStatusUI() {
        // Inyectar CSS
        const style = document.createElement('style');
        style.textContent = `
            /* ── Indicador de estado en header ── */
            .offline-indicator {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.3px;
                transition: all 0.4s ease;
                cursor: pointer;
                user-select: none;
            }

            .offline-indicator.online {
                background: rgba(16, 185, 129, 0.15);
                color: #10b981;
            }

            .offline-indicator.offline {
                background: rgba(239, 68, 68, 0.15);
                color: #ef4444;
                animation: offlinePulse 2s ease-in-out infinite;
            }

            .offline-indicator.syncing {
                background: rgba(59, 130, 246, 0.15);
                color: #3b82f6;
            }

            .offline-indicator .dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                transition: background 0.3s;
            }

            .offline-indicator.online .dot { background: #10b981; }
            .offline-indicator.offline .dot { background: #ef4444; }
            .offline-indicator.syncing .dot {
                background: #3b82f6;
                animation: spinDot 1s linear infinite;
            }

            @keyframes offlinePulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }

            @keyframes spinDot {
                0% { transform: scale(1); }
                50% { transform: scale(1.4); }
                100% { transform: scale(1); }
            }

            /* ── Badge de ventas pendientes ── */
            .pending-sales-badge {
                display: none;
                position: absolute;
                top: -4px;
                right: -4px;
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                background: #ef4444;
                color: white;
                border-radius: 9px;
                font-size: 10px;
                font-weight: 700;
                line-height: 18px;
                text-align: center;
                z-index: 10;
            }

            .pending-sales-badge.show {
                display: block;
                animation: badgePop 0.3s ease;
            }

            @keyframes badgePop {
                0% { transform: scale(0); }
                70% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }

            /* ── Barra de sync en progreso ── */
            .sync-progress-bar {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 3px;
                z-index: 99999;
                overflow: hidden;
                display: none;
            }

            .sync-progress-bar.active {
                display: block;
            }

            .sync-progress-bar .bar {
                width: 30%;
                height: 100%;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6, #3b82f6);
                background-size: 200% 100%;
                animation: syncBarMove 1.5s ease-in-out infinite;
                border-radius: 0 2px 2px 0;
            }

            @keyframes syncBarMove {
                0% { margin-left: -30%; }
                100% { margin-left: 100%; }
            }

            /* ── Toast offline-specific ── */
            .offline-toast {
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                padding: 10px 20px;
                border-radius: 12px;
                font-size: 13px;
                font-weight: 500;
                z-index: 99998;
                animation: toastSlideUp 0.3s ease;
                max-width: 90%;
                text-align: center;
                pointer-events: none;
            }

            .offline-toast.success {
                background: rgba(16, 185, 129, 0.95);
                color: white;
            }
            .offline-toast.warning {
                background: rgba(245, 158, 11, 0.95);
                color: white;
            }
            .offline-toast.info {
                background: rgba(59, 130, 246, 0.95);
                color: white;
            }
            .offline-toast.error {
                background: rgba(239, 68, 68, 0.95);
                color: white;
            }

            @keyframes toastSlideUp {
                from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);

        // Inyectar indicador en el header (al lado del botón de notificaciones)
        const headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            const indicator = document.createElement('div');
            indicator.id = CONFIG.statusIndicatorId;
            indicator.className = 'offline-indicator online';
            indicator.innerHTML = `<span class="dot"></span><span class="label">Online</span>`;
            indicator.title = 'Estado de conexión';
            indicator.onclick = _showSyncStatus;

            // Insertar antes de las acciones del header
            headerActions.parentNode.insertBefore(indicator, headerActions);
        }

        // Inyectar badge de pendientes en el botón de cobrar
        const checkoutBtn = document.getElementById('btn-checkout');
        if (checkoutBtn) {
            checkoutBtn.style.position = 'relative';
            const badge = document.createElement('span');
            badge.id = 'offline-pending-badge';
            badge.className = 'pending-sales-badge';
            badge.textContent = '0';
            checkoutBtn.appendChild(badge);
        }

        // Inyectar barra de progreso de sync
        const progressBar = document.createElement('div');
        progressBar.id = 'sync-progress-bar';
        progressBar.className = 'sync-progress-bar';
        progressBar.innerHTML = '<div class="bar"></div>';
        document.body.appendChild(progressBar);
    }

    function _updateStatusUI(forceState) {
        const indicator = document.getElementById(CONFIG.statusIndicatorId);
        if (!indicator) return;

        const state = forceState || (_online ? 'online' : 'offline');

        indicator.className = `offline-indicator ${state}`;

        const label = indicator.querySelector('.label');
        if (label) {
            switch (state) {
                case 'online':
                    label.textContent = 'Online';
                    break;
                case 'offline':
                    label.textContent = 'Offline';
                    break;
                case 'syncing':
                    label.textContent = 'Sincronizando...';
                    break;
            }
        }

        // Barra de progreso
        const bar = document.getElementById('sync-progress-bar');
        if (bar) {
            bar.classList.toggle('active', state === 'syncing');
        }
    }

    async function _updatePendingBadge() {
        if (!OfflineDB.isReady()) return;

        try {
            const count = await OfflineDB.sales.getPendingCount();
            const badge = document.getElementById('offline-pending-badge');

            if (badge) {
                badge.textContent = count;
                badge.classList.toggle('show', count > 0);
            }

            // También actualizar título de la página
            if (count > 0) {
                document.title = `(${count}) QueVendi - Dashboard`;
            } else {
                document.title = 'QueVendi - Dashboard';
            }

        } catch (e) {
            // No crítico
        }
    }

    /**
     * Mostrar panel de estado completo (al hacer clic en indicador)
     */
    async function _showSyncStatus() {
        if (!OfflineDB.isReady()) {
            _showToast('Base de datos no inicializada', 'warning');
            return;
        }

        try {
            const status = await OfflineDB.getStatus();

            const lastSync = status.last_product_sync !== 'nunca'
                ? new Date(status.last_product_sync).toLocaleString('es-PE', {
                    day: '2-digit', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                })
                : 'Nunca';

            // Usar showToast del dashboard si existe, sino el propio
            const msg = [
                `📊 ${status.emisor_name}`,
                `📱 ${status.device_id}`,
                `📦 ${status.products_cached} productos`,
                `⏱️ Último sync: ${lastSync}`,
                `📤 ${status.pending_sales} pendientes`,
                `✅ ${status.synced_sales} sincronizadas`,
                status.error_sales > 0 ? `❌ ${status.error_sales} con error` : '',
                `${status.online ? '🟢 Online' : '🔴 Offline'}`
            ].filter(Boolean).join('\n');

            // Crear modal temporal
            _showStatusModal(status, lastSync);

        } catch (e) {
            console.error('[OfflineSync] Error obteniendo estado:', e);
        }
    }

    function _showStatusModal(status, lastSync) {
        let modal = document.getElementById('sync-status-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'sync-status-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.75); z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            backdrop-filter: blur(4px);
        `;

        modal.innerHTML = `
            <div style="
                background: #1a1a2e; border-radius: 16px; padding: 24px;
                max-width: 380px; width: 90%; color: white;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 16px;">
                        ${status.online ? '🟢' : '🔴'} Estado del Sistema
                    </h3>
                    <button onclick="this.closest('#sync-status-modal').remove()" style="
                        background: none; border: none; color: #94a3b8;
                        font-size: 22px; cursor: pointer;
                    ">×</button>
                </div>

                <div style="background: rgba(255,255,255,0.05); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: #94a3b8; font-size: 13px;">Negocio</span>
                        <span style="font-weight: 600; font-size: 13px;">${status.emisor_name}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: #94a3b8; font-size: 13px;">Dispositivo</span>
                        <span style="font-size: 12px; font-family: monospace; color: #64748b;">${status.device_id}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: #94a3b8; font-size: 13px;">Productos offline</span>
                        <span style="font-weight: 600; color: ${status.products_cached > 0 ? '#10b981' : '#ef4444'};">${status.products_cached}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: #94a3b8; font-size: 13px;">Último sync</span>
                        <span style="font-size: 13px; color: ${lastSync !== 'Nunca' ? '#10b981' : '#f59e0b'};">${lastSync}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="color: #94a3b8; font-size: 13px;">Ventas pendientes</span>
                        <span style="font-weight: 600; color: ${status.pending_sales > 0 ? '#f59e0b' : '#10b981'};">${status.pending_sales}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 6px 0;">
                        <span style="color: #94a3b8; font-size: 13px;">Ventas sincronizadas</span>
                        <span style="font-weight: 600; color: #10b981;">${status.synced_sales}</span>
                    </div>
                    ${status.error_sales > 0 ? `
                    <div style="display: flex; justify-content: space-between; padding: 6px 0;">
                        <span style="color: #94a3b8; font-size: 13px;">Con error</span>
                        <span style="font-weight: 600; color: #ef4444;">${status.error_sales}</span>
                    </div>
                    ` : ''}
                </div>

                <div style="display: flex; gap: 8px;">
                    <button onclick="OfflineSync.forceSyncNow(); this.closest('#sync-status-modal').remove();" style="
                        flex: 1; padding: 12px; border: none; border-radius: 10px;
                        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                        color: white; font-weight: 600; font-size: 14px; cursor: pointer;
                    ">
                        🔄 Sincronizar ahora
                    </button>
                    <button onclick="this.closest('#sync-status-modal').remove()" style="
                        padding: 12px 16px; border: none; border-radius: 10px;
                        background: rgba(255,255,255,0.1); color: #94a3b8;
                        font-size: 14px; cursor: pointer;
                    ">Cerrar</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    // ============================================
    // HELPERS
    // ============================================

    function _showToast(message, type = 'info', duration) {
        // Intentar usar showToast del dashboard principal
        if (typeof showToast === 'function') {
            showToast(message, type);
            return;
        }

        // Fallback propio
        const toast = document.createElement('div');
        toast.className = `offline-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, duration || CONFIG.toastDuration);
    }

    function _getAuthToken() {
        if (typeof getAuthToken === 'function') return getAuthToken();
        return localStorage.getItem('access_token');
    }

    function _getApiBase() {
        if (typeof CONFIG !== 'undefined' && window.CONFIG?.apiBase) return window.CONFIG.apiBase;
        return `${window.location.origin}/api/v1`;
    }

    function _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    /**
     * ¿Estamos online?
     */
    function isOnline() {
        return _online;
    }

    /**
     * Forzar sincronización manual (botón del usuario)
     */
    async function forceSyncNow() {
        if (!_online) {
            _showToast('🔴 Sin conexión. No se puede sincronizar.', 'error');
            return;
        }

        _showToast('🔄 Sincronizando...', 'info');
        await syncPendingSales();
        await syncCatalog();
        await _updatePendingBadge();
    }

    /**
     * Registrar callback para cambios de estado
     * @param {Function} callback - fn(isOnline: boolean)
     * @returns {Function} unsubscribe
     */
    function onStatusChange(callback) {
        _listeners.push(callback);
        return () => {
            _listeners = _listeners.filter(fn => fn !== callback);
        };
    }

    /**
     * Limpiar (para testing o logout)
     */
    function destroy() {
        if (_pingTimer) clearInterval(_pingTimer);
        if (_catalogSyncTimer) clearInterval(_catalogSyncTimer);
        if (_salesRetryTimer) clearInterval(_salesRetryTimer);

        window.removeEventListener('online', _handleBrowserOnline);
        window.removeEventListener('offline', _handleBrowserOffline);

        _initialized = false;
        _listeners = [];

        const indicator = document.getElementById(CONFIG.statusIndicatorId);
        if (indicator) indicator.remove();

        console.log('[OfflineSync] Destruido');
    }

    return {
        init,
        isOnline,
        syncPendingSales,
        syncCatalog,
        forceSyncNow,
        onStatusChange,
        destroy
    };

})();

// ============================================
// EXPORT
// ============================================

window.OfflineSync = OfflineSync;
if (typeof module !== 'undefined' && module.exports) module.exports = OfflineSync;

console.log('[OfflineSync] 📡 Módulo cargado');