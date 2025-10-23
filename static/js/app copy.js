/**
 * QueVendí PRO - JavaScript Principal
 */

// Manejar respuesta del resumen de ventas
document.addEventListener('htmx:afterSwap', function(event) {
    // Si es el resumen de ventas
    if (event.detail.target.id === 'daily-summary') {
        try {
            const data = JSON.parse(event.detail.target.textContent);
            renderDailySummary(data);
        } catch (e) {
            console.error('Error parsing summary data:', e);
        }
    }
    
    // Si es la lista de ventas
    if (event.detail.target.id === 'sales-list') {
        try {
            const data = JSON.parse(event.detail.target.textContent);
            renderSalesList(data);
        } catch (e) {
            console.error('Error parsing sales list:', e);
        }
    }
});

// Renderizar resumen de ventas del día (formato compacto)
function renderDailySummary(data) {
    const summaryDiv = document.getElementById('daily-summary');
    
    const html = `
        <div style="flex: 1;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                Ventas de Hoy
            </div>
            <div class="card-amount">S/ ${data.total.toFixed(2)}</div>
        </div>
        <div style="text-align: right;">
            <div class="card-badge">En vivo</div>
            <div style="font-size: 12px; color: var(--text-light); margin-top: 6px;">
                ${data.count} ${data.count === 1 ? 'venta' : 'ventas'}
            </div>
        </div>
    `;
    
    summaryDiv.innerHTML = html;
}

// Renderizar lista de ventas
function renderSalesList(sales) {
    const salesList = document.getElementById('sales-list');
    
    if (!sales || sales.length === 0) {
        salesList.innerHTML = `
            <div class="empty-state">
                <svg class="icon" viewBox="0 0 24 24" style="width: 48px; height: 48px; opacity: 0.3; margin: 0 auto 16px; display: block;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 12h8M12 8v8"></path>
                </svg>
                <p style="text-align: center; color: var(--text-light);">No hay ventas registradas hoy</p>
                <p style="text-align: center; color: var(--text-light); font-size: 14px; margin-top: 8px;">¡Registra tu primera venta por voz!</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    sales.forEach(sale => {
        const date = new Date(sale.sale_date);
        const time = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        
        const items = sale.items.map(item => 
            `${item.quantity}x ${item.product_name}`
        ).join(', ');
        
        const paymentIcon = {
            'efectivo': '💵',
            'yape': '📱',
            'plin': '💳'
        }[sale.payment_method] || '💰';
        
        html += `
            <div class="card" style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="font-size: 13px; color: var(--text-light); margin-bottom: 4px;">
                            ${time} • ${sale.user_name}
                        </div>
                        <div style="font-size: 14px; color: var(--text);">
                            ${items}
                        </div>
                        ${sale.customer_name ? `<div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">Cliente: ${sale.customer_name}</div>` : ''}
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 18px; font-weight: 700; color: var(--accent);">
                            S/ ${sale.total.toFixed(2)}
                        </div>
                        <div style="font-size: 12px; color: var(--text-light);">
                            ${paymentIcon} ${sale.payment_method}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    salesList.innerHTML = html;
}

// Configuración general
function showConfig() {
    alert('Configuración próximamente...');
}

console.log('✅ QueVendí PRO inicializado');