"""
QueVendi — Módulo de Caja
=========================
Gestión completa de sesiones de caja:
- Apertura con fondo inicial
- Registro de egresos durante el turno
- Cierre con arqueo y diferencias
- Vista en tiempo real para el dueño
- Soporte multi-caja simultánea

Rutas:
  POST /api/v1/caja/abrir           → Abrir nueva sesión
  GET  /api/v1/caja/activa          → Sesión activa del usuario
  GET  /api/v1/caja/todas           → Todas las cajas abiertas (dueño)
  GET  /api/v1/caja/{sesion_id}     → Detalle de sesión
  POST /api/v1/caja/{sesion_id}/egreso   → Registrar egreso
  POST /api/v1/caja/{sesion_id}/cerrar   → Cerrar y arquear
  GET  /api/v1/caja/{sesion_id}/resumen  → Resumen del turno
  GET  /api/v1/caja/historial            → Sesiones cerradas

Agregar en main.py:
  from app.routers.caja import router as caja_router
  app.include_router(caja_router, prefix="/api/v1", tags=["caja"])
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta
from typing import Optional, List
from pydantic import BaseModel
import logging

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/caja", tags=["caja"])

# ════════════════════════════════════════════════
# MIGRACIÓN — ejecutar una vez
# ════════════════════════════════════════════════
MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS caja_sesiones (
    id                      SERIAL PRIMARY KEY,
    store_id                INTEGER NOT NULL REFERENCES stores(id),
    caja_numero             INTEGER NOT NULL DEFAULT 1,
    tipo                    VARCHAR(20) DEFAULT 'venta',  -- venta | pedidos | delivery
    user_id_apertura        INTEGER NOT NULL REFERENCES users(id),
    user_nombre_apertura    VARCHAR(200),
    user_id_cierre          INTEGER REFERENCES users(id),
    user_nombre_cierre      VARCHAR(200),
    fecha_apertura          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_cierre            TIMESTAMP WITH TIME ZONE,

    -- Fondo inicial
    efectivo_inicial        DECIMAL(10,2) DEFAULT 0,

    -- Declarado en arqueo
    efectivo_declarado      DECIMAL(10,2),
    yape_declarado          DECIMAL(10,2),
    plin_declarado          DECIMAL(10,2),
    tarjeta_declarado       DECIMAL(10,2),

    -- Calculado por el sistema (se actualiza en tiempo real)
    total_ventas            DECIMAL(10,2) DEFAULT 0,
    total_efectivo_ventas   DECIMAL(10,2) DEFAULT 0,
    total_yape              DECIMAL(10,2) DEFAULT 0,
    total_plin              DECIMAL(10,2) DEFAULT 0,
    total_tarjeta           DECIMAL(10,2) DEFAULT 0,
    total_egresos           DECIMAL(10,2) DEFAULT 0,
    cantidad_ventas         INTEGER DEFAULT 0,

    -- Resultado del arqueo
    diferencia_efectivo     DECIMAL(10,2),
    estado                  VARCHAR(20) DEFAULT 'abierta',  -- abierta | cerrada | observada
    requiere_aprobacion_egresos BOOLEAN DEFAULT FALSE,
    notas_apertura          TEXT,
    notas_cierre            TEXT,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS caja_egresos (
    id          SERIAL PRIMARY KEY,
    sesion_id   INTEGER NOT NULL REFERENCES caja_sesiones(id),
    store_id    INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    user_nombre VARCHAR(200),
    monto       DECIMAL(10,2) NOT NULL,
    motivo      VARCHAR(300) NOT NULL,
    tipo        VARCHAR(30) DEFAULT 'gasto',  -- gasto | retiro | devolucion | cambio
    aprobado_por INTEGER REFERENCES users(id),
    fecha       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_store ON caja_sesiones(store_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_estado ON caja_sesiones(estado);
CREATE INDEX IF NOT EXISTS idx_caja_egresos_sesion ON caja_egresos(sesion_id);
"""

def _ensure_tables(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[Caja] Migración: {e}")

# ════════════════════════════════════════════════
# SCHEMAS
# ════════════════════════════════════════════════
class AbrirCajaRequest(BaseModel):
    efectivo_inicial: float = 0
    caja_numero: int = 1
    tipo: str = "venta"  # venta | pedidos | delivery
    notas: Optional[str] = None

class EgresoRequest(BaseModel):
    monto: float
    motivo: str
    tipo: str = "gasto"  # gasto | retiro | devolucion | cambio

class CerrarCajaRequest(BaseModel):
    efectivo_declarado: float = 0
    yape_declarado: float = 0
    plin_declarado: float = 0
    tarjeta_declarado: float = 0
    notas: Optional[str] = None

# ════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════
def _calcular_totales_sesion(db: Session, sesion_id: int, store_id: int, fecha_apertura):
    """Recalcula totales de ventas desde la BD de sales."""
    try:
        result = db.execute(text("""
            SELECT
                COUNT(*)                                        AS cantidad,
                COALESCE(SUM(total), 0)                         AS total_ventas,
                COALESCE(SUM(CASE WHEN payment_method = 'efectivo' THEN total ELSE 0 END), 0) AS efectivo,
                COALESCE(SUM(CASE WHEN payment_method = 'yape'     THEN total ELSE 0 END), 0) AS yape,
                COALESCE(SUM(CASE WHEN payment_method = 'plin'     THEN total ELSE 0 END), 0) AS plin,
                COALESCE(SUM(CASE WHEN payment_method IN ('tarjeta','visa','mastercard') THEN total ELSE 0 END), 0) AS tarjeta
            FROM sales
            WHERE store_id = :sid
              AND sale_date >= :desde
              AND is_active = TRUE
        """), {"sid": store_id, "desde": fecha_apertura}).fetchone()

        return {
            "cantidad_ventas":      int(result.cantidad or 0),
            "total_ventas":         float(result.total_ventas or 0),
            "total_efectivo_ventas":float(result.efectivo or 0),
            "total_yape":           float(result.yape or 0),
            "total_plin":           float(result.plin or 0),
            "total_tarjeta":        float(result.tarjeta or 0),
        }
    except Exception as e:
        logger.error(f"[Caja] Error calculando totales: {e}")
        return {
            "cantidad_ventas": 0, "total_ventas": 0,
            "total_efectivo_ventas": 0, "total_yape": 0,
            "total_plin": 0, "total_tarjeta": 0,
        }

def _serializar_sesion(row, egresos=None) -> dict:
    d = dict(row._mapping)
    # Convertir decimales a float
    for k in ["efectivo_inicial","total_ventas","total_efectivo_ventas",
              "total_yape","total_plin","total_tarjeta","total_egresos",
              "efectivo_declarado","yape_declarado","plin_declarado",
              "tarjeta_declarado","diferencia_efectivo"]:
        if d.get(k) is not None:
            d[k] = float(d[k])

    # Calcular efectivo esperado en caja
    d["efectivo_esperado"] = (
        (d.get("efectivo_inicial") or 0) +
        (d.get("total_efectivo_ventas") or 0) -
        (d.get("total_egresos") or 0)
    )

    # Fechas a ISO
    for k in ["fecha_apertura","fecha_cierre","created_at","updated_at"]:
        if d.get(k):
            d[k] = d[k].isoformat()

    if egresos is not None:
        d["egresos"] = egresos

    return d

# ════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════

@router.post("/abrir")
async def abrir_caja(
    req: AbrirCajaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Abrir una nueva sesión de caja."""
    _ensure_tables(db)

    store_id = current_user.store_id
    if not store_id:
        raise HTTPException(400, "Usuario no asociado a una tienda")

    # Verificar si ya tiene una caja abierta en este número
    existing = db.execute(text("""
        SELECT id FROM caja_sesiones
        WHERE store_id = :sid
          AND caja_numero = :num
          AND estado = 'abierta'
        LIMIT 1
    """), {"sid": store_id, "num": req.caja_numero}).fetchone()

    if existing:
        raise HTTPException(400, f"La Caja {req.caja_numero} ya está abierta (ID {existing.id})")

    result = db.execute(text("""
        INSERT INTO caja_sesiones
            (store_id, caja_numero, tipo, user_id_apertura, user_nombre_apertura,
             efectivo_inicial, estado, notas_apertura)
        VALUES
            (:sid, :num, :tipo, :uid, :unombre, :efectivo, 'abierta', :notas)
        RETURNING id, fecha_apertura
    """), {
        "sid":      store_id,
        "num":      req.caja_numero,
        "tipo":     req.tipo,
        "uid":      current_user.id,
        "unombre":  current_user.full_name,
        "efectivo": req.efectivo_inicial,
        "notas":    req.notas,
    }).fetchone()

    db.commit()
    logger.info(f"[Caja] Abierta #{req.caja_numero} store {store_id} por {current_user.full_name}")

    return {
        "success": True,
        "sesion_id": result.id,
        "caja_numero": req.caja_numero,
        "fecha_apertura": result.fecha_apertura.isoformat(),
        "message": f"Caja {req.caja_numero} abierta correctamente"
    }


@router.get("/activa")
async def caja_activa(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener la sesión de caja activa del usuario actual."""
    _ensure_tables(db)
    store_id = current_user.store_id

    row = db.execute(text("""
    SELECT * FROM caja_sesiones
    WHERE store_id = :sid AND estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1
"""), {"sid": store_id}).fetchone()

    if not row:
        return {"activa": False, "sesion": None}

    # Recalcular totales en tiempo real
    totales = _calcular_totales_sesion(db, row.id, store_id, row.fecha_apertura)
    db.execute(text("""
        UPDATE caja_sesiones SET
            total_ventas            = :tv,
            total_efectivo_ventas   = :tef,
            total_yape              = :ty,
            total_plin              = :tp,
            total_tarjeta           = :tt,
            cantidad_ventas         = :cv,
            updated_at              = NOW()
        WHERE id = :id
    """), {**totales, "id": row.id})
    db.commit()

    # Egresos de esta sesión
    egresos = db.execute(text("""
        SELECT * FROM caja_egresos WHERE sesion_id = :id ORDER BY fecha DESC
    """), {"id": row.id}).fetchall()
    egresos_list = [dict(e._mapping) for e in egresos]
    for e in egresos_list:
        e["monto"] = float(e["monto"])
        if e.get("fecha"): e["fecha"] = e["fecha"].isoformat()

    # Recalcular total egresos
    total_egresos = sum(e["monto"] for e in egresos_list)
    db.execute(text("UPDATE caja_sesiones SET total_egresos = :te WHERE id = :id"),
               {"te": total_egresos, "id": row.id})
    db.commit()

    # Re-fetch para datos actualizados
    row = db.execute(text("SELECT * FROM caja_sesiones WHERE id = :id"), {"id": row.id}).fetchone()
    return {"activa": True, "sesion": _serializar_sesion(row, egresos_list)}


@router.get("/todas")
async def todas_las_cajas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Ver todas las cajas abiertas — para dueño/admin."""
    _ensure_tables(db)
    if current_user.role not in ("owner", "admin", "demo_seller"):
        raise HTTPException(403, "Solo el dueño puede ver todas las cajas")

    store_id = current_user.store_id
    rows = db.execute(text("""
        SELECT * FROM caja_sesiones
        WHERE store_id = :sid AND estado = 'abierta'
        ORDER BY caja_numero
    """), {"sid": store_id}).fetchall()

    cajas = []
    for row in rows:
        totales = _calcular_totales_sesion(db, row.id, store_id, row.fecha_apertura)
        db.execute(text("""
            UPDATE caja_sesiones SET
                total_ventas = :tv, total_efectivo_ventas = :tef,
                total_yape = :ty, total_plin = :tp,
                total_tarjeta = :tt, cantidad_ventas = :cv,
                updated_at = NOW()
            WHERE id = :id
        """), {**totales, "id": row.id})

        # Total egresos
        te = db.execute(text(
            "SELECT COALESCE(SUM(monto),0) FROM caja_egresos WHERE sesion_id = :id"
        ), {"id": row.id}).scalar()
        db.execute(text("UPDATE caja_sesiones SET total_egresos = :te WHERE id = :id"),
                   {"te": float(te), "id": row.id})

        row2 = db.execute(text("SELECT * FROM caja_sesiones WHERE id = :id"), {"id": row.id}).fetchone()
        cajas.append(_serializar_sesion(row2))

    db.commit()
    return {"cajas": cajas, "total_abiertas": len(cajas)}


@router.get("/historial")
async def historial_cajas(
    limite: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Historial de sesiones cerradas."""
    _ensure_tables(db)
    store_id = current_user.store_id

    rows = db.execute(text("""
        SELECT * FROM caja_sesiones
        WHERE store_id = :sid AND estado IN ('cerrada','observada')
        ORDER BY fecha_cierre DESC
        LIMIT :lim
    """), {"sid": store_id, "lim": limite}).fetchall()

    return {"historial": [_serializar_sesion(r) for r in rows]}


@router.get("/{sesion_id}/resumen")
async def resumen_sesion(
    sesion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Resumen detallado de una sesión."""
    _ensure_tables(db)
    store_id = current_user.store_id

    row = db.execute(text(
        "SELECT * FROM caja_sesiones WHERE id = :id AND store_id = :sid"
    ), {"id": sesion_id, "sid": store_id}).fetchone()

    if not row:
        raise HTTPException(404, "Sesión no encontrada")

    # Recalcular si está abierta
    if row.estado == "abierta":
        totales = _calcular_totales_sesion(db, sesion_id, store_id, row.fecha_apertura)
        db.execute(text("""
            UPDATE caja_sesiones SET
                total_ventas = :tv, total_efectivo_ventas = :tef,
                total_yape = :ty, total_plin = :tp,
                total_tarjeta = :tt, cantidad_ventas = :cv,
                updated_at = NOW()
            WHERE id = :id
        """), {**totales, "id": sesion_id})
        db.commit()
        row = db.execute(text("SELECT * FROM caja_sesiones WHERE id = :id"), {"id": sesion_id}).fetchone()

    egresos = db.execute(text(
        "SELECT * FROM caja_egresos WHERE sesion_id = :id ORDER BY fecha DESC"
    ), {"id": sesion_id}).fetchall()
    egresos_list = [dict(e._mapping) for e in egresos]
    for e in egresos_list:
        e["monto"] = float(e["monto"])
        if e.get("fecha"): e["fecha"] = e["fecha"].isoformat()

    # Top productos del turno
    top_productos = []
    try:
        prods = db.execute(text("""
            SELECT si.product_name, SUM(si.quantity) as qty, SUM(si.subtotal) as total
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            WHERE s.store_id = :sid AND s.sale_date >= :desde AND s.is_active = TRUE
            GROUP BY si.product_name
            ORDER BY total DESC LIMIT 5
        """), {"sid": store_id, "desde": row.fecha_apertura}).fetchall()
        top_productos = [{"nombre": p.product_name, "cantidad": float(p.qty), "total": float(p.total)} for p in prods]
    except Exception as e:
        logger.warning(f"[Caja] Top productos: {e}")

    return {
        "sesion": _serializar_sesion(row, egresos_list),
        "top_productos": top_productos,
    }


@router.post("/{sesion_id}/egreso")
async def registrar_egreso(
    sesion_id: int,
    req: EgresoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Registrar un egreso (gasto, retiro, devolución)."""
    _ensure_tables(db)
    store_id = current_user.store_id

    sesion = db.execute(text(
        "SELECT * FROM caja_sesiones WHERE id = :id AND store_id = :sid AND estado = 'abierta'"
    ), {"id": sesion_id, "sid": store_id}).fetchone()

    if not sesion:
        raise HTTPException(404, "Sesión no encontrada o ya cerrada")

    if req.monto <= 0:
        raise HTTPException(400, "El monto debe ser mayor a 0")

    db.execute(text("""
        INSERT INTO caja_egresos (sesion_id, store_id, user_id, user_nombre, monto, motivo, tipo)
        VALUES (:sid, :store, :uid, :unombre, :monto, :motivo, :tipo)
    """), {
        "sid":     sesion_id,
        "store":   store_id,
        "uid":     current_user.id,
        "unombre": current_user.full_name,
        "monto":   req.monto,
        "motivo":  req.motivo,
        "tipo":    req.tipo,
    })

    # Actualizar total egresos
    db.execute(text("""
        UPDATE caja_sesiones
        SET total_egresos = total_egresos + :monto, updated_at = NOW()
        WHERE id = :id
    """), {"monto": req.monto, "id": sesion_id})

    db.commit()
    logger.info(f"[Caja] Egreso S/{req.monto} ({req.tipo}) en sesión {sesion_id}")

    return {"success": True, "message": f"Egreso de S/ {req.monto:.2f} registrado"}


@router.post("/{sesion_id}/cerrar")
async def cerrar_caja(
    sesion_id: int,
    req: CerrarCajaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Cerrar sesión de caja con arqueo."""
    _ensure_tables(db)
    store_id = current_user.store_id

    sesion = db.execute(text(
        "SELECT * FROM caja_sesiones WHERE id = :id AND store_id = :sid AND estado = 'abierta'"
    ), {"id": sesion_id, "sid": store_id}).fetchone()

    if not sesion:
        raise HTTPException(404, "Sesión no encontrada o ya cerrada")

    # Recalcular totales finales
    totales = _calcular_totales_sesion(db, sesion_id, store_id, sesion.fecha_apertura)
    total_egresos = db.execute(text(
        "SELECT COALESCE(SUM(monto),0) FROM caja_egresos WHERE sesion_id = :id"
    ), {"id": sesion_id}).scalar()

    efectivo_esperado = (
        float(sesion.efectivo_inicial or 0) +
        totales["total_efectivo_ventas"] -
        float(total_egresos or 0)
    )
    diferencia = req.efectivo_declarado - efectivo_esperado

    # Determinar estado
    estado = "cerrada"
    if abs(diferencia) > 0.10:  # tolerancia 10 céntimos
        estado = "observada"

    db.execute(text("""
        UPDATE caja_sesiones SET
            estado                  = :estado,
            fecha_cierre            = NOW(),
            user_id_cierre          = :uid,
            user_nombre_cierre      = :unombre,
            efectivo_declarado      = :ef_dec,
            yape_declarado          = :yape,
            plin_declarado          = :plin,
            tarjeta_declarado       = :tarjeta,
            total_ventas            = :tv,
            total_efectivo_ventas   = :tef,
            total_yape              = :ty,
            total_plin              = :tp,
            total_tarjeta           = :tt,
            cantidad_ventas         = :cv,
            total_egresos           = :te,
            diferencia_efectivo     = :dif,
            notas_cierre            = :notas,
            updated_at              = NOW()
        WHERE id = :id
    """), {
        "estado":   estado,
        "uid":      current_user.id,
        "unombre":  current_user.full_name,
        "ef_dec":   req.efectivo_declarado,
        "yape":     req.yape_declarado,
        "plin":     req.plin_declarado,
        "tarjeta":  req.tarjeta_declarado,
        "tv":       totales["total_ventas"],
        "tef":      totales["total_efectivo_ventas"],
        "ty":       totales["total_yape"],
        "tp":       totales["total_plin"],
        "tt":       totales["total_tarjeta"],
        "cv":       totales["cantidad_ventas"],
        "te":       float(total_egresos),
        "dif":      diferencia,
        "notas":    req.notas,
        "id":       sesion_id,
    })
    db.commit()

    logger.info(f"[Caja] Cerrada sesión {sesion_id} — diferencia S/{diferencia:.2f} — estado: {estado}")

    return {
        "success": True,
        "estado": estado,
        "diferencia": round(diferencia, 2),
        "efectivo_esperado": round(efectivo_esperado, 2),
        "efectivo_declarado": req.efectivo_declarado,
        "total_ventas": totales["total_ventas"],
        "message": (
            "Caja cerrada correctamente" if estado == "cerrada"
            else f"Caja cerrada con observación — diferencia S/{diferencia:.2f}"
        )
    }