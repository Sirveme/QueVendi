"""
QueVendi — Gestión de Tiendas
==============================
Endpoints para registro y consulta de tiendas.

Rutas:
  POST /api/v1/stores/register          → Registro simple (legacy)
  POST /api/v1/stores/register-full     → Registro completo desde wizard
  GET  /api/v1/stores/list              → Listar tiendas activas
  GET  /api/v1/stores/{store_id}        → Detalle de tienda
  GET  /api/v1/stores/me/onboarding-status
  POST /api/v1/stores/me/complete-onboarding
  POST /api/v1/stores/me/reset-onboarding

Registrado en main.py:
  from app.api.v1 import stores
  app.include_router(stores.router, prefix="/api/v1", tags=["stores"])
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from app.core.database import get_db
from app.models.store import Store
from app.models.user import User
from app.models.product import Product
from app.core.security import hash_password
from app.api.dependencies import get_current_user
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stores")

# ════════════════════════════════════════════════
# SCHEMAS
# ════════════════════════════════════════════════

class AdminUserCreate(BaseModel):
    full_name: str
    dni: str
    pin: str
    email: str | None = None

class StoreRegister(BaseModel):
    commercial_name: str
    ruc: str
    phone: str | None = None
    address: str | None = None
    admin_user: AdminUserCreate

class VendedorCreate(BaseModel):
    full_name: str
    dni: str
    pin: str
    tipo: str = "cajero"  # cajero | pedidos

class PagoInstalacion(BaseModel):
    metodo: str           # plin | yape | transferencia
    nro_operacion: str
    monto: float = 60.0

class StoreRegisterFull(BaseModel):
    # Negocio
    ruc: str
    razon_social: str
    nombre_comercial: str
    direccion: Optional[str] = None
    distrito: Optional[str] = None
    provincia: Optional[str] = None
    departamento: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    giro: Optional[str] = None

    # Plan
    plan: str = "basico"
    precio_mensual: float = 70.0
    extra_usuarios: int = 0
    extra_anexos: int = 0

    # Admin
    admin_nombre: str
    admin_dni: str
    admin_pin: str

    # Vendedores
    vendedores: Optional[List[VendedorCreate]] = []

    # Pago instalación
    pago: Optional[PagoInstalacion] = None

    # Agente
    agente_dni: Optional[str] = None

# ════════════════════════════════════════════════
# MIGRACIÓN — tabla pagos_instalacion
# ════════════════════════════════════════════════

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS pagos_instalacion (
    id              SERIAL PRIMARY KEY,
    store_id        INTEGER NOT NULL REFERENCES stores(id),
    agente_dni      VARCHAR(8),
    metodo          VARCHAR(20),
    nro_operacion   VARCHAR(100),
    monto           DECIMAL(10,2),
    plan            VARCHAR(20),
    precio_mensual  DECIMAL(10,2),
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registro_intentos (
    id          SERIAL PRIMARY KEY,
    ip          VARCHAR(45),
    ref         VARCHAR(50),
    paso_max    INTEGER DEFAULT 1,
    ruc         VARCHAR(11),
    plan        VARCHAR(20),
    completado  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT NOW()
);
"""

def _ensure_tables(db: Session):
    try:
        db.execute(text(MIGRATION_SQL))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[StoreRegister] Migración: {e}")

# ════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════

@router.post("/register")
async def register_store(
    data: StoreRegister,
    db: Session = Depends(get_db)
):
    """
    Registro simple (legacy) — mantener para compatibilidad.
    """
    existing_store = db.query(Store).filter(Store.ruc == data.ruc).first()
    if existing_store:
        raise HTTPException(400, detail="Ya existe una tienda con este RUC")

    existing_user = db.query(User).filter(User.dni == data.admin_user.dni).first()
    if existing_user:
        raise HTTPException(400, detail="Ya existe un usuario con este DNI")

    try:
        new_store = Store(
            commercial_name=data.commercial_name,
            ruc=data.ruc,
            phone=data.phone,
            address=data.address,
            is_active=True
        )
        db.add(new_store)
        db.flush()

        hashed_pin = hash_password(data.admin_user.pin)
        new_user = User(
            full_name=data.admin_user.full_name,
            dni=data.admin_user.dni,
            pin_hash=hashed_pin,
            email=data.admin_user.email,
            store_id=new_store.id,
            role="admin",
            username=data.admin_user.dni,
            is_active=True
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_store)
        db.refresh(new_user)

        logger.info(f"[StoreRegister] ✅ {new_store.commercial_name} (ID:{new_store.id})")

        return {
            "success": True,
            "message": "Tienda registrada exitosamente",
            "store": {"id": new_store.id, "commercial_name": new_store.commercial_name, "ruc": new_store.ruc},
            "admin": {"id": new_user.id, "full_name": new_user.full_name, "dni": new_user.dni}
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[StoreRegister] ❌ {e}")
        raise HTTPException(500, detail=f"Error al registrar: {str(e)}")


@router.post("/register-full")
async def register_store_full(
    data: StoreRegisterFull,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Registro completo desde el wizard de Carlos/José.
    Crea: store + admin + vendedores + registra pago de instalación.
    No requiere autenticación.
    """
    _ensure_tables(db)

    # ── Capturar IP para analytics ────────────────────────────────────────────
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")

    # ── Validaciones ──────────────────────────────────────────────────────────
    if db.query(Store).filter(Store.ruc == data.ruc).first():
        raise HTTPException(400, detail=f"Ya existe una tienda con RUC {data.ruc}")

    if db.query(User).filter(User.dni == data.admin_dni).first():
        raise HTTPException(400, detail=f"Ya existe un usuario con DNI {data.admin_dni}")

    for v in (data.vendedores or []):
        if db.query(User).filter(User.dni == v.dni).first():
            raise HTTPException(400, detail=f"Ya existe un usuario con DNI {v.dni}")

    # ── Configuración por plan ────────────────────────────────────────────────
    PLAN_CFG = {
        "basico": {"max_users": 3,   "can_invoice": False},
        "crece":  {"max_users": 5,   "can_invoice": True},
        "pro":    {"max_users": 999, "can_invoice": True},
    }
    plan_cfg = PLAN_CFG.get(data.plan, PLAN_CFG["basico"])
    max_users = plan_cfg["max_users"] + data.extra_usuarios
    total_users = 1 + len(data.vendedores or [])

    if total_users > max_users:
        raise HTTPException(400, detail=f"El plan {data.plan} permite máximo {max_users} usuarios. Tienes {total_users}.")

    try:
        # ── 1. Crear tienda ───────────────────────────────────────────────────
        new_store = Store(
            ruc=data.ruc,
            business_name=data.razon_social,
            commercial_name=data.nombre_comercial,
            address=data.direccion,
            district=data.distrito,
            province=data.provincia,
            department=data.departamento,
            phone=data.telefono,
            email=data.email,
            business_type=data.giro,
            plan=data.plan,
            can_issue_invoices=plan_cfg["can_invoice"],
            is_active=True,
        )
        db.add(new_store)
        db.flush()

        # ── 2. Crear admin/dueño ──────────────────────────────────────────────
        new_admin = User(
            full_name=data.admin_nombre.upper(),
            dni=data.admin_dni,
            pin_hash=hash_password(data.admin_pin),
            phone=data.telefono,
            store_id=new_store.id,
            role="owner",
            username=data.admin_dni,
            is_active=True,
            can_register_purchases=True,
            can_view_analytics=True,
            can_modify_prices=True,
            can_cancel_sales=True,
            can_view_all_sales=True,
            can_manage_inventory=True,
        )
        db.add(new_admin)

        # ── 3. Crear vendedores ───────────────────────────────────────────────
        vendedores_creados = []
        for v in (data.vendedores or []):
            new_vend = User(
                full_name=v.full_name.upper(),
                dni=v.dni,
                pin_hash=hash_password(v.pin),
                store_id=new_store.id,
                role="seller",
                username=v.dni,
                is_active=True,
                can_cancel_sales=False,
                can_view_all_sales=False,
                can_modify_prices=False,
            )
            db.add(new_vend)
            vendedores_creados.append({
                "nombre":       v.full_name,
                "dni":          v.dni,
                "tipo":         v.tipo,
                "puede_cobrar": v.tipo == "cajero",
            })

        # ── 4. Registrar pago de instalación ──────────────────────────────────
        if data.pago:
            db.execute(text("""
                INSERT INTO pagos_instalacion
                    (store_id, agente_dni, metodo, nro_operacion, monto, plan, precio_mensual)
                VALUES
                    (:sid, :agente, :metodo, :nro, :monto, :plan, :precio)
            """), {
                "sid":    new_store.id,
                "agente": data.agente_dni,
                "metodo": data.pago.metodo,
                "nro":    data.pago.nro_operacion,
                "monto":  data.pago.monto,
                "plan":   data.plan,
                "precio": data.precio_mensual,
            })

        # ── 5. Registrar intento completado para analytics ────────────────────
        try:
            db.execute(text("""
                INSERT INTO registro_intentos
                    (ip, ref, paso_max, ruc, plan, completado)
                VALUES (:ip, :ref, 5, :ruc, :plan, TRUE)
            """), {
                "ip":   client_ip,
                "ref":  data.agente_dni,
                "ruc":  data.ruc,
                "plan": data.plan,
            })
        except Exception:
            pass  # No crítico

        db.commit()
        db.refresh(new_store)

        logger.info(f"[StoreRegister] ✅ {new_store.commercial_name} (ID:{new_store.id}) plan:{data.plan} agente:{data.agente_dni} ip:{client_ip}")

        return {
            "success":        True,
            "store_id":       new_store.id,
            "store_name":     new_store.commercial_name,
            "plan":           data.plan,
            "precio_mensual": data.precio_mensual,
            "admin_username": data.admin_dni,
            "admin_pin":      data.admin_pin,
            "vendedores":     vendedores_creados,
            "acceso_url":     "https://quevendi.pro",
            "message":        f"¡Cliente {new_store.commercial_name} activado correctamente!",
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[StoreRegister] ❌ Error: {e}")
        raise HTTPException(500, detail=f"Error al registrar: {str(e)}")


# ════════════════════════════════════════════════
# TRACKING DE INTENTOS (analytics)
# ════════════════════════════════════════════════

class TrackingRequest(BaseModel):
    paso: int
    ruc: Optional[str] = None
    plan: Optional[str] = None
    ref: Optional[str] = None

@router.post("/registro/tracking")
async def track_registro(
    data: TrackingRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Registra silenciosamente en qué paso está el usuario del wizard."""
    _ensure_tables(db)
    try:
        client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        db.execute(text("""
            INSERT INTO registro_intentos (ip, ref, paso_max, ruc, plan)
            VALUES (:ip, :ref, :paso, :ruc, :plan)
        """), {
            "ip":   client_ip,
            "ref":  data.ref,
            "paso": data.paso,
            "ruc":  data.ruc,
            "plan": data.plan,
        })
        db.commit()
    except Exception:
        pass
    return {"ok": True}


# ════════════════════════════════════════════════
# ENDPOINTS EXISTENTES — sin cambios
# ════════════════════════════════════════════════

@router.get("/list")
async def list_stores(db: Session = Depends(get_db)):
    """Listar todas las tiendas activas"""
    stores = db.query(Store).filter(Store.is_active == True).all()
    return [
        {"id": s.id, "commercial_name": s.commercial_name, "ruc": s.ruc}
        for s in stores
    ]


@router.get("/me/onboarding-status")
async def check_onboarding_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verifica si el usuario completó onboarding"""
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    products_count = db.query(func.count(Product.id)).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).scalar()
    return {
        "needs_onboarding":     products_count == 0,
        "onboarding_completed": store.onboarding_completed if store else False,
        "products_count":       products_count
    }


@router.post("/me/complete-onboarding")
async def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Marca onboarding como completado"""
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if store:
        store.onboarding_completed = True
        db.commit()
    return {"success": True}


@router.post("/me/reset-onboarding")
async def reset_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Resetear onboarding y borrar todos los productos (solo owners)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Solo owners pueden resetear")

    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Tienda no encontrada")

    store.onboarding_completed = False
    deleted_count = db.query(Product).filter(
        Product.store_id == current_user.store_id
    ).delete()
    db.commit()

    return {
        "success":             True,
        "message":             f"Onboarding reseteado. {deleted_count} productos eliminados.",
        "onboarding_completed": False,
        "products_deleted":    deleted_count
    }


@router.get("/{store_id}")
async def get_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener información de una tienda"""
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Tienda no encontrada")
    return {
        "id":              store.id,
        "commercial_name": store.commercial_name,
        "ruc":             store.ruc,
        "address":         store.address
    }