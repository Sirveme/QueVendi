/**
 * QueVendi — Instalación de la PWA y registro del Service Worker
 * ==============================================================
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Toda la maquinaria PWA (manifest, service worker, base de datos local,
 * cola de ventas) se construyó hace meses apuntando a /v2. Después el POS
 * se mudó a /home sobre dashboard_principal.html, que es una plantilla
 * standalone: no extiende base.html, que era donde vivía el registro del
 * service worker. Resultado: la maquinaria quedó completa pero huérfana.
 *
 * Sin un service worker registrado Chrome nunca dispara
 * `beforeinstallprompt`, así que el botón de instalar no podía aparecer
 * por más que el manifest fuera válido. Y sin service worker tampoco hay
 * nada cacheado, así que la app no abre sin internet.
 *
 * Este módulo vuelve a enganchar las dos cosas en el POS vivo.
 *
 * DEPENDE DE
 * ----------
 * - /sw.js               el service worker, servido desde la raíz para
 *                        que su alcance sea "/" y cubra /home
 * - /static/manifest.json  start_url: /home
 * - #btn-install         el botón en el header (oculto hasta que Chrome avisa)
 */

(() => {
    'use strict';

    const RUTA_SW = '/sw.js';   // desde la raíz: alcance "/", cubre /home
    // Chrome puede tardar en decidir que el sitio es instalable; el botón
    // permanece oculto hasta que lo confirme.
    const btnInstalar = () => document.getElementById('btn-install');

    let promptDiferido = null;

    // ============================================
    // SERVICE WORKER
    // ============================================

    function registrarServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            console.warn('[PWA] Este navegador no soporta service workers');
            return;
        }

        // Se espera a 'load' para no competir con la carga inicial del POS,
        // que es lo que el vendedor está esperando ver.
        window.addEventListener('load', async () => {
            try {
                const reg = await navigator.serviceWorker.register(RUTA_SW);
                console.log('[PWA] ✅ Service worker registrado:', reg.scope);

                // Buscar versión nueva cada hora. Sin esto, un equipo que
                // nunca cierra la pestaña se queda con la versión vieja.
                setInterval(() => reg.update(), 60 * 60 * 1000);

                navigator.serviceWorker.addEventListener('message', (ev) => {
                    if (ev.data && ev.data.type === 'SYNC_COMPLETE') {
                        // La cola offline terminó de subir: refrescar lo que
                        // el POS muestre de pendientes, si esa función existe.
                        if (typeof window.actualizarPendientesOffline === 'function') {
                            window.actualizarPendientesOffline();
                        }
                    }
                });
            } catch (e) {
                console.error('[PWA] ❌ No se pudo registrar el service worker:', e);
            }
        });
    }

    // ============================================
    // BOTÓN DE INSTALAR
    // ============================================

    function yaEstaInstalada() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;   // iOS
    }

    function mostrarBoton(visible) {
        const b = btnInstalar();
        if (b) b.style.display = visible ? 'flex' : 'none';
    }

    async function instalar() {
        if (!promptDiferido) return;

        promptDiferido.prompt();
        const { outcome } = await promptDiferido.userChoice;
        console.log('[PWA] El usuario eligió:', outcome);

        // El evento sólo sirve una vez: haya aceptado o no, se descarta.
        // Si rechazó, Chrome volverá a ofrecerlo más adelante por su cuenta.
        promptDiferido = null;
        mostrarBoton(false);
    }

    function cablearInstalacion() {
        window.addEventListener('beforeinstallprompt', (e) => {
            // Se retiene el evento para poder lanzarlo desde nuestro botón,
            // en el momento en que el vendedor lo pida.
            e.preventDefault();
            promptDiferido = e;
            console.log('[PWA] Chrome confirma que es instalable');
            if (!yaEstaInstalada()) mostrarBoton(true);
        });

        window.addEventListener('appinstalled', () => {
            console.log('[PWA] ✅ Instalada');
            promptDiferido = null;
            mostrarBoton(false);
            if (typeof showToast === 'function') {
                showToast('QueVendi quedó instalada en este equipo', 'success');
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            const b = btnInstalar();
            if (b) b.addEventListener('click', instalar);
            if (yaEstaInstalada()) mostrarBoton(false);
        });
    }

    // ============================================
    // ARRANQUE
    // ============================================

    registrarServiceWorker();
    cablearInstalacion();

    // Expuesto por si hiciera falta lanzarlo desde otro sitio (menú, ayuda).
    window.PWAInstall = { instalar, yaEstaInstalada };
})();
