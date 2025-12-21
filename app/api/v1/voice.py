# app/api/v1/voice.py
"""
Endpoints para procesamiento de voz con OpenAI Whisper
Usado por:
- Dashboard POS: micrófono PRO
- Mapa de delitos: chatbot por voz
"""

import os
import io
import time
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import httpx

from app.core.database import get_db
from app.core.auth import get_current_user, get_current_user_optional
from app.models.user import User


router = APIRouter(prefix="/voice", tags=["Voice"])


# Configuración de APIs
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"


class TranscriptionResponse(BaseModel):
    success: bool
    text: str
    language: str = "es"
    duration_ms: int
    api_used: str = "openai"


class VoiceParseRequest(BaseModel):
    transcript: str
    api: str = "openai"  # openai, claude, gemini
    session_id: Optional[str] = None


class ParsedProduct(BaseModel):
    name: str
    quantity: float
    product_id: Optional[int] = None
    price: Optional[float] = None
    unit: Optional[str] = None


class VoiceParseResponse(BaseModel):
    success: bool
    products: List[ParsedProduct]
    not_found: List[str]
    api_used: str
    latency_ms: int


# ============================================
# TRANSCRIPCIÓN CON WHISPER
# ============================================

@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("es"),
    current_user: User = Depends(get_current_user_optional)
):
    """
    Transcribe audio a texto usando OpenAI Whisper.
    Acepta: mp3, mp4, mpeg, mpga, m4a, wav, webm
    """
    start_time = time.time()
    
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="OpenAI API key no configurada. Contacta al administrador."
        )
    
    # Validar tipo de archivo
    allowed_types = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", 
                     "audio/mp4", "audio/m4a", "audio/ogg"]
    
    content_type = audio.content_type or ""
    if not any(t in content_type for t in ["audio", "video"]):
        # Intentar por extensión
        ext = audio.filename.split(".")[-1].lower() if audio.filename else ""
        if ext not in ["mp3", "wav", "webm", "m4a", "ogg", "mp4"]:
            raise HTTPException(
                status_code=400,
                detail=f"Tipo de archivo no soportado: {content_type}"
            )
    
    try:
        # Leer contenido del audio
        audio_content = await audio.read()
        
        # Preparar request a OpenAI
        files = {
            "file": (audio.filename or "audio.webm", io.BytesIO(audio_content), content_type or "audio/webm"),
            "model": (None, "whisper-1"),
            "language": (None, language),
            "response_format": (None, "json")
        }
        
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                OPENAI_WHISPER_URL,
                headers=headers,
                files=files
            )
        
        if response.status_code != 200:
            error_detail = response.text
            print(f"[Whisper] Error: {response.status_code} - {error_detail}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Error de OpenAI: {error_detail}"
            )
        
        result = response.json()
        text = result.get("text", "").strip()
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return TranscriptionResponse(
            success=True,
            text=text,
            language=language,
            duration_ms=duration_ms,
            api_used="openai"
        )
        
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout al procesar audio")
    except Exception as e:
        print(f"[Whisper] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# PARSEO DE VOZ A PRODUCTOS (CON LLM)
# ============================================

@router.post("/parse-llm", response_model=VoiceParseResponse)
async def parse_voice_with_llm(
    request: VoiceParseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parsea texto de voz a lista de productos usando LLM.
    1. Extrae productos y cantidades del texto
    2. Busca productos en la base de datos
    3. Devuelve lista de productos encontrados
    """
    start_time = time.time()
    
    transcript = request.transcript.strip()
    if not transcript:
        return VoiceParseResponse(
            success=False,
            products=[],
            not_found=[],
            api_used=request.api,
            latency_ms=0
        )
    
    # Usar LLM para extraer productos y cantidades
    parsed_items = await extract_products_with_llm(transcript, request.api)
    
    # Buscar productos en la base de datos
    found_products = []
    not_found = []
    
    for item in parsed_items:
        product = await find_product_in_db(
            db, 
            item["name"], 
            current_user.store_id
        )
        
        if product:
            found_products.append(ParsedProduct(
                name=product.name,
                quantity=item["quantity"],
                product_id=product.id,
                price=float(product.sale_price),
                unit=product.unit or "unidad"
            ))
        else:
            not_found.append(item["name"])
    
    duration_ms = int((time.time() - start_time) * 1000)
    
    return VoiceParseResponse(
        success=len(found_products) > 0,
        products=found_products,
        not_found=not_found,
        api_used=request.api,
        latency_ms=duration_ms
    )


async def extract_products_with_llm(transcript: str, api: str) -> list:
    """
    Usa LLM para extraer productos y cantidades del texto.
    Ejemplo: "dame 2 cocas, medio kilo de arroz y 3 panes"
    → [{"name": "coca cola", "quantity": 2}, {"name": "arroz", "quantity": 0.5}, {"name": "pan", "quantity": 3}]
    """
    
    # Por ahora, usamos un parser simple basado en reglas
    # TODO: Implementar llamada a OpenAI/Claude/Gemini
    
    import re
    
    items = []
    
    # Normalizar texto
    text = transcript.lower().strip()
    
    # Diccionario de cantidades
    quantities = {
        "un": 1, "una": 1, "uno": 1,
        "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
        "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
        "media": 0.5, "medio": 0.5,
        "cuarto": 0.25, "un cuarto": 0.25,
        "docena": 12
    }
    
    # Palabras a ignorar
    stop_words = ["dame", "quiero", "necesito", "por favor", "de", "del", "la", "el", "y", "con"]
    
    # Dividir por comas y "y"
    parts = re.split(r',|\s+y\s+', text)
    
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
        # Extraer cantidad
        quantity = 1
        product_name = part
        
        # Buscar número al inicio
        number_match = re.match(r'^(\d+(?:\.\d+)?)\s*(.+)', part)
        if number_match:
            quantity = float(number_match.group(1))
            product_name = number_match.group(2)
        else:
            # Buscar palabra de cantidad
            for word, qty in quantities.items():
                if part.startswith(word + " "):
                    quantity = qty
                    product_name = part[len(word):].strip()
                    break
        
        # Limpiar nombre del producto
        for sw in stop_words:
            product_name = re.sub(r'\b' + sw + r'\b', '', product_name)
        
        product_name = re.sub(r'\s+', ' ', product_name).strip()
        
        # Manejar unidades (kilo, litro, etc)
        if "kilo" in product_name:
            product_name = product_name.replace("kilo", "").replace("kilos", "").strip()
        if "litro" in product_name:
            product_name = product_name.replace("litro", "").replace("litros", "").strip()
        
        if product_name and len(product_name) >= 2:
            items.append({
                "name": product_name,
                "quantity": quantity
            })
    
    return items


async def find_product_in_db(db: Session, search_term: str, store_id: int):
    """
    Busca un producto en la base de datos por nombre.
    """
    from app.models.product import Product
    
    # Búsqueda exacta primero
    product = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True,
        Product.name.ilike(f"%{search_term}%")
    ).first()
    
    if product:
        return product
    
    # Búsqueda por palabras individuales
    words = search_term.split()
    if len(words) > 1:
        for word in words:
            if len(word) >= 3:
                product = db.query(Product).filter(
                    Product.store_id == store_id,
                    Product.is_active == True,
                    Product.name.ilike(f"%{word}%")
                ).first()
                if product:
                    return product
    
    return None


# ============================================
# CHATBOT - INTERPRETACIÓN NATURAL
# ============================================

class ChatbotRequest(BaseModel):
    message: str
    context: Optional[str] = None  # "mapa" o "pos"


class ChatbotResponse(BaseModel):
    reply: str
    action: Optional[str] = None  # Acción a ejecutar en el frontend
    action_params: Optional[dict] = None


@router.post("/chatbot", response_model=ChatbotResponse)
async def chatbot_query(
    request: ChatbotRequest,
    current_user: User = Depends(get_current_user_optional)
):
    """
    Procesa mensajes del chatbot y devuelve respuestas + acciones.
    """
    message = request.message.lower().strip()
    context = request.context or "general"
    
    # Respuestas para contexto MAPA
    if context == "mapa":
        return process_map_chatbot(message)
    
    # Respuestas para contexto POS
    elif context == "pos":
        return process_pos_chatbot(message)
    
    # General
    return ChatbotResponse(
        reply="¿En qué puedo ayudarte? Puedo buscar zonas, mostrar estadísticas o filtrar incidentes.",
        action=None
    )


def process_map_chatbot(message: str) -> ChatbotResponse:
    """
    Procesa mensajes del chatbot del mapa de delitos.
    """
    
    # Zonas peligrosas
    if any(w in message for w in ["peligros", "peligrosa", "más incidentes", "zona roja"]):
        return ChatbotResponse(
            reply="🔴 Activando vista de calor para mostrar las zonas con más incidentes...",
            action="setView",
            action_params={"view": "heatmap", "filter_level": "ROJO"}
        )
    
    # Extorsiones
    if "extorsion" in message or "amenaza" in message:
        return ChatbotResponse(
            reply="🟠 Filtrando solo casos de extorsión...",
            action="filter",
            action_params={"type": "extorsion", "level": "AMBAR"}
        )
    
    # Estadísticas
    if any(w in message for w in ["estadística", "cuantos", "número", "total"]):
        return ChatbotResponse(
            reply="📊 Mostrando estadísticas del período seleccionado...",
            action="showStats",
            action_params={}
        )
    
    # Distritos específicos
    distritos = {
        "sjl": "San Juan de Lurigancho",
        "san juan de lurigancho": "San Juan de Lurigancho",
        "comas": "Comas",
        "villa el salvador": "Villa El Salvador",
        "los olivos": "Los Olivos",
        "ate": "Ate",
        "chorrillos": "Chorrillos",
        "san martín": "San Martín de Porres"
    }
    
    for key, distrito in distritos.items():
        if key in message:
            return ChatbotResponse(
                reply=f"📍 Enfocando en {distrito}...",
                action="focusDistrict",
                action_params={"distrito": distrito}
            )
    
    # Limpiar filtros
    if any(w in message for w in ["limpiar", "reset", "quitar filtro"]):
        return ChatbotResponse(
            reply="🔄 Limpiando todos los filtros...",
            action="clearFilters",
            action_params={}
        )
    
    # Ayuda
    if any(w in message for w in ["ayuda", "qué puedes", "cómo funciona"]):
        return ChatbotResponse(
            reply="🤖 Puedo ayudarte con:\n• \"Zonas más peligrosas\" - Activa heatmap\n• \"Extorsiones en [distrito]\" - Filtra por tipo y zona\n• \"Estadísticas\" - Muestra números\n• \"Limpiar filtros\" - Resetea todo",
            action=None
        )
    
    # No entendido
    return ChatbotResponse(
        reply="🤔 No entendí tu consulta. Prueba con: \"zonas peligrosas\", \"extorsiones en Comas\", o \"estadísticas\".",
        action=None
    )


def process_pos_chatbot(message: str) -> ChatbotResponse:
    """
    Procesa mensajes del chatbot del POS (futuro).
    """
    return ChatbotResponse(
        reply="El asistente del POS está en desarrollo. Por ahora usa el micrófono para agregar productos.",
        action=None
    )