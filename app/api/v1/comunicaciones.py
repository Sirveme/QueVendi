# ============================================
# COMUNICACIONES - FastAPI Router
# Ruta: app/api/v1/comunicaciones.py
# ============================================

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter()

# ============================================
# MODELOS PYDANTIC
# ============================================

class MensajeIndividual(BaseModel):
    customer_id: int
    title: str
    body: str
    message_type: str = "general"

class MensajeMasivo(BaseModel):
    title: str
    body: str
    # with_app queda fuera: push_subscriptions es por usuario, no por
    # cliente, así que hoy no hay forma de saber qué CLIENTE tiene la app.
    target_audience: str = "all"  # all, with_debt
    message_type: str = "general"

# ============================================
# HELPERS
# ============================================

def _validar_cliente(db: Session, store_id: int, customer_id: int):
    """Un cliente de otra tienda no existe para quien pregunta: 404, no 403.

    Las funciones SQL ya filtran por store_id, así que sin esto un cliente
    ajeno devolvería lista vacía — indistinguible de 'no tiene nada'.
    """
    existe = db.execute(
        text("SELECT 1 FROM customers WHERE id = :c AND store_id = :s"),
        {"c": customer_id, "s": store_id}
    ).scalar()
    if not existe:
        raise HTTPException(404, "Cliente no encontrado")

# ============================================
# ENDPOINTS
# ============================================

@router.post("/comunicaciones/enviar-individual")
def enviar_mensaje_individual(
    mensaje: MensajeIndividual,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enviar mensaje a un cliente específico"""
    # Un cliente de otra tienda no existe para quien pregunta.
    _validar_cliente(db, current_user.store_id, mensaje.customer_id)

    try:
        query = text("""
            SELECT * FROM mensaje_enviar_individual(
                p_store_id := :store_id,
                p_created_by := :created_by,
                p_customer_id := :customer_id,
                p_title := :title,
                p_body := :body,
                p_message_type := :message_type
            )
        """)

        result = db.execute(
            query,
            {
                "store_id": current_user.store_id,
                "created_by": current_user.id,
                "customer_id": mensaje.customer_id,
                "title": mensaje.title,
                "body": mensaje.body,
                "message_type": mensaje.message_type
            }
        ).fetchone()
        db.commit()

        return dict(result._mapping)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/comunicaciones/enviar-masivo")
def enviar_mensaje_masivo(
    mensaje: MensajeMasivo,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enviar mensaje masivo a grupo de clientes"""
    try:
        query = text("""
            SELECT * FROM mensaje_enviar_masivo(
                p_store_id := :store_id,
                p_created_by := :created_by,
                p_title := :title,
                p_body := :body,
                p_target_audience := :target_audience,
                p_message_type := :message_type
            )
        """)

        result = db.execute(
            query,
            {
                "store_id": current_user.store_id,
                "created_by": current_user.id,
                "title": mensaje.title,
                "body": mensaje.body,
                "target_audience": mensaje.target_audience,
                "message_type": mensaje.message_type
            }
        ).fetchone()
        db.commit()

        return dict(result._mapping)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/comunicaciones/notificaciones/{customer_id}")
def obtener_notificaciones_cliente(
    customer_id: int,
    limit: int = 20,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Obtener notificaciones de un cliente"""
    _validar_cliente(db, current_user.store_id, customer_id)

    query = text("SELECT * FROM notificaciones_cliente(:store_id, :customer_id, :limit)")

    results = db.execute(
        query,
        {"store_id": current_user.store_id, "customer_id": customer_id, "limit": limit}
    ).fetchall()

    return [dict(row._mapping) for row in results]


@router.put("/comunicaciones/notificacion/{notification_id}/leer")
def marcar_notificacion_leida(
    notification_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Marcar notificación como leída"""
    query = text("SELECT notificacion_marcar_leida(:store_id, :notification_id)")

    # Devuelve FALSE si la notificación no existe o es de otra tienda:
    # en ambos casos, para quien pregunta, no existe.
    encontrada = db.execute(
        query,
        {"store_id": current_user.store_id, "notification_id": notification_id}
    ).scalar()
    db.commit()

    if not encontrada:
        raise HTTPException(404, "Notificación no encontrada")

    return {"success": True}


@router.get("/comunicaciones/estadisticas")
def obtener_estadisticas(
    days: int = 30,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Estadísticas de mensajes de la tienda"""
    query = text("SELECT * FROM mensajes_estadisticas(:store_id, :days)")
    
    result = db.execute(
        query,
        {"store_id": current_user.store_id, "days": days}
    ).fetchone()
    
    return dict(result._mapping)


@router.get("/comunicaciones/historial")
def obtener_historial(
    limit: int = 50,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Historial de mensajes enviados"""
    query = text("SELECT * FROM mensajes_historial(:store_id, :limit)")
    
    results = db.execute(
        query,
        {"store_id": current_user.store_id, "limit": limit}
    ).fetchall()
    
    return [dict(row._mapping) for row in results]


@router.get("/comunicaciones/resumen")
def obtener_resumen(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Resumen general de comunicaciones"""
    query = text("SELECT * FROM v_comunicaciones_resumen WHERE store_id = :store_id")
    
    result = db.execute(query, {"store_id": current_user.store_id}).fetchone()
    
    if not result:
        return {
            "total_mensajes": 0,
            "total_notificaciones": 0,
            "notificaciones_leidas": 0,
            "tasa_lectura": 0
        }
    
    return dict(result._mapping)


# ============================================
# PLANTILLAS PRE-DEFINIDAS
# ============================================

@router.get("/comunicaciones/plantillas")
async def obtener_plantillas():
    """Plantillas de mensajes predefinidas"""
    return [
        {
            "id": "recordatorio_pago",
            "nombre": "Recordatorio de pago",
            "tipo": "payment_reminder",
            "titulo": "Recordatorio de pago",
            "cuerpo": "Hola {nombre}, te recordamos que tienes una deuda pendiente de S/. {monto}. Por favor acércate a pagar. ¡Gracias!"
        },
        {
            "id": "promocion",
            "nombre": "Promoción",
            "tipo": "promotion",
            "titulo": "🎉 Promoción especial",
            "cuerpo": "¡Tenemos una promoción especial para ti! {descripcion}. Válido hasta {fecha}."
        },
        {
            "id": "nuevo_producto",
            "nombre": "Nuevo producto",
            "tipo": "new_product",
            "titulo": "Nuevo producto disponible",
            "cuerpo": "¡Tenemos {producto} disponible! Visítanos y pruébalo."
        },
        {
            "id": "saludo",
            "nombre": "Saludo",
            "tipo": "general",
            "titulo": "Saludos de {tienda}",
            "cuerpo": "Hola {nombre}, gracias por tu preferencia. ¡Te esperamos pronto!"
        }
    ]