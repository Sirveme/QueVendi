"""
Webhook receiver para alertas de Facturalo.pro.

Endpoint público con verificación de secreto compartido.
Convierte el evento en push notifications a:
  - Duilio (usuario SOTE, DNI definido en env DUILIO_DNI o default '10053937760').
  - Owner del store correspondiente al emisor_ruc, cuando aplique.
"""
import os
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.models.store import Store
from app.models.incidente import PushSubscription

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])

FACTURALO_WEBHOOK_SECRET = os.getenv("FACTURALO_WEBHOOK_SECRET", "")
DUILIO_DNI = os.getenv("DUILIO_DNI", "10053937760")


def _enviar_push(db: Session, user_ids: List[int], titulo: str, cuerpo: str,
                 url_accion: str = "/dashboard") -> int:
    """Push web. Reusa el mismo patrón que tributario.py."""
    if not user_ids:
        return 0

    subs = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id.in_(user_ids),
            PushSubscription.activo == True,  # noqa: E712
        )
        .all()
    )
    if not subs:
        logger.info("[webhook facturalo] sin suscripciones push users=%s — %s", user_ids, titulo)
        return 0

    try:
        from pywebpush import webpush, WebPushException  # type: ignore
    except ImportError:
        logger.warning("[webhook facturalo] pywebpush no instalado — %d suscripciones omitidas. %s — %s",
                       len(subs), titulo, cuerpo)
        return 0

    vapid_private = os.getenv("VAPID_PRIVATE_KEY")
    vapid_claims_email = os.getenv("VAPID_CLAIMS_EMAIL", "mailto:soporte@quevendi.pe")
    if not vapid_private:
        logger.warning("[webhook facturalo] VAPID_PRIVATE_KEY no configurado — push omitido")
        return 0

    enviadas = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps({"title": titulo, "body": cuerpo, "url": url_accion}),
                vapid_private_key=vapid_private,
                vapid_claims={"sub": vapid_claims_email},
            )
            enviadas += 1
        except WebPushException as e:  # type: ignore
            logger.warning("[webhook facturalo] push fallida sub=%s: %s", sub.id, e)
        except Exception as e:
            logger.warning("[webhook facturalo] push error sub=%s: %s", sub.id, e)
    return enviadas


def _duilio_ids(db: Session) -> List[int]:
    user = db.query(User).filter(User.dni == DUILIO_DNI).first()
    return [user.id] if user else []


def _owner_ids_de_store(db: Session, store: Store) -> List[int]:
    owners = (
        db.query(User)
        .filter(
            User.store_id == store.id,
            User.role == "owner",
        )
        .all()
    )
    return [u.id for u in owners]


@router.post("/webhooks/facturalo-alerta")
async def facturalo_alerta(request: Request, db: Session = Depends(get_db)):
    """Recibe alertas de Facturalo y dispatcha push según el tipo."""
    secret = request.headers.get("X-Webhook-Secret", "")
    if not FACTURALO_WEBHOOK_SECRET or secret != FACTURALO_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="No autorizado")

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    tipo = data.get("tipo")
    emisor_ruc = data.get("emisor_ruc") or ""
    negocio = data.get("negocio") or "Negocio"
    serie = data.get("serie")
    numero = data.get("numero")
    monto = float(data.get("monto") or 0)

    store: Optional[Store] = None
    if emisor_ruc:
        store = (
            db.query(Store)
            .filter(Store.ruc == emisor_ruc, Store.is_active == True)  # noqa: E712
            .first()
        )

    duilio_ids = _duilio_ids(db)
    notif_negocio = bool(data.get("notificar_negocio")) and store is not None

    push_duilio = 0
    push_negocio = 0

    if tipo == "reintento_temporal":
        intento = data.get("intento")
        max_intentos = data.get("max_intentos")
        minutos = data.get("proxima_vez_minutos")
        codigo = data.get("error_codigo", "?")
        titulo = "🔔 Facturalo.pro"
        cuerpo = (
            f"⚠️ SUNAT caído ({codigo})\n"
            f"{negocio}: {serie}-{numero} S/ {monto:.2f}\n"
            f"Reintentando en {minutos}min (intento {intento}/{max_intentos})"
        )
        push_duilio = _enviar_push(db, duilio_ids, titulo, cuerpo, "/dashboard")

    elif tipo == "resuelto_automatico":
        intentos = data.get("intentos_totales", 1)
        titulo = "🔔 Facturalo.pro"
        cuerpo_duilio = (
            f"✅ Resuelto automáticamente\n"
            f"{negocio}: {serie}-{numero} S/ {monto:.2f}\n"
            f"Aceptada por SUNAT tras {intentos} intento(s)"
        )
        push_duilio = _enviar_push(db, duilio_ids, titulo, cuerpo_duilio, "/dashboard")
        if notif_negocio:
            owner_ids = _owner_ids_de_store(db, store)
            cuerpo_negocio = (
                f"✅ Comprobante aceptado\n"
                f"{serie}-{numero} S/ {monto:.2f} fue aceptado por SUNAT."
            )
            push_negocio = _enviar_push(db, owner_ids, "🔔 QueVendí", cuerpo_negocio, "/dashboard")

    elif tipo == "fallo_definitivo":
        codigo = data.get("error_codigo", "?")
        intentos = data.get("intentos_totales", 0)
        titulo = "🚨 Facturalo.pro"
        cuerpo_duilio = (
            f"🚨 REQUIERE ATENCIÓN MANUAL\n"
            f"{negocio}: {serie}-{numero} S/ {monto:.2f}\n"
            f"Error {codigo} · {intentos} intento(s) fallido(s)"
        )
        push_duilio = _enviar_push(db, duilio_ids, titulo, cuerpo_duilio, "/dashboard")
        if notif_negocio:
            owner_ids = _owner_ids_de_store(db, store)
            cuerpo_negocio = (
                f"⚠️ Problema con comprobante\n"
                f"{serie}-{numero} S/ {monto:.2f} tuvo un problema con SUNAT. "
                f"Nuestro equipo ya fue notificado."
            )
            push_negocio = _enviar_push(db, owner_ids, "🔔 QueVendí", cuerpo_negocio, "/dashboard")

    else:
        logger.info("[webhook facturalo] tipo desconocido: %s — payload=%s", tipo, data)
        return {"ok": True, "ignored": True, "tipo": tipo}

    return {
        "ok": True,
        "tipo": tipo,
        "push_duilio": push_duilio,
        "push_negocio": push_negocio,
        "store_id": store.id if store else None,
    }
