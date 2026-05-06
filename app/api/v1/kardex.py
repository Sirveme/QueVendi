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

    # Costo promedio ponderado: arranca con el costo actual del producto.
    costo_prom = _to_float(product.cost_price)
    saldo_cant = saldo_inicial
    saldo_valor = saldo_cant * costo_prom

    total_entrada_cant = 0.0
    total_entrada_valor = 0.0
    total_salida_cant = 0.0
    total_salida_valor = 0.0

    out_movs = []
    for m in movs:
        qty = _to_float(m.quantity)

        base_row = {
            "id": m.id,
            "fecha": m.occurred_at.isoformat() if m.occurred_at else None,
            "tipo_movimiento": m.movement_type,
            "doc_tipo": m.doc_tipo,
            "doc_numero": m.doc_numero,
            "glosa": m.glosa or m.notes,
            "user_name": m.user_name,
            "referencia": (
                f"{m.reference_type} #{m.reference_id}"
                if m.reference_type and m.reference_id else
                (m.reference_type or "")
            ),
            "notes": m.notes,
        }

        if qty > 0:
            # ENTRADA — recalcular costo promedio ponderado
            entrada_costo_unit = (
                _to_float(m.cost_price) if m.cost_price is not None else costo_prom
            )
            entrada_total = qty * entrada_costo_unit
            saldo_valor += entrada_total
            saldo_cant = _to_float(m.stock_after)
            if saldo_cant > 0:
                costo_prom = saldo_valor / saldo_cant

            total_entrada_cant += qty
            total_entrada_valor += entrada_total

            base_row.update({
                "entrada_cant": round(qty, 3),
                "entrada_costo_unit": round(entrada_costo_unit, 4),
                "entrada_total": round(entrada_total, 2),
                "salida_cant": None,
                "salida_costo_unit": None,
                "salida_total": None,
                "saldo_cant": round(saldo_cant, 3),
                "saldo_costo_unit": round(costo_prom, 4),
                "saldo_total": round(saldo_cant * costo_prom, 2),
            })
        else:
            # SALIDA — usa el costo promedio vigente
            salida_qty = abs(qty)
            salida_total = salida_qty * costo_prom
            saldo_cant = _to_float(m.stock_after)
            saldo_valor = saldo_cant * costo_prom

            total_salida_cant += salida_qty
            total_salida_valor += salida_total

            base_row.update({
                "entrada_cant": None,
                "entrada_costo_unit": None,
                "entrada_total": None,
                "salida_cant": round(salida_qty, 3),
                "salida_costo_unit": round(costo_prom, 4),
                "salida_total": round(salida_total, 2),
                "saldo_cant": round(saldo_cant, 3),
                "saldo_costo_unit": round(costo_prom, 4),
                "saldo_total": round(saldo_cant * costo_prom, 2),
            })

        out_movs.append(base_row)

    saldo_final = saldo_cant if movs else saldo_inicial
    valor_inventario_final = round(saldo_final * costo_prom, 2)

    return {
        "producto": {
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "unit": product.unit,
            "cost_price": round(_to_float(product.cost_price), 2),
        },
        "metodo_valorizacion": "Promedio Ponderado",
        "fecha_inicio": fi.date().isoformat(),
        "fecha_fin": ff.date().isoformat(),
        "saldo_inicial": round(saldo_inicial, 3),
        "saldo_final": round(saldo_final, 3),
        "costo_prom_final": round(costo_prom, 4),
        "total_entradas": round(total_entrada_cant, 3),
        "total_salidas": round(total_salida_cant, 3),
        "total_entrada_valor": round(total_entrada_valor, 2),
        "total_salida_valor": round(total_salida_valor, 2),
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
        "Fecha", "Doc.Tipo", "Doc.Numero", "Producto", "Detalle", "Usuario",
        "Entrada.Cant", "Entrada.CUnit", "Entrada.Total",
        "Salida.Cant",  "Salida.CUnit",  "Salida.Total",
        "Saldo.Cant",   "Saldo.CUnit",   "Saldo.Total",
    ])

    # Estado por producto: (saldo_cant, saldo_valor, costo_prom)
    state: dict = {}
    for pid, p in products.items():
        # Saldo inicial = stock_before del primer movimiento del período;
        # si no hay movimiento previo en el período, queremos arrancar con
        # el saldo previo. Tomamos el último movimiento ANTES del período
        # como referencia de cantidad y, si no hay, asumimos 0 (consistente
        # con el detalle de un único producto: el primer movimiento del
        # período define el saldo inicial real).
        first_mov = (
            db.query(InventoryMovement)
            .filter(
                InventoryMovement.product_id == pid,
                InventoryMovement.store_id == store_id,
                InventoryMovement.occurred_at >= fi,
                InventoryMovement.occurred_at <= ff_inclusive,
            )
            .order_by(InventoryMovement.occurred_at.asc(), InventoryMovement.id.asc())
            .first()
        )
        if first_mov:
            saldo_cant_0 = _to_float(first_mov.stock_before)
        else:
            saldo_cant_0 = _to_float(p.stock)
        costo_prom_0 = _to_float(p.cost_price)
        state[pid] = {
            "saldo_cant": saldo_cant_0,
            "saldo_valor": saldo_cant_0 * costo_prom_0,
            "costo_prom": costo_prom_0,
        }

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
        st = state.setdefault(m.product_id, {
            "saldo_cant": 0.0, "saldo_valor": 0.0,
            "costo_prom": _to_float(p.cost_price),
        })

        qty = _to_float(m.quantity)
        if qty > 0:
            entrada_cunit = _to_float(m.cost_price) if m.cost_price is not None else st["costo_prom"]
            entrada_total = qty * entrada_cunit
            st["saldo_valor"] += entrada_total
            st["saldo_cant"] = _to_float(m.stock_after)
            if st["saldo_cant"] > 0:
                st["costo_prom"] = st["saldo_valor"] / st["saldo_cant"]
            ent_cant_s = f"{qty:.3f}"
            ent_cu_s = f"{entrada_cunit:.4f}"
            ent_tot_s = f"{entrada_total:.2f}"
            sal_cant_s = sal_cu_s = sal_tot_s = ""
        else:
            salida_qty = -qty
            salida_total = salida_qty * st["costo_prom"]
            st["saldo_cant"] = _to_float(m.stock_after)
            st["saldo_valor"] = st["saldo_cant"] * st["costo_prom"]
            sal_cant_s = f"{salida_qty:.3f}"
            sal_cu_s = f"{st['costo_prom']:.4f}"
            sal_tot_s = f"{salida_total:.2f}"
            ent_cant_s = ent_cu_s = ent_tot_s = ""

        w.writerow([
            m.occurred_at.strftime("%Y-%m-%d %H:%M") if m.occurred_at else "",
            m.doc_tipo or "",
            m.doc_numero or "",
            p.name,
            (m.glosa or m.notes or ""),
            m.user_name or "",
            ent_cant_s, ent_cu_s, ent_tot_s,
            sal_cant_s, sal_cu_s, sal_tot_s,
            f"{st['saldo_cant']:.3f}",
            f"{st['costo_prom']:.4f}",
            f"{st['saldo_cant'] * st['costo_prom']:.2f}",
        ])

    csv_bytes = buf.getvalue().encode("utf-8-sig")
    fname_id = f"_p{product_id}" if product_id else ""
    filename = f"kardex_store{store_id}{fname_id}_{fi.date()}_{ff.date()}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
