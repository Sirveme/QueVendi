/**
 * QueVendí PRO - JavaScript Principal
 */

console.log('✅ QueVendí PRO inicializado');

// ========================================
// CONFIGURAR HTMX CON AUTENTICACIÓN
// ========================================
document.body.addEventListener('htmx:configRequest', function(event) {
    const token = localStorage.getItem('access_token');
    if (token) {
        event.detail.headers['Authorization'] = `Bearer ${token}`;
        console.log('[HTMX] Token agregado a request:', event.detail.path);
    } else {
        console.warn('[HTMX] No hay token para:', event.detail.path);
    }
});

// Manejar errores 401
document.body.addEventListener('htmx:responseError', function(event) {
    console.error('[HTMX] Error en respuesta:', event.detail);
    
    if (event.detail.xhr.status === 401) {
        console.log('[Auth] 401 detectado - redirigiendo a login');
        localStorage.clear();
        window.location.href = '/auth/login';
    }
});