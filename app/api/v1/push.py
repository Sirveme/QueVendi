"""
QueVendi — Endpoints de notificaciones push
============================================

Las tres piezas que faltaban para que el push funcionara: entregar la
clave pública, dar de alta una suscripción y revocarla. Sin esto la
tabla `push_subscriptions` nunca se llenaba y los avisos se perdían en
un log.
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services import push_service as push

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/push", tags=["push"])


class SuscripcionIn(BaseModel):
    subscription: dict
    preferencias: Optional[dict] = None


class RevocarIn(BaseModel):
    endpoint: str


class PreferenciasIn(BaseModel):
    caja: bool = True
    stock: bool = True


@router.get("/vapid-key")
async def vapid_key():
    """
    Clave pública VAPID para que el navegador se suscriba.

    Es pública por definición: va en el JS del cliente. La privada nunca
    sale del servidor.
    """
    pub = os.getenv("VAPID_PUBLIC_KEY")
    if not pub:
        raise HTTPException(503, "Las notificaciones no están configuradas en el servidor")
    return {"publicKey": pub}


@router.get("/estado")
async def estado_push(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Si la tienda tiene push, si este usuario puede recibirlo y qué quiere."""
    push._ensure_tables(db)
    sid = current_user.store_id
    rol = getattr(current_user, "role", None)

    subs = db.execute(
        __import__("sqlalchemy").text(
            "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = :u AND activo = TRUE"),
        {"u": current_user.id}).scalar()

    return {
        "enabled": push.push_enabled(db, sid),
        "puede_recibir": rol in ("owner", "admin"),
        "suscrito": bool(subs),
        "dispositivos": subs,
        "preferencias": push.preferencias_de(db, current_user.id),
        "tipos": [{"clave": g, "etiqueta": ", ".join(
            push.TIPOS[t].etiqueta for t in tipos if t in push.TIPOS)}
            for g, tipos in push.GRUPOS.items()],
        "vapid_configurado": bool(os.getenv("VAPID_PUBLIC_KEY")),
    }


@router.post("/suscribir", status_code=201)
async def suscribir(
    req: SuscripcionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Registra el navegador de este usuario.

    Sólo owner/admin: los avisos son de gestión (caja, stock), no para
    el vendedor de mostrador.
    """
    push._ensure_tables(db)

    if getattr(current_user, "role", None) not in ("owner", "admin"):
        raise HTTPException(403, "Sólo el dueño o un administrador reciben estos avisos")

    try:
        r = push.suscribir(
            db, current_user.id, current_user.store_id, req.subscription,
            request.headers.get("user-agent", ""), req.preferencias)
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(422, str(e))
    except Exception as e:
        db.rollback()
        logger.error(f"[Push] Error suscribiendo: {e}")
        raise HTTPException(500, "No se pudo activar los avisos")

    return {"success": True, **r}


@router.delete("/suscribir")
async def revocar(
    req: RevocarIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Desactiva los avisos en este dispositivo."""
    push._ensure_tables(db)
    ok = push.revocar(db, current_user.id, req.endpoint)
    db.commit()
    if not ok:
        raise HTTPException(404, "Ese dispositivo no estaba suscrito")
    return {"success": True}


@router.put("/preferencias")
async def preferencias(
    req: PreferenciasIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Qué avisos quiere recibir el usuario."""
    push._ensure_tables(db)
    prefs = push.guardar_preferencias(db, current_user.id, req.dict())
    db.commit()
    return {"success": True, "preferencias": prefs}


@router.post("/probar")
async def probar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Manda un aviso de prueba al propio usuario.

    Sirve para comprobar en el momento de la instalación que el celular
    recibe, sin esperar a que se abra una caja de verdad.
    """
    push._ensure_tables(db)
    if getattr(current_user, "role", None) not in ("owner", "admin"):
        raise HTTPException(403, "Sólo el dueño o un administrador")

    r = push.aviso_caja_abierta(
        db, current_user.store_id,
        getattr(current_user, "full_name", "prueba"), "Prueba de avisos")
    return {"success": r.get("enviados", 0) > 0, **r}
