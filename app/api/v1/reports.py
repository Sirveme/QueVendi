"""
Endpoints de reportes para QueVendí PRO
"""
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, cast, Date
from datetime import datetime, date, timedelta, timezone, time
from app.core.database import get_db
from app.models.sale import Sale, SaleItem
from app.models.product import Product
from app.api.dependencies import get_current_user
from app.models.user import User
from app.services.auth_service import AuthService

PERU_TZ = timezone(timedelta(hours=-5))


def hoy_peru():
    return datetime.now(PERU_TZ).date()


def _peru_window(d: date):
    """Retorna (inicio, fin_exclusivo) en zona Perú para el día d."""
    inicio = datetime.combine(d, time.min, tzinfo=PERU_TZ)
    fin = datetime.combine(d + timedelta(days=1), time.min, tzinfo=PERU_TZ)
    return inicio, fin


async def get_user_export(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """Auth para exportación: acepta token vía query (?token=) además de header/cookie."""
    qtoken = request.query_params.get("token")
    if qtoken:
        try:
            user = AuthService(db).get_current_user(qtoken)
            if user:
                return user
        except Exception as e:
            print(f"[Auth export] token query inválido: {e}")
    return await get_current_user(request, db)


router = APIRouter(prefix="/reports")


# ──────────────────────────────────────────────────────────────────────────
# /stats/today → JSON
# ──────────────────────────────────────────────────────────────────────────
@router.get("/stats/today")
async def get_today_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Métricas del día (JSON) para tarjetas del dashboard de reportes."""
    today_peru = hoy_peru()
    today_start, today_end = _peru_window(today_peru)
    yesterday_start, yesterday_end = _peru_window(today_peru - timedelta(days=1))

    today_sales = db.query(Sale).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at < today_end,
    ).all()

    yesterday_sales = db.query(Sale).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= yesterday_start,
        Sale.created_at < yesterday_end,
    ).all()

    today_total = float(sum((s.total or 0) for s in today_sales))
    today_count = len(today_sales)
    yesterday_total = float(sum((s.total or 0) for s in yesterday_sales))

    average = (today_total / today_count) if today_count > 0 else 0.0
    delta_ventas = ((today_total - yesterday_total) / yesterday_total * 100) if yesterday_total > 0 else 0.0

    # Ganancia estimada del día: SUM((unit_price - cost_price) * quantity)
    ganancia_row = db.query(
        func.coalesce(
            func.sum(
                (SaleItem.unit_price - func.coalesce(Product.cost_price, 0)) * SaleItem.quantity
            ),
            0,
        )
    ).join(Sale, Sale.id == SaleItem.sale_id) \
     .join(Product, Product.id == SaleItem.product_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at < today_end,
     ).scalar()

    ganancia_estimada = float(ganancia_row or 0)

    return {
        "total": today_total,
        "count": today_count,
        "average": average,
        "ganancia_estimada": ganancia_estimada,
        "delta_ventas": float(delta_ventas),
    }


# ──────────────────────────────────────────────────────────────────────────
# /top-products → HTML (sin cambios funcionales)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/top-products", response_class=HTMLResponse)
async def get_top_products_html(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Top 10 productos más vendidos del día en HTML."""
    today_peru = hoy_peru()
    today_start, today_end = _peru_window(today_peru)

    top_products = db.query(
        Product.id,
        Product.name,
        func.sum(SaleItem.quantity).label('total_quantity'),
        func.sum(SaleItem.subtotal).label('total_revenue')
    ).join(SaleItem, SaleItem.product_id == Product.id) \
     .join(Sale, Sale.id == SaleItem.sale_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at < today_end,
     ).group_by(Product.id, Product.name) \
     .order_by(desc('total_quantity')) \
     .limit(10).all()

    if not top_products:
        return HTMLResponse(content="""
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-title">No hay ventas hoy</div>
            </div>
        """)

    html_items = []
    for i, (product_id, name, quantity, revenue) in enumerate(top_products, 1):
        html_items.append(f"""
            <li class="top-product-item" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #334155;list-style:none">
                <div style="font-weight:800;color:#f59e0b;min-width:30px">#{i}</div>
                <div style="flex:1">
                    <div style="font-weight:600;color:#f1f5f9;font-size:13px">{name}</div>
                    <div style="font-size:11px;color:#94a3b8">{int(quantity)} unidades</div>
                </div>
                <div style="font-weight:700;color:#22c55e">S/ {float(revenue):.2f}</div>
            </li>
        """)

    return HTMLResponse(content=f'<ul style="padding:0;margin:0">{"".join(html_items)}</ul>')


# ──────────────────────────────────────────────────────────────────────────
# /hourly-sales → array [{hour, total}]
# ──────────────────────────────────────────────────────────────────────────
@router.get("/hourly-sales")
async def get_hourly_sales(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ventas por hora del día (Perú) para gráfico Chart.js."""
    today_peru = hoy_peru()
    today_start, today_end = _peru_window(today_peru)

    hour_peru = func.extract('hour', Sale.created_at - timedelta(hours=5))

    hourly_data = db.query(
        hour_peru.label('hour'),
        func.sum(Sale.total).label('total')
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at < today_end,
    ).group_by(hour_peru).order_by(hour_peru).all()

    hours_dict = {int(h): float(t or 0) for h, t in hourly_data}
    current_hour = datetime.now(PERU_TZ).hour

    return [
        {"hour": h, "total": hours_dict.get(h, 0.0)}
        for h in range(0, current_hour + 1)
    ]


# ──────────────────────────────────────────────────────────────────────────
# /payment-methods → array [{method, total}]
# ──────────────────────────────────────────────────────────────────────────
@router.get("/payment-methods")
async def get_payment_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ventas por método de pago para gráfico donut."""
    today_peru = hoy_peru()
    today_start, today_end = _peru_window(today_peru)

    payment_data = db.query(
        Sale.payment_method,
        func.sum(Sale.total).label('total')
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= today_start,
        Sale.created_at < today_end,
    ).group_by(Sale.payment_method).all()

    name_map = {'efectivo': 'Efectivo', 'yape': 'Yape', 'plin': 'Plin', 'tarjeta': 'Tarjeta'}
    return [
        {"method": name_map.get(method, method or 'Otro'), "total": float(total or 0)}
        for method, total in payment_data
    ]


# ──────────────────────────────────────────────────────────────────────────
# /sales-by-category (nuevo)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/sales-by-category")
async def get_sales_by_category(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ventas del día agrupadas por categoría con margen estimado."""
    today_peru = hoy_peru()
    inicio, fin = _peru_window(today_peru)

    rows = db.query(
        Product.category,
        func.coalesce(func.sum(SaleItem.subtotal), 0).label('total_ventas'),
        func.coalesce(func.sum(SaleItem.quantity), 0).label('num_items'),
        func.coalesce(
            func.sum(
                (SaleItem.unit_price - func.coalesce(Product.cost_price, 0)) * SaleItem.quantity
            ),
            0,
        ).label('margen_est'),
    ).join(SaleItem, SaleItem.product_id == Product.id) \
     .join(Sale, Sale.id == SaleItem.sale_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
     ).group_by(Product.category) \
     .order_by(desc('total_ventas')).all()

    return [
        {
            "category": cat or "Sin categoría",
            "total_ventas": float(total or 0),
            "num_items": float(items or 0),
            "margen_est": float(margen or 0),
        }
        for cat, total, items, margen in rows
    ]


# ──────────────────────────────────────────────────────────────────────────
# /cierre-caja (nuevo)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/cierre-caja")
async def get_cierre_caja(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Resumen completo de cierre de caja del día."""
    today_peru = hoy_peru()
    inicio, fin = _peru_window(today_peru)

    sales = db.query(Sale).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
    ).all()

    total = float(sum((s.total or 0) for s in sales))
    num_ventas = len(sales)
    ticket_promedio = (total / num_ventas) if num_ventas > 0 else 0.0

    # Desglose por método de pago
    metodo_rows = db.query(
        Sale.payment_method,
        func.count(Sale.id).label('count'),
        func.coalesce(func.sum(Sale.total), 0).label('total'),
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
    ).group_by(Sale.payment_method).all()

    name_map = {'efectivo': 'Efectivo', 'yape': 'Yape', 'plin': 'Plin', 'tarjeta': 'Tarjeta'}
    por_metodo = [
        {
            "method": name_map.get(method, method or 'Otro'),
            "count": int(count or 0),
            "total": float(mtotal or 0),
        }
        for method, count, mtotal in metodo_rows
    ]

    # Hora pico
    hour_peru = func.extract('hour', Sale.created_at - timedelta(hours=5))
    hora_row = db.query(
        hour_peru.label('hour'),
        func.sum(Sale.total).label('total'),
    ).filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
    ).group_by(hour_peru).order_by(desc('total')).first()
    hora_pico = int(hora_row[0]) if hora_row and hora_row[0] is not None else None

    # Producto más vendido
    top_row = db.query(
        Product.name,
        func.sum(SaleItem.quantity).label('qty'),
    ).join(SaleItem, SaleItem.product_id == Product.id) \
     .join(Sale, Sale.id == SaleItem.sale_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
     ).group_by(Product.id, Product.name) \
     .order_by(desc('qty')).first()
    producto_top = top_row[0] if top_row else None

    # Ganancia estimada
    ganancia = db.query(
        func.coalesce(
            func.sum(
                (SaleItem.unit_price - func.coalesce(Product.cost_price, 0)) * SaleItem.quantity
            ),
            0,
        )
    ).join(Sale, Sale.id == SaleItem.sale_id) \
     .join(Product, Product.id == SaleItem.product_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
     ).scalar()

    return {
        "total": total,
        "num_ventas": num_ventas,
        "ticket_promedio": ticket_promedio,
        "hora_pico": hora_pico,
        "producto_top": producto_top,
        "ganancia_estimada": float(ganancia or 0),
        "por_metodo": por_metodo,
    }


# ──────────────────────────────────────────────────────────────────────────
# /low-stock (nuevo)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/low-stock")
async def get_low_stock(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Productos con stock bajo o agotado."""
    productos = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True,
        Product.stock <= Product.min_stock_alert,
    ).order_by(Product.stock.asc()).all()

    return [
        {
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "stock": float(p.stock or 0),
            "min_stock_alert": int(p.min_stock_alert or 0),
            "sale_price": float(p.sale_price or 0),
        }
        for p in productos
    ]


# ──────────────────────────────────────────────────────────────────────────
# /export-csv (nuevo)
# ──────────────────────────────────────────────────────────────────────────
@router.get("/export-csv")
async def export_sales_csv(
    fecha: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_user_export),
):
    """Exporta ventas del día como CSV. Acepta token vía ?token= para descarga directa."""
    if fecha:
        try:
            target = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (use YYYY-MM-DD)")
    else:
        target = hoy_peru()

    inicio, fin = _peru_window(target)

    rows = db.query(
        Sale.created_at,
        Sale.payment_method,
        Product.name,
        Product.category,
        SaleItem.quantity,
        SaleItem.unit_price,
        SaleItem.subtotal,
    ).join(SaleItem, SaleItem.sale_id == Sale.id) \
     .join(Product, Product.id == SaleItem.product_id) \
     .filter(
        Sale.store_id == current_user.store_id,
        Sale.created_at >= inicio,
        Sale.created_at < fin,
     ).order_by(Sale.created_at.asc()).all()

    buffer = io.StringIO()
    buffer.write('﻿')  # BOM para Excel
    writer = csv.writer(buffer, delimiter=';')
    writer.writerow([
        "fecha", "hora", "producto", "categoria",
        "cantidad", "precio_unit", "subtotal", "metodo_pago",
    ])

    name_map = {'efectivo': 'Efectivo', 'yape': 'Yape', 'plin': 'Plin', 'tarjeta': 'Tarjeta'}
    for created, method, prod, cat, qty, price, sub in rows:
        # Convertir UTC → Perú para presentación
        if created and created.tzinfo is None:
            created_peru = created.replace(tzinfo=timezone.utc).astimezone(PERU_TZ)
        elif created:
            created_peru = created.astimezone(PERU_TZ)
        else:
            created_peru = None

        fecha_str = created_peru.strftime("%Y-%m-%d") if created_peru else ""
        hora_str = created_peru.strftime("%H:%M:%S") if created_peru else ""
        writer.writerow([
            fecha_str,
            hora_str,
            prod or "",
            cat or "",
            f"{float(qty or 0):.3f}",
            f"{float(price or 0):.2f}",
            f"{float(sub or 0):.2f}",
            name_map.get(method, method or ""),
        ])

    buffer.seek(0)
    filename = f"ventas-{target.isoformat()}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
