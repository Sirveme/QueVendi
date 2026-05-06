"""
Kardex Valorizado.
Endpoints para listar productos con valor de inventario, ver movimientos
detallados por producto con saldo corriente, resumen por categoría y export CSV.
"""
import csv
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.product import Product
from app.models.inventory import InventoryMovement
from app.models.user import User
from app.services.auth_service import AuthService


router = APIRouter(prefix="/kardex", tags=["kardex"])

PERU_TZ = timezone(timedelta(hours=-5))


# ──────────────────────────────────────────────────────────────────────────
# Auth helper: igual que reports — acepta token vía ?token= para descargas
# ──────────────────────────────────────────────────────────────────────────
async def get_current_user_or_token(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    qtoken = request.query_params.get("token")
    if qtoken:
        try:
            user = AuthService(db).get_current_user(qtoken)
            if user:
                return user
        except Exception:
            pass
    return await get_current_user(request, db)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────
def _to_float(x) -> float:
    if x is None:
        return 0.0
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _parse_fecha(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Fecha inválida: {s} (use YYYY-MM-DD)")


def _ventana_default():
    """Último mes (30 días) en zona Perú si no se proveen fechas."""
    fin = datetime.now(PERU_TZ)
    inicio = fin - timedelta(days=30)
    return inicio.replace(tzinfo=None), fin.replace(tzinfo=None)


# ──────────────────────────────────────────────────────────────────────────
# GET /kardex/productos
# ──────────────────────────────────────────────────────────────────────────
@router.get("/productos")
async def lista_productos_kardex(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    categoria: Optional[str] = None,
    search: Optional[str] = None,
    con_movimientos: bool = False,
):
    """Lista productos del store con stock, valor y último movimiento."""
    store_id = current_user.store_id
    q = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True,  # noqa: E712
    )
    if categoria:
        q = q.filter(Product.category == categoria)
    if search:
        like = f"%{search}%"
        q = q.filter(Product.name.ilike(like))

    productos: List[Product] = q.order_by(Product.name.asc()).limit(500).all()

    # Último movimiento por producto (en una sola query)
    ids = [p.id for p in productos]
    ultimos: dict = {}
    if ids:
        rows = (
            db.query(
                InventoryMovement.product_id,
                func.max(InventoryMovement.occurred_at).label("ultimo"),
            )
            .filter(InventoryMovement.product_id.in_(ids))
            .group_by(InventoryMovement.product_id)
            .all()
        )
        ultimos = {r.product_id: r.ultimo for r in rows}

    if con_movimientos:
        productos = [p for p in productos if p.id in ultimos]

    out = []
    for p in productos:
        stock = _to_float(p.stock)
        cost = _to_float(p.cost_price)
        out.append({
            "id": p.id,
            "name": p.name,
            "category": p.category,
            "unit": p.unit,
            "stock": round(stock, 3),
            "cost_price": round(cost, 2),
            "valor_inventario": round(stock * cost, 2),
            "min_stock_alert": p.min_stock_alert,
            "ultimo_movimiento": ultimos[p.id].isoformat() if ultimos.get(p.id) else None,
        })
    return out


# ──────────────────────────────────────────────────────────────────────────
# GET /kardex/producto/{product_id}
# ──────────────────────────────────────────────────────────────────────────
@router.get("/producto/{product_id}")
async def kardex_producto(
    product_id: int,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kardex detallado de un producto en un período (saldo corrido)."""
    store_id = current_user.store_id

    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.store_id == store_id)
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    fi = _parse_fecha(fecha_inicio)
    ff = _parse_fecha(fecha_fin)
    if not fi and not ff:
        fi, ff = _ventana_default()
    elif not fi:
        fi = ff - timedelta(days=30)
    elif not ff:
        ff = fi + timedelta(days=30)

    # Final del día para fecha_fin inclusivo
    ff_inclusive = ff.replace(hour=23, minute=59, second=59)

    movs: List[InventoryMovement] = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id == product_id,
            InventoryMovement.store_id == store_id,
            InventoryMovement.occurred_at >= fi,
            InventoryMovement.occurred_at <= ff_inclusive,
        )
        .order_by(InventoryMovement.occurred_at.asc(), InventoryMovement.id.asc())
        .all()
    )

    # Saldo inicial = stock_before del primer movimiento del período.
    # Si no hay movimientos, usar el stock actual del producto.
    if movs:
        saldo_inicial = _to_float(movs[0].stock_before)
    else:
        saldo_inicial = _to_float(product.stock)

    saldo = saldo_inicial
    total_entradas = 0.0
    total_salidas = 0.0
    out_movs = []
    for m in movs:
        cantidad = _to_float(m.quantity)
        cost_unit = _to_float(m.cost_price) if m.cost_price is not None else _to_float(product.cost_price)
        if cantidad >= 0:
            entrada = round(cantidad, 3)
            salida = 0.0
            total_entradas += cantidad
        else:
            entrada = 0.0
            salida = round(-cantidad, 3)
            total_salidas += -cantidad

        # Usar el stock_after real grabado en el movimiento
        saldo = _to_float(m.stock_after)

        out_movs.append({
            "id": m.id,
            "fecha": m.occurred_at.isoformat() if m.occurred_at else None,
            "tipo_movimiento": m.movement_type,
            "referencia": (
                f"{m.reference_type} #{m.reference_id}"
                if m.reference_type and m.reference_id else
                (m.reference_type or "")
            ),
            "entrada": entrada or None,
            "salida": salida or None,
            "saldo": round(saldo, 3),
            "costo_unitario": round(cost_unit, 2),
            "valor_saldo": round(saldo * cost_unit, 2),
            "notes": m.notes,
        })

    saldo_final = saldo
    cost_actual = _to_float(product.cost_price)
    valor_inventario_final = round(saldo_final * cost_actual, 2)

    return {
        "producto": {
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "unit": product.unit,
            "cost_price": round(cost_actual, 2),
        },
        "fecha_inicio": fi.date().isoformat(),
        "fecha_fin": ff.date().isoformat(),
        "saldo_inicial": round(saldo_inicial, 3),
        "saldo_final": round(saldo_final, 3),
        "total_entradas": round(total_entradas, 3),
        "total_salidas": round(total_salidas, 3),
        "valor_inventario_final": valor_inventario_final,
        "movimientos": out_movs,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /kardex/resumen
# ──────────────────────────────────────────────────────────────────────────
@router.get("/resumen")
async def resumen_kardex(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resumen valorizado por categoría + total general."""
    store_id = current_user.store_id

    productos = (
        db.query(Product)
        .filter(Product.store_id == store_id, Product.is_active == True)  # noqa: E712
        .all()
    )

    por_categoria: dict = {}
    total_general = 0.0
    total_productos = 0
    total_stock_bajo = 0

    for p in productos:
        cat = p.category or "Sin categoría"
        stock = _to_float(p.stock)
        cost = _to_float(p.cost_price)
        valor = stock * cost
        bajo = bool(p.min_stock_alert is not None and stock <= _to_float(p.min_stock_alert))

        b = por_categoria.setdefault(
            cat,
            {"categoria": cat, "num_productos": 0, "valor_total": 0.0, "stock_bajo": 0},
        )
        b["num_productos"] += 1
        b["valor_total"] += valor
        if bajo:
            b["stock_bajo"] += 1
            total_stock_bajo += 1

        total_general += valor
        total_productos += 1

    categorias = sorted(
        (
            {**v, "valor_total": round(v["valor_total"], 2)}
            for v in por_categoria.values()
        ),
        key=lambda x: x["valor_total"],
        reverse=True,
    )

    return {
        "categorias": categorias,
        "total_general": round(total_general, 2),
        "total_productos": total_productos,
        "total_stock_bajo": total_stock_bajo,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /kardex/movimientos
# ──────────────────────────────────────────────────────────────────────────
@router.get("/movimientos")
async def movimientos_kardex(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    movement_type: Optional[str] = None,
    product_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Movimientos del store paginados (limit=50)."""
    store_id = current_user.store_id

    fi = _parse_fecha(fecha_inicio)
    ff = _parse_fecha(fecha_fin)
    if ff:
        ff = ff.replace(hour=23, minute=59, second=59)

    q = (
        db.query(InventoryMovement, Product.name)
        .join(Product, Product.id == InventoryMovement.product_id)
        .filter(InventoryMovement.store_id == store_id)
    )
    if fi:
        q = q.filter(InventoryMovement.occurred_at >= fi)
    if ff:
        q = q.filter(InventoryMovement.occurred_at <= ff)
    if movement_type:
        q = q.filter(InventoryMovement.movement_type == movement_type)
    if product_id:
        q = q.filter(InventoryMovement.product_id == product_id)

    total = q.count()
    rows = q.order_by(InventoryMovement.occurred_at.desc(), InventoryMovement.id.desc()).limit(limit).offset(offset).all()

    items = []
    for m, pname in rows:
        cantidad = _to_float(m.quantity)
        items.append({
            "id": m.id,
            "fecha": m.occurred_at.isoformat() if m.occurred_at else None,
            "tipo_movimiento": m.movement_type,
            "product_id": m.product_id,
            "product_name": pname,
            "quantity": round(cantidad, 3),
            "entrada": round(cantidad, 3) if cantidad > 0 else 0,
            "salida": round(-cantidad, 3) if cantidad < 0 else 0,
            "stock_before": _to_float(m.stock_before),
            "stock_after": _to_float(m.stock_after),
            "cost_price": _to_float(m.cost_price),
            "reference_type": m.reference_type,
            "reference_id": m.reference_id,
            "notes": m.notes,
        })

    return {
        "items": items,
        "limit": limit,
        "offset": offset,
        "total": total,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /kardex/export-csv
# ──────────────────────────────────────────────────────────────────────────
@router.get("/export-csv")
async def export_kardex_csv(
    product_id: Optional[int] = None,
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    token: Optional[str] = None,  # noqa: ARG001 — leído por get_current_user_or_token
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_token),
):
    """CSV con el kardex (un producto o todos)."""
    store_id = current_user.store_id

    fi = _parse_fecha(fecha_inicio)
    ff = _parse_fecha(fecha_fin)
    if not fi and not ff:
        fi, ff = _ventana_default()
    elif not fi:
        fi = ff - timedelta(days=30)
    elif not ff:
        ff = fi + timedelta(days=30)
    ff_inclusive = ff.replace(hour=23, minute=59, second=59)

    products_q = db.query(Product).filter(Product.store_id == store_id)
    if product_id:
        products_q = products_q.filter(Product.id == product_id)
    products = {p.id: p for p in products_q.all()}
    if product_id and not products:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Fecha", "Tipo", "Referencia", "Producto",
        "Entrada", "Salida", "Saldo", "Costo Unit.", "Valor Saldo",
    ])

    # Iterar por producto (uno o todos) calculando saldo corriente
    saldos: dict = {}
    if product_id:
        # Saldo inicial del único producto
        prev = (
            db.query(InventoryMovement)
            .filter(
                InventoryMovement.product_id == product_id,
                InventoryMovement.store_id == store_id,
                InventoryMovement.occurred_at < fi,
            )
            .order_by(InventoryMovement.occurred_at.desc(), InventoryMovement.id.desc())
            .first()
        )
        saldos[product_id] = _to_float(prev.stock_after) if prev else 0.0
    else:
        for pid in products.keys():
            prev = (
                db.query(InventoryMovement)
                .filter(
                    InventoryMovement.product_id == pid,
                    InventoryMovement.store_id == store_id,
                    InventoryMovement.occurred_at < fi,
                )
                .order_by(InventoryMovement.occurred_at.desc(), InventoryMovement.id.desc())
                .first()
            )
            saldos[pid] = _to_float(prev.stock_after) if prev else 0.0

    movs_q = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.store_id == store_id,
            InventoryMovement.occurred_at >= fi,
            InventoryMovement.occurred_at <= ff_inclusive,
        )
    )
    if product_id:
        movs_q = movs_q.filter(InventoryMovement.product_id == product_id)

    movs = movs_q.order_by(InventoryMovement.occurred_at.asc(), InventoryMovement.id.asc()).all()

    for m in movs:
        p = products.get(m.product_id)
        if not p:
            continue
        cantidad = _to_float(m.quantity)
        cost_unit = _to_float(m.cost_price) if m.cost_price is not None else _to_float(p.cost_price)
        saldos[m.product_id] = saldos.get(m.product_id, 0.0) + cantidad
        saldo = saldos[m.product_id]
        ref = (
            f"{m.reference_type} #{m.reference_id}"
            if m.reference_type and m.reference_id else (m.reference_type or "")
        )
        w.writerow([
            m.occurred_at.strftime("%Y-%m-%d %H:%M") if m.occurred_at else "",
            m.movement_type,
            ref,
            p.name,
            f"{cantidad:.3f}" if cantidad > 0 else "",
            f"{-cantidad:.3f}" if cantidad < 0 else "",
            f"{saldo:.3f}",
            f"{cost_unit:.2f}",
            f"{saldo * cost_unit:.2f}",
        ])

    csv_bytes = buf.getvalue().encode("utf-8-sig")
    fname_id = f"_p{product_id}" if product_id else ""
    filename = f"kardex_store{store_id}{fname_id}_{fi.date()}_{ff.date()}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
