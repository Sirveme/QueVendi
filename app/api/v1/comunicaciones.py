# ============================================
# COMUNICACIONES - FastAPI Router
# Ruta: app/api/v1/comunicaciones.py
# ============================================

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
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
    target_audience: str = "all"  # all, with_debt, with_app
    message_type: str = "general"

# ============================================
# ENDPOINTS
# ============================================

@router.post("/comunicaciones/enviar-individual")
async def enviar_mensaje_individual(
    mensaje: MensajeIndividual,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Enviar mensaje a un cliente específico"""
    try:
        query = """
            SELECT * FROM mensaje_enviar_individual(
                p_store_id := :store_id,
                p_customer_id := :customer_id,
                p_title := :title,
                p_body := :body,
                p_message_type := :message_type
            )
        """
        
        result = await db.fetch_one(
            query,
            {
                "store_id": current_user["store_id"],
                "customer_id": mensaje.customer_id,
                "title": mensaje.title,
                "body": mensaje.body,
                "message_type": mensaje.message_type
            }
        )
        
        return dict(result)
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/comunicaciones/enviar-masivo")
async def enviar_mensaje_masivo(
    mensaje: MensajeMasivo,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Enviar mensaje masivo a grupo de clientes"""
    try:
        query = """
            SELECT * FROM mensaje_enviar_masivo(
                p_store_id := :store_id,
                p_title := :title,
                p_body := :body,
                p_target_audience := :target_audience,
                p_message_type := :message_type
            )
        """
        
        result = await db.fetch_one(
            query,
            {
                "store_id": current_user["store_id"],
                "title": mensaje.title,
                "body": mensaje.body,
                "target_audience": mensaje.target_audience,
                "message_type": mensaje.message_type
            }
        )
        
        return dict(result)
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/comunicaciones/notificaciones/{customer_id}")
async def obtener_notificaciones_cliente(
    customer_id: int,
    limit: int = 20,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Obtener notificaciones de un cliente"""
    query = "SELECT * FROM notificaciones_cliente(:customer_id, :limit)"
    
    results = await db.fetch_all(
        query,
        {"customer_id": customer_id, "limit": limit}
    )
    
    return [dict(row) for row in results]


@router.put("/comunicaciones/notificacion/{notification_id}/leer")
async def marcar_notificacion_leida(
    notification_id: int,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Marcar notificación como leída"""
    query = "SELECT notificacion_marcar_leida(:notification_id)"
    
    await db.execute(query, {"notification_id": notification_id})
    
    return {"success": True}


@router.get("/comunicaciones/estadisticas")
async def obtener_estadisticas(
    days: int = 30,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Estadísticas de mensajes de la tienda"""
    query = "SELECT * FROM mensajes_estadisticas(:store_id, :days)"
    
    result = await db.fetch_one(
        query,
        {"store_id": current_user["store_id"], "days": days}
    )
    
    return dict(result)


@router.get("/comunicaciones/historial")
async def obtener_historial(
    limit: int = 50,
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Historial de mensajes enviados"""
    query = "SELECT * FROM mensajes_historial(:store_id, :limit)"
    
    results = await db.fetch_all(
        query,
        {"store_id": current_user["store_id"], "limit": limit}
    )
    
    return [dict(row) for row in results]


@router.get("/comunicaciones/resumen")
async def obtener_resumen(
    current_user = Depends(get_current_user),
    db = Depends(get_db)
):
    """Resumen general de comunicaciones"""
    query = "SELECT * FROM v_comunicaciones_resumen WHERE store_id = :store_id"
    
    result = await db.fetch_one(query, {"store_id": current_user["store_id"]})
    
    if not result:
        return {
            "total_mensajes": 0,
            "total_notificaciones": 0,
            "notificaciones_leidas": 0,
            "tasa_lectura": 0
        }
    
    return dict(result)


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
            "tipo": "credit_reminder",
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