"""
Endpoints de reportes para QueVendí PRO
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from zoneinfo import ZoneInfo
from datetime import datetime, date, timedelta
from app.core.database import get_db
from app.models.sale import Sale, SaleItem
from app.models.product import Product
from app.api.dependencies import get_current_user
from app.models.user import User

#router = APIRouter(prefix="/reports", tags=["reports"])
router = APIRouter()

@router.get("/stats/today", response_class=HTMLResponse)
async def get_today_stats_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Estadísticas del día en formato HTML"""
    
    # ✅ USAR TIMEZONE DE PERÚ
    #peru_tz = ZoneInfo("America/Lima")
    from datetime import timezone, timedelta
    peru_tz = timezone(timedelta(hours=-5))  # UTC-5 para Perú
    
    # Fecha actual en Perú
    now_peru = datetime.now(peru_tz)
    today_peru = now_peru.date()
    
    # Inicio del día en Perú (00:00:00 -05:00)
    today_start = datetime.combine(today_peru, datetime.min.time(), tzinfo=peru_tz)
    
    # Fin del día en Perú (23:59:59 -05:00)
    today_end = datetime.combine(today_peru, datetime.max.time(), tzinfo=peru_tz)
    
    print(f"[Reports] Buscando ventas del día en Perú:")
    print(f"[Reports]   Desde: {today_start}")
    print(f"[Reports]   Hasta: {today_end}")
    
    # Ventas de hoy
    today_sales = db.query(Sale).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at <= today_end
    ).all()
    
    print(f"[Reports] Ventas encontradas: {len(today_sales)}")
    
    # Ventas de ayer
    yesterday_start = today_start - timedelta(days=1)
    yesterday_end = today_end - timedelta(days=1)
    
    yesterday_sales = db.query(Sale).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= yesterday_start,
        Sale.created_at <= yesterday_end
    ).all()
    
    # Calcular métricas
    today_total = sum(sale.total for sale in today_sales)
    today_count = len(today_sales)
    
    yesterday_total = sum(sale.total for sale in yesterday_sales)
    yesterday_count = len(yesterday_sales)
    
    # Calcular tendencias
    total_trend = ((today_total - yesterday_total) / yesterday_total * 100) if yesterday_total > 0 else 0
    count_trend = ((today_count - yesterday_count) / yesterday_count * 100) if yesterday_count > 0 else 0
    
    # Ticket promedio
    avg_ticket = today_total / today_count if today_count > 0 else 0
    yesterday_avg = yesterday_total / yesterday_count if yesterday_count > 0 else 0
    avg_trend = ((avg_ticket - yesterday_avg) / yesterday_avg * 100) if yesterday_avg > 0 else 0
    
    # Total de productos vendidos
    total_items = sum(len(sale.items) for sale in today_sales)
    yesterday_items = sum(len(sale.items) for sale in yesterday_sales)
    items_trend = ((total_items - yesterday_items) / yesterday_items * 100) if yesterday_items > 0 else 0
    
    return HTMLResponse(content=f"""
        <div class="stat-card">
            <div class="stat-label">Total Vendido</div>
            <div class="stat-value">S/. {today_total:.2f}</div>
            <div class="stat-trend {'up' if total_trend > 0 else 'down'}">
                {'↑' if total_trend > 0 else '↓'} {abs(total_trend):.1f}% vs ayer
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-label">Ventas</div>
            <div class="stat-value">{today_count}</div>
            <div class="stat-trend {'up' if count_trend > 0 else 'down'}">
                {'↑' if count_trend > 0 else '↓'} {abs(count_trend):.1f}% vs ayer
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-label">Ticket Promedio</div>
            <div class="stat-value">S/. {avg_ticket:.2f}</div>
            <div class="stat-trend {'up' if avg_trend > 0 else 'down'}">
                {'↑' if avg_trend > 0 else '↓'} {abs(avg_trend):.1f}% vs ayer
            </div>
        </div>
        
        <div class="stat-card">
            <div class="stat-label">Productos Vendidos</div>
            <div class="stat-value">{total_items}</div>
            <div class="stat-trend {'up' if items_trend > 0 else 'down'}">
                {'↑' if items_trend > 0 else '↓'} {abs(items_trend):.1f}% vs ayer
            </div>
        </div>
    """)

@router.get("/top-products", response_class=HTMLResponse)
async def get_top_products_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Top 10 productos más vendidos del día en HTML
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = datetime.combine(date.today(), datetime.max.time())
    
    # Query: Top productos por cantidad vendida
    top_products = db.query(
        Product.id,
        Product.name,
        func.sum(SaleItem.quantity).label('total_quantity'),
        func.sum(SaleItem.subtotal).label('total_revenue')
    ).join(
        SaleItem, SaleItem.product_id == Product.id
    ).join(
        Sale, Sale.id == SaleItem.sale_id
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at <= today_end
    ).group_by(
        Product.id, Product.name
    ).order_by(
        desc('total_quantity')
    ).limit(10).all()
    
    if not top_products:
        return HTMLResponse(content="""
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-title">No hay ventas hoy</div>
            </div>
        """)
    
    # Generar HTML
    html_items = []
    for i, (product_id, name, quantity, revenue) in enumerate(top_products, 1):
        html_items.append(f"""
            <li class="top-product-item">
                <div class="product-rank">#{i}</div>
                <div class="product-info">
                    <div class="product-name">{name}</div>
                    <div class="product-quantity">{int(quantity)} unidades</div>
                </div>
                <div class="product-revenue">S/. {revenue:.2f}</div>
            </li>
        """)
    
    return HTMLResponse(content="".join(html_items))

@router.get("/hourly-sales")
async def get_hourly_sales(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ventas por hora del día (para gráfico)
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = datetime.combine(date.today(), datetime.max.time())
    
    # Query: Agrupar por hora
    hourly_data = db.query(
        func.extract('hour', Sale.created_at).label('hour'),
        func.sum(Sale.total).label('total')
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at <= today_end
    ).group_by('hour').order_by('hour').all()
    
    # Rellenar horas sin ventas
    hours_dict = {int(hour): float(total) for hour, total in hourly_data}
    current_hour = datetime.now().hour
    
    hours = []
    totals = []
    for hour in range(0, current_hour + 1):
        hours.append(f"{hour:02d}:00")
        totals.append(hours_dict.get(hour, 0))
    
    return {
        "hours": hours,
        "totals": totals
    }

@router.get("/payment-methods")
async def get_payment_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ventas por método de pago (para gráfico)
    """
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = datetime.combine(date.today(), datetime.max.time())
    
    # Query: Agrupar por método de pago
    payment_data = db.query(
        Sale.payment_method,
        func.sum(Sale.total).label('total')
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at <= today_end
    ).group_by(Sale.payment_method).all()
    
    methods = []
    totals = []
    
    for method, total in payment_data:
        method_name = {
            'efectivo': 'Efectivo',
            'yape': 'Yape',
            'plin': 'Plin'
        }.get(method, method)
        
        methods.append(method_name)
        totals.append(float(total))
    
    return {
        "methods": methods,
        "totals": totals
    }