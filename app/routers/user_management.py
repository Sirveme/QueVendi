# ================================================================
# QUEVENDI — User Management Endpoints
# Archivo: app/routers/user_management.py
#
# Endpoints para gestión de usuarios del negocio:
# - Listar usuarios de la tienda
# - Activar/desactivar usuarios
#
# Incluir en main.py:
#   from app.routers.user_management import router as user_mgmt_router
#   app.include_router(user_mgmt_router, prefix="/api/v1/users")
# ================================================================

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/store-users")
async def list_store_users(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Listar todos los usuarios de esta tienda"""
    if current_user["role"] not in ["owner", "admin"]:
        raise HTTPException(403, "Solo el dueño o admin puede ver usuarios")

    store_id = current_user["store_id"]

    users = db.query(User).filter(User.store_id == store_id).order_by(User.id).all()

    return [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "dni": u.dni,
            "role": u.role,
            "is_active": u.is_active,
        }
        for u in users
    ]


@router.post("/{user_id}/deactivate")
async def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Desactivar un usuario y revocar sus dispositivos"""
    if current_user["role"] not in ["owner", "admin"]:
        raise HTTPException(403, "Solo el dueño o admin puede desactivar usuarios")

    store_id = current_user["store_id"]

    # Buscar usuario
    user = db.query(User).filter(
        User.id == user_id,
        User.store_id == store_id
    ).first()

    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    if user.role == "owner":
        raise HTTPException(400, "No se puede desactivar al dueño")

    if user.id == current_user["user_id"]:
        raise HTTPException(400, "No puedes desactivarte a ti mismo")

    # Desactivar usuario
    user.is_active = False
    db.commit()

    # Intentar revocar dispositivos del usuario (si la tabla existe)
    try:
        db.execute(text("""
            UPDATE billing_devices SET is_active = FALSE
            WHERE store_id = :sid AND device_name LIKE :pattern
        """), {"sid": store_id, "pattern": f"%{user.username}%"})

        db.execute(text("""
            UPDATE billing_correlative_blocks SET is_active = FALSE
            WHERE store_id = :sid AND device_id IN (
                SELECT device_id FROM billing_devices
                WHERE store_id = :sid AND is_active = FALSE
            )
        """), {"sid": store_id})
        db.commit()
    except Exception:
        pass  # Table might not exist yet

    logger.info(f"[UserMgmt] 🚫 Usuario {user.username} (ID:{user_id}) desactivado")

    return {
        "success": True,
        "message": f"Usuario '{user.full_name}' desactivado",
        "user_id": user_id
    }


@router.post("/{user_id}/activate")
async def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Reactivar un usuario"""
    if current_user["role"] not in ["owner", "admin"]:
        raise HTTPException(403, "Solo el dueño o admin puede activar usuarios")

    store_id = current_user["store_id"]

    user = db.query(User).filter(
        User.id == user_id,
        User.store_id == store_id
    ).first()

    if not user:
        raise HTTPException(404, "Usuario no encontrado")

    user.is_active = True
    db.commit()

    logger.info(f"[UserMgmt] ✅ Usuario {user.username} (ID:{user_id}) reactivado")

    return {
        "success": True,
        "message": f"Usuario '{user.full_name}' activado",
        "user_id": user_id
    }