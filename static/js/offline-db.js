/**
 * QueVendi - Offline Database (IndexedDB)
 * ========================================
 * MULTI-TENANT: cada negocio (emisor) tiene su propia DB aislada.
 * 
 * DB Name: QueVendiOffline_{emisor_id}
 *   → "Bodega Don Juan" (emisor 42): QueVendiOffline_42
 *   → "Minimarket Lucy" (emisor 87): QueVendiOffline_87
 * 
 * Uso:
 *   await OfflineDB.init(emisorId, 'Mi Bodega');
 *   await OfflineDB.products.search('coca cola');
 *   await OfflineDB.sales.queue(saleData, token);
 */

const OfflineDB = (() => {

    const DB_PREFIX = 'QueVendiOffline';
    const DB_VERSION = 1;

    let db = null;
    let _initPromise = null;
    let _emisorId = null;
    let _emisorName = null;

    // ============================================
    // INICIALIZACIÓN (MULTI-TENANT)
    // ============================================

    function init(emisorId, emisorName) {
        if (!emisorId) {
            return Promise.reject(new Error(
                'OfflineDB.init() requiere emisor_id. Ej: await OfflineDB.init(42, "Mi Bodega")'
            ));
        }

        if (_initPromise && _emisorId === String(emisorId)) return _initPromise;

        if (db && _emisorId !== String(emisorId)) {
            console.log(`[OfflineDB] Cambiando emisor ${_emisorId} → ${emisorId}`);
            db.close();
            db = null;
            _initPromise = null;
        }

        _emisorId = String(emisorId);
        _emisorName = emisorName || `Emisor #${emisorId}`;
        const dbName = `${DB_PREFIX}_${_emisorId}`;

        _initPromise = new Promise((resolve, reject) => {
            console.log(`[OfflineDB] Abriendo "${dbName}" para ${_emisorName}...`);
            const request = indexedDB.open(dbName, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                if (!database.objectStoreNames.contains('products')) {
                    const ps = database.createObjectStore('products', { keyPath: 'id' });
                    ps.createIndex('name', 'name_lower', { unique: false });
                    ps.createIndex('barcode', 'barcode', { unique: false });
                    ps.createIndex('category', 'category', { unique: false });
                    ps.createIndex('updated_at', 'updated_at', { unique: false });
                }

                if (!database.objectStoreNames.contains('pending_sales')) {
                    const ss = database.createObjectStore('pending_sales', {
                        keyPath: 'local_id', autoIncrement: true
                    });
                    ss.createIndex('status', 'status', { unique: false });
                    ss.createIndex('created_at', 'created_at', { unique: false });
                    ss.createIndex('synced', 'synced', { unique: false });
                }

                if (!database.objectStoreNames.contains('sync_meta')) {
                    database.createObjectStore('sync_meta', { keyPath: 'key' });
                }

                if (!database.objectStoreNames.contains('correlatives')) {
                    const cs = database.createObjectStore('correlatives', { keyPath: 'serie' });
                    cs.createIndex('remaining', 'remaining', { unique: false });
                }

                console.log('[OfflineDB] ✅ Stores creados');
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                db.onversionchange = () => { db.close(); db = null; _initPromise = null; };
                console.log(`[OfflineDB] ✅ Listo: "${_emisorName}" (emisor ${_emisorId})`);
                resolve(db);
            };

            request.onerror = (e) => { _initPromise = null; reject(e.target.error); };
            request.onblocked = () => { _initPromise = null; reject(new Error('DB bloqueada')); };
        });

        return _initPromise;
    }

    function _requireInit() {
        if (!db || !_emisorId) throw new Error('OfflineDB no inicializada');
    }

    function getStore(storeName, mode = 'readonly') {
        _requireInit();
        const tx = db.transaction(storeName, mode);
        return { store: tx.objectStore(storeName), tx };
    }

    function promisify(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ============================================
    // PRODUCTOS
    // ============================================

    const products = {

        async syncFromServer(token, apiBase) {
            _requireInit();
            const lastSync = await meta.get('products_last_sync');
            const since = lastSync ? lastSync.value : null;

            console.log(`[OfflineDB] Sync productos (emisor ${_emisorId}) desde: ${since || 'inicio'}`);

            const url = since
                ? `${apiBase}/products/catalog?since=${encodeURIComponent(since)}`
                : `${apiBase}/products/catalog`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const serverData = await response.json();
            const productList = serverData.products || serverData;
            const deletedIds = serverData.deleted_ids || [];
            const serverTime = serverData.server_time || new Date().toISOString();

            if (!Array.isArray(productList)) throw new Error('Respuesta inválida');

            let added = 0, updated = 0, removed = 0;
            const { store, tx } = getStore('products', 'readwrite');

            for (const p of productList) {
                const existing = await promisify(store.get(p.id));
                store.put({
                    id: p.id,
                    name: p.name,
                    name_lower: (p.name || '').toLowerCase(),
                    barcode: p.barcode || p.code || null,
                    sale_price: parseFloat(p.sale_price) || 0,
                    purchase_price: parseFloat(p.purchase_price) || 0,
                    stock: parseFloat(p.stock) || 0,
                    unit: p.unit || 'unidad',
                    category: p.category || null,
                    image_url: p.image_url || null,
                    allow_fractional: p.allow_fractional || false,
                    min_stock: p.min_stock || 0,
                    active: p.active !== false,
                    updated_at: p.updated_at || serverTime
                });
                existing ? updated++ : added++;
            }

            for (const delId of deletedIds) {
                try { store.delete(delId); removed++; } catch (e) {}
            }

            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
            await meta.set('products_last_sync', serverTime);

            const total = await this.count();
            console.log(`[OfflineDB] ✅ Sync: +${added}, ~${updated}, -${removed}, total=${total}`);
            return { added, updated, removed, total };
        },

        async search(query, limit = 20) {
            _requireInit();
            if (!query || query.length < 2) return [];

            const q = query.toLowerCase().trim();
            const terms = q.split(/\s+/);

            return new Promise((resolve, reject) => {
                const { store } = getStore('products', 'readonly');
                const results = [];
                const request = store.openCursor();

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor || results.length >= limit) {
                        results.sort((a, b) => b._score - a._score);
                        results.forEach(r => delete r._score);
                        resolve(results);
                        return;
                    }

                    const p = cursor.value;
                    if (!p.active || p.stock <= 0) { cursor.continue(); return; }

                    const name = p.name_lower;
                    let score = 0;

                    if (name === q) score = 100;
                    else if (name.startsWith(q)) score = 80;
                    else if (name.includes(q)) score = 60;
                    else if (terms.every(t => name.includes(t))) score = 40;
                    else if (terms.some(t => name.includes(t))) score = 20;
                    else if (p.barcode && p.barcode.includes(q)) score = 90;

                    if (score > 0) { p._score = score; results.push(p); }
                    cursor.continue();
                };

                request.onerror = () => reject(request.error);
            });
        },

        async getById(id) {
            _requireInit();
            const { store } = getStore('products', 'readonly');
            return promisify(store.get(id));
        },

        async getByBarcode(barcode) {
            _requireInit();
            const { store } = getStore('products', 'readonly');
            return promisify(store.index('barcode').get(barcode));
        },

        async decrementStock(productId, quantity) {
            _requireInit();
            const { store } = getStore('products', 'readwrite');
            const p = await promisify(store.get(productId));
            if (p) { p.stock = Math.max(0, p.stock - quantity); store.put(p); }
        },

        async count() {
            _requireInit();
            const { store } = getStore('products', 'readonly');
            return promisify(store.count());
        },

        async clear() {
            _requireInit();
            const { store } = getStore('products', 'readwrite');
            await promisify(store.clear());
            await meta.delete('products_last_sync');
        }
    };

    // ============================================
    // VENTAS PENDIENTES
    // ============================================

    const sales = {

        async queue(saleData, token) {
            _requireInit();
            const record = {
                emisor_id: parseInt(_emisorId),
                data: saleData,
                token: token,
                status: 'pending',
                synced: false,
                error_message: null,
                retry_count: 0,
                created_at: new Date().toISOString(),
                synced_at: null,
                server_sale_id: null,
                verification_code: this._generateVerificationCode()
            };

            const { store } = getStore('pending_sales', 'readwrite');
            const localId = await promisify(store.add(record));

            for (const item of (saleData.items || [])) {
                await products.decrementStock(item.product_id, item.quantity);
            }

            console.log(`[OfflineDB] 📝 Venta encolada: #${localId} (emisor ${_emisorId})`);
            return localId;
        },

        async getPending() {
            _requireInit();
            const { store } = getStore('pending_sales', 'readonly');
            return promisify(store.index('synced').getAll(false));
        },

        async getPendingCount() {
            _requireInit();
            const { store } = getStore('pending_sales', 'readonly');
            return promisify(store.index('synced').count(false));
        },

        async markSynced(localId, serverSaleId) {
            _requireInit();
            const { store } = getStore('pending_sales', 'readwrite');
            const r = await promisify(store.get(localId));
            if (r) {
                r.status = 'synced';
                r.synced = true;
                r.synced_at = new Date().toISOString();
                r.server_sale_id = serverSaleId;
                store.put(r);
            }
        },

        async markError(localId, errorMessage) {
            _requireInit();
            const { store } = getStore('pending_sales', 'readwrite');
            const r = await promisify(store.get(localId));
            if (r) {
                r.status = 'error';
                r.error_message = errorMessage;
                r.retry_count = (r.retry_count || 0) + 1;
                store.put(r);
            }
        },

        async resetErrors() {
            _requireInit();
            const { store } = getStore('pending_sales', 'readwrite');
            const all = await promisify(store.getAll());
            let n = 0;
            for (const r of all) {
                if (r.status === 'error' && r.retry_count < 5) {
                    r.status = 'pending'; r.error_message = null;
                    store.put(r); n++;
                }
            }
            return n;
        },

        async getByVerificationCode(code) {
            _requireInit();
            const { store } = getStore('pending_sales', 'readonly');
            const all = await promisify(store.getAll());
            return all.find(s => s.verification_code === code) || null;
        },

        async cleanup() {
            _requireInit();
            const { store } = getStore('pending_sales', 'readwrite');
            const all = await promisify(store.getAll());
            const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
            let n = 0;
            for (const r of all) {
                if (r.synced && r.synced_at && new Date(r.synced_at) < cutoff) {
                    store.delete(r.local_id); n++;
                }
            }
            return n;
        },

        _generateVerificationCode() {
            const now = new Date();
            const pad = (n, l = 2) => String(n).padStart(l, '0');
            return 'VNT-' + now.getFullYear() +
                pad(now.getMonth() + 1) + pad(now.getDate()) +
                pad(now.getHours()) + pad(now.getMinutes()) +
                pad(now.getSeconds()) + pad(Math.floor(Math.random() * 100));
        },

        async getAll(limit = 50) {
            _requireInit();
            const { store } = getStore('pending_sales', 'readonly');
            const all = await promisify(store.getAll());
            all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return all.slice(0, limit);
        }
    };

    // ============================================
    // CORRELATIVOS
    // ============================================

    const correlatives = {

        async saveBlock(serie, from, to) {
            _requireInit();
            const { store } = getStore('correlatives', 'readwrite');
            store.put({
                serie, current: from, from, to,
                remaining: to - from + 1,
                reserved_at: new Date().toISOString()
            });
        },

        async getNext(serie) {
            _requireInit();
            const { store } = getStore('correlatives', 'readwrite');
            const block = await promisify(store.get(serie));
            if (!block || block.remaining <= 0) return null;

            const correlativo = block.current;
            block.current++; block.remaining--;
            store.put(block);
            return { serie, correlativo };
        },

        async getRemaining(serie) {
            _requireInit();
            const { store } = getStore('correlatives', 'readonly');
            const b = await promisify(store.get(serie));
            return b ? b.remaining : 0;
        },

        async getStatus() {
            _requireInit();
            const { store } = getStore('correlatives', 'readonly');
            return promisify(store.getAll());
        }
    };

    // ============================================
    // METADATA
    // ============================================

    const meta = {
        async get(key) {
            _requireInit();
            return promisify(getStore('sync_meta', 'readonly').store.get(key));
        },
        async set(key, value) {
            _requireInit();
            getStore('sync_meta', 'readwrite').store.put({
                key, value, updated_at: new Date().toISOString()
            });
        },
        async delete(key) {
            _requireInit();
            getStore('sync_meta', 'readwrite').store.delete(key);
        },
        async getDeviceId() {
            const existing = await this.get('device_id');
            if (existing) return existing.value;
            const id = 'DEV-' + crypto.randomUUID().split('-')[0].toUpperCase();
            await this.set('device_id', id);
            return id;
        }
    };

    // ============================================
    // DIAGNÓSTICO Y UTILIDADES
    // ============================================

    async function getStatus() {
        _requireInit();
        const allSales = await sales.getAll(100);
        return {
            emisor_id: _emisorId,
            emisor_name: _emisorName,
            device_id: await meta.getDeviceId(),
            products_cached: await products.count(),
            last_product_sync: (await meta.get('products_last_sync'))?.value || 'nunca',
            pending_sales: await sales.getPendingCount(),
            synced_sales: allSales.filter(s => s.synced).length,
            error_sales: allSales.filter(s => s.status === 'error').length,
            correlative_blocks: (await correlatives.getStatus()).map(b => ({
                serie: b.serie, remaining: b.remaining,
                range: `${b.from}-${b.to}`, current: b.current
            })),
            online: navigator.onLine,
            db_version: DB_VERSION
        };
    }

    function getEmisorId() { return _emisorId; }
    function isReady() { return db !== null && _emisorId !== null; }

    async function destroy() {
        const dbName = db ? db.name : `${DB_PREFIX}_${_emisorId}`;
        if (db) { db.close(); db = null; _initPromise = null; }
        return new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(dbName);
            req.onsuccess = () => { _emisorId = null; _emisorName = null; resolve(); };
            req.onerror = () => reject(req.error);
        });
    }

    async function listAllDatabases() {
        if (!indexedDB.databases) return [];
        const all = await indexedDB.databases();
        return all
            .filter(d => d.name.startsWith(DB_PREFIX + '_'))
            .map(d => ({
                name: d.name,
                emisor_id: d.name.replace(DB_PREFIX + '_', ''),
                version: d.version
            }));
    }

    return {
        init, isReady, getEmisorId,
        products, sales, correlatives, meta,
        getStatus, destroy, listAllDatabases
    };

})();

window.OfflineDB = OfflineDB;
if (typeof module !== 'undefined' && module.exports) module.exports = OfflineDB;
console.log('[OfflineDB] 📦 Módulo cargado (multi-tenant)');