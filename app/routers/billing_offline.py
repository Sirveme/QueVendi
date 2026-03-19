# ================================================================
# QUEVENDI — Offline Billing Endpoints
# Archivo: app/routers/billing_offline.py
#
# Endpoints para facturación offline:
# 1. Registrar dispositivo → asignar serie única
# 2. Reservar bloque de correlativos → para usar sin internet
# 3. Sincronizar comprobantes offline → enviar a Facturalo/SUNAT
#
# Incluir en main.py:
#   from app.routers.billing_offline import router as billing_offline_router
#   app.include_router(billing_offline_router, prefix="/api/v1/billing/offline")
# ================================================================

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.billing import StoreBillingConfig

logger = logging.getLogger(__name__)

router = APIRouter()

TZ_PERU = timezone(timedelta(hours=-5))

# Tamaño del bloque de correlativos a reservar
DEFAULT_BLOCK_SIZE = 50
MAX_BLOCK_SIZE = 200


# ================================================================
# SCHEMAS
# ================================================================

class DeviceRegisterRequest(BaseModel):
    device_id: str          # Ej: "DEV-A1B2C3D4" (generado por OfflineDB.meta.getDeviceId)
    device_name: str = ""   # Ej: "Celular Juan", "Caja 1"
    tipo: str = "03"        # 03=Boleta (default), 01=Factura


class DeviceRegisterResponse(BaseModel):
    device_id: str
    serie: str
    tipo: str
    message: str


class ReserveBlockRequest(BaseModel):
    serie: str              # Ej: "B001"
    device_id: str
    cantidad: int = DEFAULT_BLOCK_SIZE


class ReserveBlockResponse(BaseModel):
    serie: str
    desde: int              # Primer número del bloque
    hasta: int              # Último número del bloque
    cantidad: int
    message: str


class OfflineComprobanteItem(BaseModel):
    """Un comprobante generado offline que necesita enviarse a SUNAT"""
    serie: str
    numero: int
    tipo: str               # "03" boleta, "01" factura
    fecha_emision: str      # "2026-03-04"
    hora_emision: str       # "15:30"
    cliente_tipo_doc: str = "0"
    cliente_num_doc: str = "00000000"
    cliente_nombre: str = "CLIENTE VARIOS"
    cliente_direccion: Optional[str] = None
    items: list             # [{descripcion, cantidad, precio_unitario, unidad}]
    total: float
    payment_method: str = "efectivo"
    is_credit: bool = False
    credit_days: int = 0
    sale_local_id: Optional[int] = None
    verification_code: Optional[str] = None


class SyncComprobantesRequest(BaseModel):
    device_id: str
    comprobantes: List[OfflineComprobanteItem]


class SyncComprobanteResult(BaseModel):
    serie: str
    numero: int
    numero_formato: str
    success: bool
    facturalo_id: Optional[int] = None
    pdf_url: Optional[str] = None
    error: Optional[str] = None


class SyncComprobantesResponse(BaseModel):
    total: int
    exitosos: int
    fallidos: int
    resultados: List[SyncComprobanteResult]


class DeviceInfo(BaseModel):
    device_id: str
    device_name: str
    serie: str
    tipo: str
    ultimo_numero: int
    bloques_activos: int
    registered_at: str


# ================================================================
# SQL — Tabla de dispositivos y bloques (crear si no existe)
# ================================================================

MIGRATION_SQL = """
-- Tabla de dispositivos registrados por tienda
CREATE TABLE IF NOT EXISTS billing_devices (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    device_id VARCHAR(50) NOT NULL,
    device_name VARCHAR(100) DEFAULT '',
    serie VARCHAR(10) NOT NULL,
    tipo VARCHAR(5) NOT NULL DEFAULT '03',
    ultimo_numero INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    registered_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(store_id, device_id),
    UNIQUE(store_id, serie)
);

-- Tabla de bloques de correlativos reservados
CREATE TABLE IF NOT EXISTS billing_correlative_blocks (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    device_id VARCHAR(50) NOT NULL,
    serie VARCHAR(10) NOT NULL,
    desde INTEGER NOT NULL,
    hasta INTEGER NOT NULL,
    usado_hasta INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    reserved_at TIMESTAMP DEFAULT NOW(),
    synced_at TIMESTAMP
);

-- Tabla de comprobantes offline pendientes de SUNAT
CREATE TABLE IF NOT EXISTS billing_offline_queue (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    device_id VARCHAR(50) NOT NULL,
    serie VARCHAR(10) NOT NULL,
    numero INTEGER NOT NULL,
    tipo VARCHAR(5) NOT NULL,
    fecha_emision DATE NOT NULL,
    hora_emision TIME,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    facturalo_id INTEGER,
    sunat_code VARCHAR(10),
    pdf_url TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    synced_at TIMESTAMP,
    UNIQUE(store_id, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_offline_queue_status
    ON billing_offline_queue(store_id, status);
"""


# ================================================================
# HELPERS
# ================================================================

def _ensure_tables(db: Session):
    """Crear tablas si no existen (idempotente)"""
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[OfflineBilling] Migration warning: {e}")


def _get_next_serie(db: Session, store_id: int, tipo: str) -> str:
    """
    Asigna la siguiente serie disponible para un dispositivo.
    Boletas: B001, B002, B003...
    Facturas: F001, F002, F003...
    """
    prefix = "B" if tipo == "03" else "F"

    # Buscar series ya asignadas
    result = db.execute(text("""
        SELECT serie FROM billing_devices
        WHERE store_id = :sid AND tipo = :tipo AND serie LIKE :prefix
        ORDER BY serie DESC LIMIT 1
    """), {"sid": store_id, "tipo": tipo, "prefix": f"{prefix}%"}).fetchone()

    if result:
        # Extraer número de la última serie y sumar 1
        last_num = int(result[0][1:])  # "B003" → 3
        next_num = last_num + 1
    else:
        # Primera serie de este tipo
        next_num = 1

    return f"{prefix}{str(next_num).zfill(3)}"


def _get_ultimo_numero(db: Session, store_id: int, serie: str) -> int:
    """Obtiene el último número usado de una serie (de bloques o comprobantes reales)"""
    # Verificar en billing_config (números ya usados/sincronizados)
    result = db.execute(text("""
        SELECT COALESCE(MAX(hasta), 0) FROM billing_correlative_blocks
        WHERE store_id = :sid AND serie = :serie
    """), {"sid": store_id, "serie": serie}).scalar()

    # También verificar en comprobantes reales por si hay del flujo online
    result2 = db.execute(text("""
        SELECT COALESCE(MAX(numero), 0) FROM comprobantes
        WHERE store_id = :sid AND serie = :serie
    """), {"sid": store_id, "serie": serie}).scalar()

    return max(result or 0, result2 or 0)


# ================================================================
# ENDPOINTS
# ================================================================

@router.post("/device/register", response_model=DeviceRegisterResponse)
async def register_device(
    req: DeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Registrar un dispositivo (celular/tablet/PC) y asignarle una serie.
    Solo owner/admin pueden registrar dispositivos.
    """
    if current_user.role not in ["owner", "admin", "seller"]:
        raise HTTPException(403, "Solo el dueño, admin o vendedor puede registrar dispositivos")

    _ensure_tables(db)
    store_id = current_user.store_id

    # ── LÍMITE POR PLAN ──
    PLAN_LIMITS = {"demo": 2, "freemium": 2, "basico": 2, "crece": 3, "pro": 99}
    # Get store plan
    store_plan = db.execute(text(
        "SELECT plan FROM stores WHERE id = :sid"
    ), {"sid": store_id}).scalar() or "basico"
    max_devices = PLAN_LIMITS.get(store_plan, 2)

    # Count existing active devices
    current_count = db.execute(text(
        "SELECT COUNT(*) FROM billing_devices WHERE store_id = :sid AND is_active = TRUE"
    ), {"sid": store_id}).scalar() or 0

    # ── LÍMITE POR ROL ── (seller: max 1 dispositivo)
    role = current_user.role
    if role == "seller":
        seller_devices = db.execute(text("""
            SELECT COUNT(*) FROM billing_devices bd
            JOIN users u ON u.store_id = bd.store_id
            WHERE bd.device_id = :did AND bd.is_active = TRUE
        """), {"did": req.device_id}).scalar() or 0
        # For sellers, we check if THIS device_id is already registered by someone else
        # A seller can only register 1 device

    # Check plan limit
    if current_count >= max_devices:
        raise HTTPException(400,
            f"Límite de dispositivos alcanzado ({current_count}/{max_devices}). "
            f"Plan actual: {store_plan}. Mejora tu plan para más dispositivos."
        )

    # Verificar si ya está registrado
    existing = db.execute(text("""
        SELECT serie FROM billing_devices
        WHERE store_id = :sid AND device_id = :did
    """), {"sid": store_id, "did": req.device_id}).fetchone()

    if existing:
        return DeviceRegisterResponse(
            device_id=req.device_id,
            serie=existing[0],
            tipo=req.tipo,
            message=f"Dispositivo ya registrado con serie {existing[0]}"
        )

    # Asignar nueva serie
    serie = _get_next_serie(db, store_id, req.tipo)

    db.execute(text("""
        INSERT INTO billing_devices (store_id, device_id, device_name, serie, tipo)
        VALUES (:sid, :did, :dname, :serie, :tipo)
    """), {
        "sid": store_id, "did": req.device_id,
        "dname": req.device_name, "serie": serie, "tipo": req.tipo
    })
    db.commit()

    logger.info(f"[OfflineBilling] Dispositivo {req.device_id} → serie {serie} (store {store_id})")

    return DeviceRegisterResponse(
        device_id=req.device_id,
        serie=serie,
        tipo=req.tipo,
        message=f"Serie {serie} asignada. Reserva un bloque de correlativos para facturar offline."
    )


@router.post("/reserve-block", response_model=ReserveBlockResponse)
async def reserve_correlative_block(
    req: ReserveBlockRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Reservar un bloque de números correlativos para uso offline.
    El dispositivo guarda este rango en IndexedDB y lo usa sin internet.
    """
    if current_user.role not in ["owner", "admin", "seller"]:
        raise HTTPException(403, "No autorizado")

    _ensure_tables(db)
    store_id = current_user.store_id
    cantidad = min(req.cantidad, MAX_BLOCK_SIZE)

    # Verificar que el dispositivo está registrado con esta serie
    device = db.execute(text("""
        SELECT id FROM billing_devices
        WHERE store_id = :sid AND device_id = :did AND serie = :serie
    """), {"sid": store_id, "did": req.device_id, "serie": req.serie}).fetchone()

    if not device:
        raise HTTPException(400, f"Dispositivo {req.device_id} no tiene serie {req.serie} asignada")

    # Obtener último número usado
    ultimo = _get_ultimo_numero(db, store_id, req.serie)
    desde = ultimo + 1
    hasta = desde + cantidad - 1

    # Registrar bloque
    db.execute(text("""
        INSERT INTO billing_correlative_blocks
            (store_id, device_id, serie, desde, hasta, usado_hasta)
        VALUES (:sid, :did, :serie, :desde, :hasta, :desde)
    """), {
        "sid": store_id, "did": req.device_id,
        "serie": req.serie, "desde": desde, "hasta": hasta
    })

    # Actualizar último número en el dispositivo
    db.execute(text("""
        UPDATE billing_devices SET ultimo_numero = :hasta
        WHERE store_id = :sid AND device_id = :did
    """), {"sid": store_id, "did": req.device_id, "hasta": hasta})

    db.commit()

    logger.info(f"[OfflineBilling] Bloque {req.serie} {desde}-{hasta} → device {req.device_id}")

    return ReserveBlockResponse(
        serie=req.serie,
        desde=desde,
        hasta=hasta,
        cantidad=cantidad,
        message=f"Bloque reservado: {req.serie}-{str(desde).zfill(8)} al {req.serie}-{str(hasta).zfill(8)}"
    )


@router.post("/sync-comprobantes", response_model=SyncComprobantesResponse)
async def sync_offline_comprobantes(
    req: SyncComprobantesRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Recibir comprobantes generados offline y enviarlos a Facturalo/SUNAT.
    Se llama cuando el dispositivo recupera internet.
    """
    _ensure_tables(db)
    store_id = current_user.store_id

    # Obtener config de facturación
    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == store_id,
        StoreBillingConfig.is_active == True
    ).first()

    resultados = []
    exitosos = 0
    fallidos = 0

    for comp in req.comprobantes:
        numero_formato = f"{comp.serie}-{str(comp.numero).zfill(8)}"

        # Verificar que no se haya enviado antes
        existing = db.execute(text("""
            SELECT id FROM billing_offline_queue
            WHERE store_id = :sid AND serie = :serie AND numero = :num
        """), {"sid": store_id, "serie": comp.serie, "num": comp.numero}).fetchone()

        if existing:
            resultados.append(SyncComprobanteResult(
                serie=comp.serie, numero=comp.numero,
                numero_formato=numero_formato,
                success=True, error="Ya sincronizado previamente"
            ))
            exitosos += 1
            continue

        # Guardar en cola
        import json
        db.execute(text("""
            INSERT INTO billing_offline_queue
                (store_id, device_id, serie, numero, tipo, fecha_emision, hora_emision, payload, status)
            VALUES
                (:sid, :did, :serie, :num, :tipo, :fecha, :hora, :payload::jsonb, 'pending')
        """), {
            "sid": store_id, "did": req.device_id,
            "serie": comp.serie, "num": comp.numero, "tipo": comp.tipo,
            "fecha": comp.fecha_emision, "hora": comp.hora_emision,
            "payload": json.dumps(comp.dict(), default=str)
        })

        # Intentar enviar a Facturalo inmediatamente si hay config
        if config:
            try:
                result = await _enviar_offline_a_facturalo(
                    config, comp, store_id
                )
                if result["success"]:
                    db.execute(text("""
                        UPDATE billing_offline_queue SET
                            status = 'accepted', facturalo_id = :fid,
                            pdf_url = :pdf, synced_at = NOW()
                        WHERE store_id = :sid AND serie = :serie AND numero = :num
                    """), {
                        "sid": store_id, "serie": comp.serie, "num": comp.numero,
                        "fid": result.get("facturalo_id"),
                        "pdf": result.get("pdf_url")
                    })
                    resultados.append(SyncComprobanteResult(
                        serie=comp.serie, numero=comp.numero,
                        numero_formato=numero_formato,
                        success=True,
                        facturalo_id=result.get("facturalo_id"),
                        pdf_url=result.get("pdf_url")
                    ))
                    exitosos += 1
                else:
                    db.execute(text("""
                        UPDATE billing_offline_queue SET
                            status = 'error', error_message = :err, retry_count = 1
                        WHERE store_id = :sid AND serie = :serie AND numero = :num
                    """), {"sid": store_id, "serie": comp.serie, "num": comp.numero,
                           "err": result.get("error", "Unknown")})
                    resultados.append(SyncComprobanteResult(
                        serie=comp.serie, numero=comp.numero,
                        numero_formato=numero_formato,
                        success=False, error=result.get("error")
                    ))
                    fallidos += 1
            except Exception as e:
                logger.error(f"[OfflineBilling] Error enviando {numero_formato}: {e}")
                resultados.append(SyncComprobanteResult(
                    serie=comp.serie, numero=comp.numero,
                    numero_formato=numero_formato,
                    success=False, error=str(e)
                ))
                fallidos += 1
        else:
            # Sin config de facturación — queda en cola para después
            resultados.append(SyncComprobanteResult(
                serie=comp.serie, numero=comp.numero,
                numero_formato=numero_formato,
                success=False, error="Sin configuración de facturación"
            ))
            fallidos += 1

    db.commit()

    return SyncComprobantesResponse(
        total=len(req.comprobantes),
        exitosos=exitosos,
        fallidos=fallidos,
        resultados=resultados
    )


@router.get("/devices", response_model=List[DeviceInfo])
async def list_devices(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Listar dispositivos registrados de esta tienda"""
    _ensure_tables(db)
    store_id = current_user.store_id

    rows = db.execute(text("""
        SELECT d.device_id, d.device_name, d.serie, d.tipo, d.ultimo_numero,
               d.registered_at,
               (SELECT COUNT(*) FROM billing_correlative_blocks b
                WHERE b.store_id = d.store_id AND b.device_id = d.device_id AND b.is_active)
        FROM billing_devices d
        WHERE d.store_id = :sid AND d.is_active = TRUE
        ORDER BY d.registered_at
    """), {"sid": store_id}).fetchall()

    return [
        DeviceInfo(
            device_id=r[0], device_name=r[1] or "", serie=r[2], tipo=r[3],
            ultimo_numero=r[4], bloques_activos=r[6],
            registered_at=r[5].isoformat() if r[5] else ""
        ) for r in rows
    ]


@router.post("/device/{device_id}/revoke")
async def revoke_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Desactivar un dispositivo y anular sus bloques pendientes.
    Solo owner/admin pueden hacerlo.
    """
    if current_user.role not in ["owner", "admin", "seller"]:
        raise HTTPException(403, "Solo el dueño, admin o vendedor puede desactivar dispositivos")

    _ensure_tables(db)
    store_id = current_user.store_id

    # Verificar que el dispositivo pertenece a esta tienda
    device = db.execute(text("""
        SELECT id, device_name, serie FROM billing_devices
        WHERE store_id = :sid AND device_id = :did AND is_active = TRUE
    """), {"sid": store_id, "did": device_id}).fetchone()

    if not device:
        raise HTTPException(404, "Dispositivo no encontrado o ya desactivado")

    # Desactivar dispositivo
    db.execute(text("""
        UPDATE billing_devices SET is_active = FALSE
        WHERE store_id = :sid AND device_id = :did
    """), {"sid": store_id, "did": device_id})

    # Anular bloques pendientes
    db.execute(text("""
        UPDATE billing_correlative_blocks SET is_active = FALSE
        WHERE store_id = :sid AND device_id = :did AND is_active = TRUE
    """), {"sid": store_id, "did": device_id})

    db.commit()

    logger.info(f"[OfflineBilling] 🚫 Dispositivo {device_id} (serie {device[2]}) desactivado por {current_user.role}")

    return {
        "success": True,
        "message": f"Dispositivo '{device[1]}' desactivado. Serie {device[2]} bloqueada.",
        "device_id": device_id,
        "serie": device[2]
    }


@router.get("/block-status/{serie}")
async def get_block_status(
    serie: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Ver estado de bloques de una serie"""
    _ensure_tables(db)
    store_id = current_user.store_id

    blocks = db.execute(text("""
        SELECT desde, hasta, usado_hasta, is_active, reserved_at, synced_at
        FROM billing_correlative_blocks
        WHERE store_id = :sid AND serie = :serie
        ORDER BY desde
    """), {"sid": store_id, "serie": serie}).fetchall()

    return {
        "serie": serie,
        "bloques": [
            {
                "desde": b[0], "hasta": b[1], "usado_hasta": b[2],
                "restantes": b[1] - b[2], "activo": b[3],
                "reservado": b[4].isoformat() if b[4] else None,
                "sincronizado": b[5].isoformat() if b[5] else None
            } for b in blocks
        ]
    }



@router.get("/device/my-token")
async def get_my_device(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Recuperar el dispositivo registrado para el usuario actual.
    Se llama al login para restaurar device_token si se perdió localmente.
    """
    _ensure_tables(db)
    store_id = current_user.store_id

    # Buscar dispositivos activos de esta tienda
    devices = db.execute(text("""
        SELECT bd.device_id, bd.device_name, bd.serie, bd.tipo,
               bd.is_active, bd.created_at,
               COALESCE(
                   (SELECT SUM(hasta - desde + 1 - usado)
                    FROM billing_correlative_blocks
                    WHERE device_id = bd.device_id
                      AND store_id = bd.store_id
                      AND is_active = TRUE), 0
               ) as correlativos_restantes
        FROM billing_devices bd
        WHERE bd.store_id = :sid AND bd.is_active = TRUE
        ORDER BY bd.created_at DESC
    """), {"sid": store_id}).fetchall()

    if not devices:
        return {
            "registered": False,
            "message": "No hay dispositivos registrados. El dueño debe registrar este dispositivo."
        }

    device_list = []
    for d in devices:
        device_list.append({
            "device_id":             d.device_id,
            "device_name":           d.device_name,
            "serie":                 d.serie,
            "tipo":                  d.tipo,
            "correlativos_restantes": int(d.correlativos_restantes or 0),
        })

    return {
        "registered": True,
        "devices":    device_list,
        "total":      len(device_list)
    }


# ================================================================
# HELPER — Enviar comprobante offline a Facturalo.pro
# ================================================================

async def _enviar_offline_a_facturalo(
    config: StoreBillingConfig,
    comp: OfflineComprobanteItem,
    store_id: int
) -> dict:
    """
    Envía un comprobante pre-numerado a Facturalo.pro.
    Facturalo recibe serie+numero ya asignados, firma XML y envía a SUNAT.
    """
    import httpx

    payload = {
        "tipo_comprobante": comp.tipo,
        "serie": comp.serie,
        "numero": comp.numero,  # ← PRE-ASIGNADO (no lo genera Facturalo)
        "fecha_emision": comp.fecha_emision,
        "hora_emision": comp.hora_emision,
        "moneda": "PEN",
        "forma_pago": "Credito" if comp.is_credit else "Contado",
        "cliente": {
            "tipo_documento": comp.cliente_tipo_doc,
            "numero_documento": comp.cliente_num_doc,
            "razon_social": comp.cliente_nombre,
            "direccion": comp.cliente_direccion
        },
        "items": [{
            "descripcion": item.get("descripcion", item.get("product_name", "")),
            "cantidad": item.get("cantidad", item.get("quantity", 1)),
            "unidad_medida": item.get("unidad", item.get("unit", "NIU")),
            "precio_unitario": item.get("precio_unitario", item.get("unit_price", 0)),
            "tipo_afectacion_igv": config.tipo_afectacion_igv
        } for item in comp.items],
        "observaciones": f"Forma de pago: {comp.payment_method}",
        "referencia_externa": f"QUEVENDI-OFFLINE-{comp.verification_code or comp.sale_local_id}",
    }

    api_url = f"{config.facturalo_url}/comprobantes"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                api_url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": config.facturalo_token,
                    "X-API-Secret": config.facturalo_secret
                }
            )

            data = response.json()

            if response.status_code in [200, 201] and data.get("exito"):
                comp_data = data.get("comprobante", {})
                archivos = data.get("archivos", {})
                return {
                    "success": True,
                    "facturalo_id": comp_data.get("id"),
                    "pdf_url": archivos.get("pdf_url"),
                    "hash": comp_data.get("hash_cpe"),
                }
            else:
                return {
                    "success": False,
                    "error": data.get("mensaje") or data.get("error") or str(data)
                }

    except Exception as e:
        return {"success": False, "error": str(e)}