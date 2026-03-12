"""
app/routers/lite.py
QueVendi Lite — POS simplificado sin facturación SUNAT
Plan: S/10/mes | Sin stock | Sin RUC | Ticket de cortesía

Endpoints:
  GET  /lite                    → pantalla POS
  GET  /api/v1/lite/products    → catálogo del negocio
  POST /api/v1/lite/products    → agregar / editar producto
  DEL  /api/v1/lite/products/{id}
  POST /api/v1/lite/venta       → registrar venta + responder listo para imprimir
  GET  /api/v1/lite/ventas      → historial del día
  GET  /api/v1/lite/ventas/resumen → resumen para el cierre de caja
"""

from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal
from datetime import date, datetime
import logging

from app.core.database import get_db
from app.core.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["lite"])
templates = Jinja2Templates(directory="app/templates")


# ─────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────

class LiteProducto(BaseModel):
    id:       Optional[int]         = None
    nombre:   str                   = Field(..., max_length=120)
    precio:   Decimal               = Field(..., gt=0, decimal_places=2)
    unidad:   str                   = Field(default="NIU", max_length=10)
    icono:    Optional[str]         = Field(default="🛒", max_length=10)
    activo:   bool                  = True
    ventas:   int                   = 0       # contador para ordenar "más vendidos"


class LiteItemVenta(BaseModel):
    producto_id:     Optional[int]  = None
    descripcion:     str
    cantidad:        Decimal         = Field(..., gt=0)
    precio_unitario: Decimal         = Field(..., gt=0)
    unidad:          str             = "NIU"


class LiteVenta(BaseModel):
    items:          list[LiteItemVenta]
    total:          Decimal
    payment_method: str             = "efectivo"   # efectivo|yape|tarjeta|fiado
    cliente_nombre: Optional[str]   = None
    cliente_dni:    Optional[str]   = None
    numero:         Optional[int]   = None
    # Datos del emisor para el ticket de cortesía
    emisor:         Optional[dict]  = None


# ─────────────────────────────────────────────
# PANTALLA POS
# ─────────────────────────────────────────────

@router.get("/lite", response_class=HTMLResponse)
async def lite_pos(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Sirve la pantalla de venta Lite."""
    return templates.TemplateResponse(
        "lite/venta.html",
        {
            "request":  request,
            "user":     current_user,
            "plan":     "lite",
        }
    )


# ─────────────────────────────────────────────
# CATÁLOGO DE PRODUCTOS
# ─────────────────────────────────────────────

@router.get("/api/v1/lite/products")
async def get_lite_products(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Devuelve el catálogo del negocio ordenado por número de ventas DESC.
    Los primeros 30 son los "más vendidos" para la grilla rápida.
    """
    store_id = current_user.get("store_id")
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id no encontrado en token")

    try:
        rows = db.execute(
            text("""
                SELECT id, nombre, precio, unidad, icono, activo, ventas
                FROM lite_productos
                WHERE store_id = :store_id
                  AND activo   = true
                ORDER BY ventas DESC, nombre ASC
            """),
            {"store_id": store_id}
        ).fetchall()

        products = [
            {
                "id":     r.id,
                "nombre": r.nombre,
                "precio": float(r.precio),
                "unidad": r.unidad,
                "icono":  r.icono or "🛒",
                "ventas": r.ventas or 0,
            }
            for r in rows
        ]
        return {"products": products, "total": len(products)}

    except Exception as e:
        logger.error(f"[Lite] Error al cargar productos: {e}")
        raise HTTPException(status_code=500, detail="Error al cargar el catálogo")


@router.post("/api/v1/lite/products", status_code=status.HTTP_201_CREATED)
async def create_lite_product(
    data: LiteProducto,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Crea un producto nuevo en el catálogo."""
    store_id = current_user.get("store_id")
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id no encontrado en token")

    try:
        result = db.execute(
            text("""
                INSERT INTO lite_productos
                    (store_id, nombre, precio, unidad, icono, activo, ventas)
                VALUES
                    (:store_id, :nombre, :precio, :unidad, :icono, true, 0)
                RETURNING id
            """),
            {
                "store_id": store_id,
                "nombre":   data.nombre.strip(),
                "precio":   float(data.precio),
                "unidad":   data.unidad,
                "icono":    data.icono or "🛒",
            }
        )
        db.commit()
        new_id = result.fetchone().id
        return {"id": new_id, "ok": True}

    except Exception as e:
        db.rollback()
        logger.error(f"[Lite] Error al crear producto: {e}")
        raise HTTPException(status_code=500, detail="Error al guardar el producto")


@router.put("/api/v1/lite/products/{producto_id}")
async def update_lite_product(
    producto_id: int,
    data: LiteProducto,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Actualiza precio o nombre de un producto."""
    store_id = current_user.get("store_id")
    try:
        db.execute(
            text("""
                UPDATE lite_productos
                SET nombre = :nombre,
                    precio = :precio,
                    unidad = :unidad,
                    icono  = :icono
                WHERE id       = :id
                  AND store_id = :store_id
            """),
            {
                "id":       producto_id,
                "store_id": store_id,
                "nombre":   data.nombre.strip(),
                "precio":   float(data.precio),
                "unidad":   data.unidad,
                "icono":    data.icono or "🛒",
            }
        )
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/v1/lite/products/{producto_id}")
async def delete_lite_product(
    producto_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Desactiva un producto (soft delete)."""
    store_id = current_user.get("store_id")
    try:
        db.execute(
            text("""
                UPDATE lite_productos
                SET activo = false
                WHERE id = :id AND store_id = :store_id
            """),
            {"id": producto_id, "store_id": store_id}
        )
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# VENTAS
# ─────────────────────────────────────────────

@router.post("/api/v1/lite/venta")
async def registrar_venta_lite(
    data: LiteVenta,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Registra una venta Lite.
    - Guarda cabecera en lite_ventas
    - Guarda items en lite_venta_items
    - Incrementa contador de ventas en lite_productos
    - Devuelve el número correlativo de ticket
    """
    store_id = current_user.get("store_id")
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id no encontrado")

    if not data.items:
        raise HTTPException(status_code=400, detail="La venta no tiene items")

    try:
        # 1. Obtener siguiente correlativo del día
        hoy = date.today()
        row = db.execute(
            text("""
                SELECT COALESCE(MAX(numero_dia), 0) + 1 AS siguiente
                FROM lite_ventas
                WHERE store_id = :store_id
                  AND DATE(created_at) = :hoy
            """),
            {"store_id": store_id, "hoy": hoy}
        ).fetchone()
        numero = row.siguiente if row else 1

        # Correlativo global del negocio (para el ticket T-XXXXXXXX)
        row2 = db.execute(
            text("""
                SELECT COALESCE(MAX(numero_global), 0) + 1 AS siguiente
                FROM lite_ventas
                WHERE store_id = :store_id
            """),
            {"store_id": store_id}
        ).fetchone()
        numero_global = row2.siguiente if row2 else 1

        # 2. Insertar cabecera
        result = db.execute(
            text("""
                INSERT INTO lite_ventas
                    (store_id, numero_dia, numero_global, total,
                     payment_method, cliente_nombre, cliente_dni, created_at)
                VALUES
                    (:store_id, :numero_dia, :numero_global, :total,
                     :payment_method, :cliente_nombre, :cliente_dni, NOW())
                RETURNING id
            """),
            {
                "store_id":      store_id,
                "numero_dia":    numero,
                "numero_global": numero_global,
                "total":         float(data.total),
                "payment_method":data.payment_method,
                "cliente_nombre":data.cliente_nombre or "VARIOS",
                "cliente_dni":   data.cliente_dni or "-",
            }
        )
        venta_id = result.fetchone().id

        # 3. Insertar items
        for item in data.items:
            db.execute(
                text("""
                    INSERT INTO lite_venta_items
                        (venta_id, producto_id, descripcion,
                         cantidad, precio_unitario, subtotal, unidad)
                    VALUES
                        (:venta_id, :producto_id, :descripcion,
                         :cantidad, :precio_unitario,
                         :cantidad * :precio_unitario, :unidad)
                """),
                {
                    "venta_id":        venta_id,
                    "producto_id":     item.producto_id,
                    "descripcion":     item.descripcion,
                    "cantidad":        float(item.cantidad),
                    "precio_unitario": float(item.precio_unitario),
                    "unidad":          item.unidad,
                }
            )

        # 4. Incrementar ventas en lite_productos
        ids_vendidos = [
            item.producto_id
            for item in data.items
            if item.producto_id is not None
        ]
        if ids_vendidos:
            db.execute(
                text("""
                    UPDATE lite_productos
                    SET ventas = ventas + 1
                    WHERE id = ANY(:ids) AND store_id = :store_id
                """),
                {"ids": ids_vendidos, "store_id": store_id}
            )

        db.commit()

        numero_formato = f"T-{str(numero_global).zfill(8)}"
        logger.info(f"[Lite] Venta {numero_formato} registrada — store {store_id}")

        return {
            "ok":             True,
            "venta_id":       venta_id,
            "numero_global":  numero_global,
            "numero_dia":     numero,
            "numero_formato": numero_formato,
        }

    except Exception as e:
        db.rollback()
        logger.error(f"[Lite] Error al registrar venta: {e}")
        raise HTTPException(status_code=500, detail="Error al registrar la venta")


@router.get("/api/v1/lite/ventas")
async def get_ventas_lite(
    fecha: Optional[str] = None,      # YYYY-MM-DD, default hoy
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devuelve las ventas del día (o de la fecha indicada)."""
    store_id = current_user.get("store_id")
    try:
        dia = date.fromisoformat(fecha) if fecha else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (usa YYYY-MM-DD)")

    try:
        rows = db.execute(
            text("""
                SELECT
                    v.id, v.numero_dia, v.numero_global, v.total,
                    v.payment_method, v.cliente_nombre, v.created_at,
                    json_agg(json_build_object(
                        'descripcion',     i.descripcion,
                        'cantidad',        i.cantidad,
                        'precio_unitario', i.precio_unitario,
                        'subtotal',        i.subtotal
                    )) AS items
                FROM lite_ventas v
                JOIN lite_venta_items i ON i.venta_id = v.id
                WHERE v.store_id = :store_id
                  AND DATE(v.created_at) = :dia
                GROUP BY v.id
                ORDER BY v.created_at DESC
            """),
            {"store_id": store_id, "dia": dia}
        ).fetchall()

        ventas = [
            {
                "id":             r.id,
                "numero_dia":     r.numero_dia,
                "numero_global":  r.numero_global,
                "numero_formato": f"T-{str(r.numero_global).zfill(8)}",
                "total":          float(r.total),
                "payment_method": r.payment_method,
                "cliente_nombre": r.cliente_nombre,
                "created_at":     r.created_at.isoformat(),
                "items":          r.items or [],
            }
            for r in rows
        ]
        return {"ventas": ventas, "fecha": str(dia), "total_ventas": len(ventas)}

    except Exception as e:
        logger.error(f"[Lite] Error al cargar historial: {e}")
        raise HTTPException(status_code=500, detail="Error al cargar el historial")


@router.get("/api/v1/lite/ventas/resumen")
async def resumen_dia_lite(
    fecha: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resumen para el cierre de caja: total por método de pago."""
    store_id = current_user.get("store_id")
    try:
        dia = date.fromisoformat(fecha) if fecha else date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido")

    try:
        rows = db.execute(
            text("""
                SELECT
                    payment_method,
                    COUNT(*)        AS cantidad,
                    SUM(total)      AS monto
                FROM lite_ventas
                WHERE store_id = :store_id
                  AND DATE(created_at) = :dia
                GROUP BY payment_method
                ORDER BY monto DESC
            """),
            {"store_id": store_id, "dia": dia}
        ).fetchall()

        total_general = db.execute(
            text("""
                SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS monto
                FROM lite_ventas
                WHERE store_id = :store_id AND DATE(created_at) = :dia
            """),
            {"store_id": store_id, "dia": dia}
        ).fetchone()

        return {
            "fecha":          str(dia),
            "total_ventas":   total_general.n,
            "total_monto":    float(total_general.monto),
            "por_metodo":     [
                {
                    "metodo":   r.payment_method,
                    "cantidad": r.cantidad,
                    "monto":    float(r.monto),
                }
                for r in rows
            ]
        }

    except Exception as e:
        logger.error(f"[Lite] Error en resumen: {e}")
        raise HTTPException(status_code=500, detail="Error al generar el resumen")