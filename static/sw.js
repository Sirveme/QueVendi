/**
 * QueVendi - Service Worker v2
 * ============================
 * PWA offline-first para POS en zonas sin internet.
 * 
 * Estrategias:
 *   App Shell (HTML/CSS/JS)  → Cache First + background update
 *   API /products/catalog    → Network First (sync catálogo)
 *   API /sales, /billing     → Network Only + queue offline
 *   Estáticos (img/fonts)    → Cache First
 *   Otros HTML               → Stale While Revalidate
 * 
 * Background Sync:
 *   'sync-sales'  → Envía ventas pendientes de IndexedDB
 *   'sync-catalog' → Actualiza catálogo de productos
 */

// ============================================
// VERSIÓN Y CACHE
// ============================================

// Al subir esta versión se descartan TODAS las cachés anteriores en `activate`.
// Hay que subirla siempre que cambie SHELL_ASSETS o las estrategias de abajo,
// porque es lo único que garantiza que un equipo con la app abierta hace
// semanas deje de servir el shell viejo.
const SW_VERSION = 'v3.0.3';
const CACHE_SHELL = `quevendi-shell-${SW_VERSION}`;
const CACHE_ASSETS = `quevendi-assets-${SW_VERSION}`;
const CACHE_API = `quevendi-api-${SW_VERSION}`;

// El shell del POS. Debe reflejar EXACTAMENTE lo que carga
// app/templates/dashboard_principal.html, incluidos los sufijos ?v=:
// si aquí falta un script, la app no abre sin internet; si sobra uno
// con versión vieja, se cachea un archivo que ya nadie pide.
//
// Regla de mantenimiento: al cambiar un ?v= en la plantilla, cambiarlo
// también aquí y subir SW_VERSION. Son el mismo cambio.
const SHELL_ASSETS = [
    // HTML del POS. Se sirve en las dos rutas, y las dos deben abrir
    // sin internet porque el usuario puede tener cualquiera guardada.
    '/home',
    '/dashboard',

    // La pantalla de login. Si el POS rebota aquí sin internet (token
    // ausente o vencido) y la página no está cacheada, la app queda
    // muerta: ni siquiera puede explicar qué pasa.
    '/auth/login',

    // CSS
    '/static/css/dashboard_principal.css?v=20260915b',
    '/static/css/cart_v2.css',
    '/static/css/checkout_v2.css',

    // JS — la lista real del POS, en el orden en que la plantilla la carga
    '/static/js/audio_assistant.js',
    '/static/js/modules/voice-parser.js',
    '/static/js/modules/voice-commands.js',
    '/static/js/modules/voice-help.js?v=20260502',
    '/static/js/modules/ui-feedback.js',
    '/static/js/modules/fractional-sales.js',
    '/static/js/modules/cart-animations.js',
    '/static/js/modules/layered-variants.js',
    '/static/js/offline-db.js?v=20260915a',
    '/static/js/offline-sync.js?v=20260913a',
    '/static/js/offline-billing.js?v=20260913a',
    '/static/js/offline-sale.js?v=20260913a',
    '/static/js/pwa-install.js?v=20260913a',
    '/static/js/dashboard_principal.js?v=20260915b',
    '/static/js/thermal-printer.js',
    '/static/js/print-agent-client.js',
    '/static/js/print-agent-integration.js',
    '/static/js/ticket-builder.js?v=20260502',
    '/static/js/cocina-enviar.js',
    '/static/js/caja-cocina-avisos.js',
    '/static/js/barcode-venta.js?v=20260915b',
    '/static/js/venta-lista-precio.js',
    '/static/js/caja-multipago.js',
    '/static/js/bluetooth_printer.js',

    // Fonts & Icons (CDN - se cachean en install)
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',

    // Imágenes críticas. Sólo las que existen de verdad en producción:
    // las rutas /static/img/icon-*.png que había aquí daban 404.
    '/static/icon-192.png',
    '/static/icon-512.png',
    '/static/img/logo-quevendi.webp',

    // Manifest
    '/static/manifest.json',

    // Página offline fallback
    '/static/offline.html'
];

// Rutas de API que NUNCA se cachean (write operations)
const API_NO_CACHE = [
    '/api/v1/sales',
    '/api/v1/billing/emitir',
    '/api/v1/fiados',
    '/api/v1/voice/',
    '/api/v1/auth/'
];

// ============================================
// INSTALL
// ============================================

self.addEventListener('install', (event) => {
    console.log(`[SW ${SW_VERSION}] Instalando...`);

    event.waitUntil(
        caches.open(CACHE_SHELL)
            .then(cache => {
                console.log(`[SW] Cacheando ${SHELL_ASSETS.length} recursos del shell`);

                // Cachear cada recurso individualmente (no falla si uno no existe)
                return Promise.allSettled(
                    SHELL_ASSETS.map(url =>
                        cache.add(url).catch(err => {
                            console.warn(`[SW] ⚠️ No se pudo cachear: ${url}`, err.message);
                        })
                    )
                );
            })
            .then(results => {
                const cached = results.filter(r => r.status === 'fulfilled').length;
                const failed = results.filter(r => r.status === 'rejected').length;
                console.log(`[SW] ✅ Shell: ${cached} cacheados, ${failed} fallidos`);
            })
            .catch(err => console.error('[SW] ❌ Error en install:', err))
    );

    // Activar inmediatamente (no esperar a que cierren pestañas)
    self.skipWaiting();
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener('activate', (event) => {
    console.log(`[SW ${SW_VERSION}] Activando...`);

    // Limpiar caches de versiones anteriores
    event.waitUntil(
        caches.keys()
            .then(names => {
                const validCaches = [CACHE_SHELL, CACHE_ASSETS, CACHE_API];
                return Promise.all(
                    names
                        .filter(name => name.startsWith('quevendi-') && !validCaches.includes(name))
                        .map(name => {
                            console.log(`[SW] 🗑️ Eliminando cache antiguo: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log(`[SW ${SW_VERSION}] ✅ Activado`);
            })
    );

    // Tomar control de todas las páginas inmediatamente
    self.clients.claim();
});

// ============================================
// FETCH — Router de estrategias
// ============================================

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Solo interceptar GET (POST de ventas se maneja en sync)
    if (request.method !== 'GET') return;

    // Ignorar requests de extensiones, chrome-extension, etc.
    if (!url.protocol.startsWith('http')) return;

    // ── ROUTER ──

    // 1. API de catálogo: Network First (necesitamos datos frescos si hay red)
    if (url.pathname.includes('/api/v1/products/')) {
        event.respondWith(networkFirst(request, CACHE_API));
        return;
    }

    // 2. API de ventas del día / reportes: Network First
    if (url.pathname.includes('/api/v1/sales/')) {
        event.respondWith(networkFirst(request, CACHE_API));
        return;
    }

    // 3. Otras APIs: Network Only (no cachear datos sensibles)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkOnly(request));
        return;
    }

    // 4. Estáticos (img, fonts, css, js): Cache First
    if (isStaticAsset(url)) {
        event.respondWith(cacheFirst(request, CACHE_ASSETS));
        return;
    }

    // 5. CDN externo (fonts, icons): Cache First
    if (url.origin !== self.location.origin) {
        event.respondWith(cacheFirst(request, CACHE_ASSETS));
        return;
    }

    // 6. Páginas HTML: Stale While Revalidate
    event.respondWith(staleWhileRevalidate(request, CACHE_SHELL));
});

// ============================================
// ESTRATEGIAS DE CACHE
// ============================================

/**
 * Network First: intenta red, si falla usa cache.
 * Ideal para APIs que queremos frescas pero necesitamos offline.
 */
async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);

        if (response && response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }

        return response;

    } catch (error) {
        const cached = await caches.match(request);
        if (cached) {
            console.log(`[SW] 📦 Cache hit (offline): ${request.url}`);
            return cached;
        }

        // Para APIs, devolver JSON de error
        return new Response(
            JSON.stringify({
                error: 'offline',
                message: 'Sin conexión. Datos no disponibles.',
                offline: true
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

/**
 * Cache First: busca en cache, si no existe va a red.
 * Ideal para estáticos que no cambian frecuentemente.
 */
async function cacheFirst(request, cacheName) {
    // 1. Coincidencia EXACTA, con querystring incluido.
    //
    // El orden importa. Si aquí se ignorara el ?v=, un archivo recién
    // desplegado con versión nueva seguiría sirviéndose desde la copia
    // vieja: sería anular el cache-busting justo en la capa que debería
    // respetarlo. La coincidencia exacta va primero, siempre.
    const exacto = await caches.match(request);
    if (exacto) return exacto;

    try {
        const response = await fetch(request);

        if (response && response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }

        return response;

    } catch (error) {
        // 2. Sin red y sin copia exacta: recién ahora se acepta una versión
        //    distinta del mismo archivo. Pasa cuando se desplegó un ?v=
        //    nuevo y el equipo se quedó sin internet antes de descargarlo.
        //    Un JS de la versión anterior hace funcionar el POS; no tenerlo
        //    lo deja en blanco. Entre esas dos, sirve el viejo.
        const aproximado = await caches.match(request, { ignoreSearch: true });
        if (aproximado) {
            console.warn('[SW] ⚠️ Sirviendo versión cacheada distinta de:', request.url);
            return aproximado;
        }

        // Placeholder de imagen: sólo si de verdad está cacheado. El código
        // anterior devolvía caches.match() de un archivo que no existe, y un
        // `undefined` en respondWith rompe la petición en vez de degradarla.
        if (request.url.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) {
            const ph = await caches.match('/static/img/logo-quevendi.webp');
            if (ph) return ph;
        }

        return new Response('Offline', { status: 503 });
    }
}

/**
 * Stale While Revalidate: devuelve cache inmediatamente,
 * actualiza en background para la próxima vez.
 * Ideal para páginas HTML.
 */
async function staleWhileRevalidate(request, cacheName) {
    const cached = await caches.match(request);

    // Actualizar en background (no bloquea)
    const fetchPromise = fetch(request)
        .then(response => {
            if (response && response.ok) {
                caches.open(cacheName)
                    .then(cache => cache.put(request, response.clone()));
            }
            return response;
        })
        .catch(() => null);

    // Si hay cache, devolver inmediatamente
    if (cached) return cached;

    // Si no hay cache, esperar la red
    const networkResponse = await fetchPromise;
    if (networkResponse) return networkResponse;

    // Sin red y sin copia exacta: aceptar la misma página con otro
    // querystring (/home?algo) antes de darla por perdida.
    const aproximado = await caches.match(request, { ignoreSearch: true });
    if (aproximado) return aproximado;

    // Último recurso: la página offline. Ojo: caches.match devuelve una
    // promesa, que SIEMPRE es truthy — el `||` de antes nunca se evaluaba
    // y si offline.html no estaba cacheado se respondía `undefined`.
    const offline = await caches.match('/static/offline.html');
    if (offline) return offline;

    return new Response(offlineFallbackHTML(), {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

/**
 * Network Only: solo red, sin cache.
 * Para APIs de escritura y datos sensibles.
 */
async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch (error) {
        return new Response(
            JSON.stringify({ error: 'offline', message: 'Sin conexión', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// ============================================
// BACKGROUND SYNC
// ============================================

self.addEventListener('sync', (event) => {
    console.log(`[SW] 🔄 Sync event: ${event.tag}`);

    if (event.tag === 'sync-sales') {
        event.waitUntil(syncPendingSales());
    }

    if (event.tag === 'sync-catalog') {
        event.waitUntil(syncCatalog());
    }
});

/**
 * Sincronizar ventas pendientes cuando hay internet.
 * Lee de IndexedDB (QueVendiOffline_{emisor}) y envía al servidor.
 */
async function syncPendingSales() {
    console.log('[SW] Sincronizando ventas pendientes...');

    try {
        // Buscar todas las DBs de QueVendi
        const allDbs = await indexedDB.databases();
        const quevendiDbs = allDbs.filter(d => d.name.startsWith('QueVendiOffline_'));

        for (const dbInfo of quevendiDbs) {
            try {
                await syncSalesFromDB(dbInfo.name);
            } catch (err) {
                console.error(`[SW] Error sync DB ${dbInfo.name}:`, err);
            }
        }

    } catch (error) {
        console.error('[SW] Error en syncPendingSales:', error);
        throw error; // Reintentar automáticamente
    }
}

/**
 * Sincronizar ventas de una DB específica de emisor
 */
async function syncSalesFromDB(dbName) {
    const db = await openIDB(dbName);
    if (!db) return;

    try {
        const tx = db.transaction('pending_sales', 'readonly');
        const store = tx.objectStore('pending_sales');
        const index = store.index('synced');

        const pendingSales = await idbGetAll(index, false);
        console.log(`[SW] ${dbName}: ${pendingSales.length} ventas pendientes`);

        for (const sale of pendingSales) {
            if (sale.status === 'syncing') continue; // Ya se está procesando
            if (sale.retry_count >= 5) continue;     // Máximo de reintentos

            try {
                // Marcar como "sincronizando"
                await updateSaleStatus(db, sale.local_id, 'syncing');

                // Enviar al servidor
                const response = await fetch('/api/v1/sales', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${sale.token}`,
                        'X-Offline-Sale': 'true',
                        'X-Local-Id': String(sale.local_id),
                        'X-Verification-Code': sale.verification_code
                    },
                    body: JSON.stringify(sale.data)
                });

                if (response.ok) {
                    const result = await response.json();
                    await markSaleSynced(db, sale.local_id, result.id || result.sale_id);

                    // Notificar al usuario
                    await notifyClient(
                        '✅ Venta sincronizada',
                        `S/. ${sale.data.items?.reduce((s, i) => s + (i.subtotal || 0), 0).toFixed(2) || '?'} — Sincronizado exitosamente`
                    );

                    console.log(`[SW] ✅ Venta ${sale.local_id} sincronizada`);

                } else {
                    const errBody = await response.text();
                    await updateSaleStatus(db, sale.local_id, 'error', errBody);
                    console.warn(`[SW] ⚠️ Venta ${sale.local_id} falló: ${response.status}`);
                }

            } catch (fetchError) {
                // Sin internet todavía — volver a pending
                await updateSaleStatus(db, sale.local_id, 'pending');
                throw fetchError; // Propagrar para retry de BackgroundSync
            }
        }

    } finally {
        db.close();
    }
}

/**
 * Sincronizar catálogo de productos (background)
 */
async function syncCatalog() {
    console.log('[SW] Sincronizando catálogo...');

    // Notificar a la página principal para que use OfflineDB.products.syncFromServer()
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
        client.postMessage({
            type: 'SYNC_CATALOG',
            timestamp: new Date().toISOString()
        });
    }
}

// ============================================
// MENSAJES DESDE LA PÁGINA
// ============================================

self.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'GET_VERSION':
            event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
            break;

        case 'CACHE_UPDATED':
            // La página avisa que hay recursos nuevos que cachear
            if (payload && payload.urls) {
                caches.open(CACHE_SHELL).then(cache => {
                    payload.urls.forEach(url => {
                        cache.add(url).catch(() => {});
                    });
                });
            }
            break;

        case 'FORCE_SYNC':
            // Forzar sincronización manual
            syncPendingSales()
                .then(() => event.source.postMessage({ type: 'SYNC_COMPLETE' }))
                .catch(err => event.source.postMessage({ type: 'SYNC_ERROR', error: err.message }));
            break;

        default:
            break;
    }
});

// ============================================
// PUSH NOTIFICATIONS (futuro)
// ============================================

self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const data = event.data.json();
        event.waitUntil(
            self.registration.showNotification(data.title || 'QueVendi', {
                body: data.body || '',
                icon: '/static/icon-192.png',
                badge: '/static/icon-192.png',
                data: data
            })
        );
    } catch (e) {
        console.error('[SW] Error en push:', e);
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window' })
            .then(clients => {
                // Si hay una pestaña abierta, enfocarla
                for (const client of clients) {
                    if (client.url.includes('/v2') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Si no, abrir nueva
                return self.clients.openWindow('/v2');
            })
    );
});

// ============================================
// HELPERS
// ============================================

function isStaticAsset(url) {
    return url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)(\?.*)?$/);
}

/**
 * Abrir IndexedDB directamente desde el SW
 */
function openIDB(dbName) {
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open(dbName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => { console.error(`[SW] No se pudo abrir ${dbName}`); resolve(null); };
        } catch (e) {
            resolve(null);
        }
    });
}

function idbGetAll(indexOrStore, query) {
    return new Promise((resolve) => {
        try {
            const request = query !== undefined ? indexOrStore.getAll(query) : indexOrStore.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

function updateSaleStatus(db, localId, status, errorMsg) {
    return new Promise((resolve) => {
        try {
            const tx = db.transaction('pending_sales', 'readwrite');
            const store = tx.objectStore('pending_sales');
            const request = store.get(localId);

            request.onsuccess = () => {
                const sale = request.result;
                if (sale) {
                    sale.status = status;
                    if (errorMsg) {
                        sale.error_message = errorMsg;
                        sale.retry_count = (sale.retry_count || 0) + 1;
                    }
                    store.put(sale);
                }
                resolve();
            };
            request.onerror = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}

function markSaleSynced(db, localId, serverSaleId) {
    return new Promise((resolve) => {
        try {
            const tx = db.transaction('pending_sales', 'readwrite');
            const store = tx.objectStore('pending_sales');
            const request = store.get(localId);

            request.onsuccess = () => {
                const sale = request.result;
                if (sale) {
                    sale.status = 'synced';
                    sale.synced = true;
                    sale.synced_at = new Date().toISOString();
                    sale.server_sale_id = serverSaleId;
                    store.put(sale);
                }
                resolve();
            };
            request.onerror = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}

/**
 * Enviar notificación al usuario a través de la pestaña abierta
 */
async function notifyClient(title, body) {
    try {
        // Intentar notificación del sistema
        if (self.registration.showNotification) {
            await self.registration.showNotification(title, {
                body: body,
                icon: '/static/icon-192.png',
                badge: '/static/icon-192.png',
                silent: false,
                tag: 'sync-notification'
            });
        }
    } catch (e) {
        // Fallback: enviar mensaje a la página
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
            client.postMessage({ type: 'SHOW_TOAST', title, body });
        }
    }
}

/**
 * HTML de fallback cuando no hay cache ni red
 */
function offlineFallbackHTML() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QueVendi - Sin conexión</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #0f0f23;
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 20px;
        }
        .offline-container {
            max-width: 400px;
        }
        .offline-icon {
            font-size: 64px;
            margin-bottom: 20px;
            opacity: 0.8;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 12px;
            color: #ff6b35;
        }
        p {
            color: #94a3b8;
            margin-bottom: 24px;
            line-height: 1.6;
        }
        .retry-btn {
            padding: 14px 32px;
            background: linear-gradient(135deg, #ff6b35, #ff8c42);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .retry-btn:active {
            transform: scale(0.95);
        }
        .version {
            position: fixed;
            bottom: 10px;
            right: 10px;
            font-size: 11px;
            color: #334155;
        }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1>Sin conexión</h1>
        <p>
            No hay internet disponible y la app no se había cacheado previamente.
            <br><br>
            Conéctate a internet para cargar QueVendi por primera vez.
            Después podrás usarlo sin conexión.
        </p>
        <button class="retry-btn" onclick="location.reload()">
            🔄 Reintentar
        </button>
    </div>
    <div class="version">SW ${SW_VERSION}</div>
</body>
</html>`;
}

// ============================================

console.log(`[SW ${SW_VERSION}] Service Worker cargado`);