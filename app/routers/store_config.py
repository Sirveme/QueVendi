# ================================================================
# QUEVENDI — Store Configuration Endpoint
# Archivo: app/routers/store_config.py
#
# Guarda/carga configuración del negocio en PostgreSQL.
# Incluir en main.py:
#   from app.routers.store_config import router as store_config_router
#   app.include_router(store_config_router, prefix="/api/v1/store")
# ================================================================

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()


# ================================================================
# MIGRATION — Tabla store_config
# ================================================================

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS store_config (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL UNIQUE REFERENCES stores(id),
    ruc VARCHAR(11),
    razon_social VARCHAR(200),
    nombre_comercial VARCHAR(200),
    direccion VARCHAR(300),
    cod_establecimiento VARCHAR(4) DEFAULT '0000',
    distrito VARCHAR(100),
    provincia VARCHAR(100),
    departamento VARCHAR(100),
    giro VARCHAR(200),
    slogan VARCHAR(300),
    telefono VARCHAR(20),
    email VARCHAR(100),
    logo TEXT,
    serie_boleta VARCHAR(4) DEFAULT 'B001',
    serie_factura VARCHAR(4) DEFAULT 'F001',
    serie_nc_boleta VARCHAR(4) DEFAULT 'BC01',
    serie_nc_factura VARCHAR(4) DEFAULT 'FC01',
    tipo_igv VARCHAR(5) DEFAULT '20',
    es_amazonia BOOLEAN DEFAULT TRUE,
    ticket_width VARCHAR(5) DEFAULT '80',
    print_method VARCHAR(20) DEFAULT 'agent',
    contador_ruc VARCHAR(11),
    contador_nombre VARCHAR(200),
    facturalo_url VARCHAR(200) DEFAULT 'https://facturalo.pro/api/v1',
    facturalo_token VARCHAR(200),
    facturalo_secret VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
"""


def _ensure_table(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[StoreConfig] Migration warning: {e}")


# ================================================================
# SCHEMAS
# ================================================================

class StoreConfigRequest(BaseModel):
    ruc: Optional[str] = None
    razon_social: Optional[str] = None
    nombre_comercial: Optional[str] = None
    direccion: Optional[str] = None
    cod_establecimiento: Optional[str] = '0000'
    distrito: Optional[str] = None
    provincia: Optional[str] = None
    departamento: Optional[str] = None
    giro: Optional[str] = None
    slogan: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    logo: Optional[str] = None
    serie_boleta: Optional[str] = 'B001'
    serie_factura: Optional[str] = 'F001'
    serie_nc_boleta: Optional[str] = 'BC01'
    serie_nc_factura: Optional[str] = 'FC01'
    tipo_igv: Optional[str] = '20'
    es_amazonia: Optional[bool] = True
    ticket_width: Optional[str] = '80'
    print_method: Optional[str] = 'agent'
    contador_ruc: Optional[str] = None
    contador_nombre: Optional[str] = None
    facturalo_url: Optional[str] = 'https://facturalo.pro/api/v1'
    facturalo_token: Optional[str] = None
    facturalo_secret: Optional[str] = None
    # ── Diseño del ticket ──
    header_style:    Optional[int] = 1
    font_decorativa: Optional[str] = 'playfair'
    font_ruc:        Optional[str] = 'lato'
    font_numero:     Optional[str] = 'bebas'
    font_total:      Optional[str] = 'archivo'
    font_slogan:     Optional[str] = 'pacifico'
    eslogan2:        Optional[str] = ''
    papel_ancho:     Optional[int] = 80
    printer_name:    Optional[str] = ''
    catalogo_activo: Optional[bool] = False


# ================================================================
# ENDPOINTS
# ================================================================

@router.post("/config")
async def save_store_config(
    data: StoreConfigRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Guardar configuración del negocio"""
    if current_user.role not in ["owner", "admin", "demo_seller"]:
        raise HTTPException(403, "No tienes permiso para configurar el negocio")

    _ensure_table(db)
    store_id = current_user.store_id

    # Verificar si existe
    existing = db.execute(text(
        "SELECT id FROM store_config WHERE store_id = :sid"
    ), {"sid": store_id}).fetchone()

    fields = data.dict(exclude_none=False)
    fields.pop('logo', None) if not data.logo else None  # No borrar logo si no se envía

    if existing:
        # UPDATE
        set_parts = []
        params = {"sid": store_id}
        for key, val in fields.items():
            if key == 'logo' and not val:
                continue
            set_parts.append(f"{key} = :{key}")
            params[key] = val
        set_parts.append("updated_at = NOW()")

        sql = f"UPDATE store_config SET {', '.join(set_parts)} WHERE store_id = :sid"
        db.execute(text(sql), params)
    else:
        # INSERT
        fields['store_id'] = store_id
        cols = ', '.join(fields.keys())
        vals = ', '.join(f':{k}' for k in fields.keys())
        db.execute(text(f"INSERT INTO store_config ({cols}) VALUES ({vals})"), fields)

    db.commit()

    # También actualizar StoreBillingConfig si se enviaron credenciales de Facturalo
    if data.facturalo_token and data.facturalo_secret:
        try:
            _sync_billing_config(db, store_id, data)
        except Exception as e:
            logger.warning(f"[StoreConfig] Error syncing billing config: {e}")

    logger.info(f"[StoreConfig] ✅ Config guardada para store {store_id}")
    return {"success": True, "message": "Configuración guardada correctamente"}


@router.get("/config")
async def get_store_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener configuración del negocio"""
    _ensure_table(db)
    store_id = current_user.store_id

    row = db.execute(text(
        "SELECT * FROM store_config WHERE store_id = :sid"
    ), {"sid": store_id}).fetchone()

    if not row:
        return {"configured": False}

    # Convertir Row a dict
    columns = row._mapping
    config = {k: v for k, v in columns.items() if k not in ['id', 'created_at', 'updated_at']}

    # No enviar secrets completos
    if config.get('facturalo_token'):
        config['facturalo_token'] = '••••' + config['facturalo_token'][-4:]
    if config.get('facturalo_secret'):
        config['facturalo_secret'] = '••••' + config['facturalo_secret'][-4:]

    return {"configured": True, "config": config}


def _sync_billing_config(db: Session, store_id: int, data: StoreConfigRequest):
    """Sincronizar datos con StoreBillingConfig (para compatibilidad)"""
    from app.models.billing import StoreBillingConfig

    config = db.query(StoreBillingConfig).filter(
        StoreBillingConfig.store_id == store_id
    ).first()

    if config:
        if data.ruc: config.ruc = data.ruc
        if data.razon_social: config.razon_social = data.razon_social
        if data.nombre_comercial: config.nombre_comercial = data.nombre_comercial
        if data.direccion: config.direccion = data.direccion
        if data.serie_boleta: config.serie_boleta = data.serie_boleta
        if data.serie_factura: config.serie_factura = data.serie_factura
        if data.tipo_igv: config.tipo_afectacion_igv = data.tipo_igv
        if data.facturalo_token and not data.facturalo_token.startswith('••••'):
            config.facturalo_token = data.facturalo_token
        if data.facturalo_secret and not data.facturalo_secret.startswith('••••'):
            config.facturalo_secret = data.facturalo_secret
        if data.facturalo_url: config.facturalo_url = data.facturalo_url
        config.is_active = True
    else:
        if data.facturalo_token and not data.facturalo_token.startswith('••••'):
            config = StoreBillingConfig(
                store_id=store_id,
                ruc=data.ruc,
                razon_social=data.razon_social,
                nombre_comercial=data.nombre_comercial,
                direccion=data.direccion,
                facturalo_url=data.facturalo_url or 'https://facturalo.pro/api/v1',
                facturalo_token=data.facturalo_token,
                facturalo_secret=data.facturalo_secret,
                serie_boleta=data.serie_boleta or 'B001',
                serie_factura=data.serie_factura or 'F001',
                tipo_afectacion_igv=data.tipo_igv or '20',
                is_active=True,
            )
            db.add(config)

    db.commit()