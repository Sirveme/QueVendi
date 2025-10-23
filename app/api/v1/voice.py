"""
Endpoints específicos para sistema de voz
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.tts_service import tts_service
from app.api.dependencies import get_current_user
from app.models.user import User
from pydantic import BaseModel
from typing import Optional

#router = APIRouter(prefix="/voice", tags=["voice"])
router = APIRouter()

class TTSRequest(BaseModel):
    """Request para text-to-speech"""
    text: str
    voice: Optional[str] = None
    speed: float = 1.0

@router.post("/speak")
async def text_to_speech(
    request: TTSRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Convertir texto a voz
    """
    result = tts_service.synthesize_speech(
        text=request.text,
        voice_name=request.voice,
        speed=request.speed
    )
    return result

@router.get("/voices")
async def get_voices(current_user: User = Depends(get_current_user)):
    """Obtener voces disponibles"""
    voices = tts_service.get_available_voices()
    return {"voices": voices}

@router.get("/settings")
async def get_voice_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Obtener configuración de voz del usuario
    TODO: Guardar en BD preferencias de usuario
    """
    return {
        "voice": "es-PE-Standard-A",
        "speed": 1.0,
        "volume": 0.8,
        "enabled": True
    }

@router.post("/settings")
async def save_voice_settings(
    settings: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Guardar configuración de voz
    TODO: Implementar guardado en BD
    """
    return {"success": True, "settings": settings}