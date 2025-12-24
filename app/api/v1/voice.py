# app/api/v1/voice.py
"""
Endpoints para sistema de voz:
- TTS (Text-to-Speech) con Google Cloud
- STT (Speech-to-Text) con OpenAI Whisper
- Chatbot para mapa de delitos
"""
import os
import io
import time
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

# Imports de tu proyecto
from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
import openai

from dotenv import load_dotenv
load_dotenv()

# Forzar recarga del .env (override=True ignora variables de sistema)
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), '.env')
load_dotenv(env_path, override=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Importar settings para obtener OPENAI_API_KEY
try:
    from app.core.config import settings
    #openai.api_key = os.getenv("OPENAI_API_KEY")
    #OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if OPENAI_API_KEY:
        print(f"[Voice] ✅ OPENAI_API_KEY cargada: {OPENAI_API_KEY[:8]}...{OPENAI_API_KEY[-4:]}")
    else:
        print("[Voice] ⚠️ OPENAI_API_KEY no configurada en settings")
except ImportError:
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if OPENAI_API_KEY:
        print(f"[Voice] ✅ OPENAI_API_KEY desde env: {OPENAI_API_KEY[:8]}...{OPENAI_API_KEY[-4:]}")
    else:
        print("[Voice] ⚠️ OPENAI_API_KEY no encontrada")

# TTS Service (tu servicio existente)
try:
    from app.services.tts_service import tts_service
except ImportError:
    tts_service = None
    print("[Voice] AVISO: tts_service no disponible")

# httpx para llamadas a OpenAI
try:
    import httpx
except ImportError:
    httpx = None
    print("[Voice] AVISO: Instalar httpx con: pip install httpx")


router = APIRouter(prefix="/voice", tags=["voice"])


# URL de OpenAI Whisper
OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"


# ============================================
# MODELOS PYDANTIC
# ============================================

class TTSRequest(BaseModel):
    """Request para text-to-speech"""
    text: str
    voice: Optional[str] = None
    speed: float = 1.0


class TranscriptionResponse(BaseModel):
    success: bool
    text: str
    language: str = "es"
    duration_ms: int
    api_used: str = "openai"


class VoiceParseRequest(BaseModel):
    transcript: str
    api: str = "openai"
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


class ChatbotRequest(BaseModel):
    message: str
    context: Optional[str] = None


class ChatbotResponse(BaseModel):
    reply: str
    action: Optional[str] = None
    action_params: Optional[dict] = None


# ============================================
# ENDPOINTS TTS (TU CÓDIGO EXISTENTE)
# ============================================

@router.post("/speak")
async def text_to_speech(
    request: TTSRequest,
    current_user: User = Depends(get_current_user)
):
    """Convertir texto a voz"""
    if not tts_service:
        raise HTTPException(status_code=500, detail="TTS service no disponible")
    
    result = tts_service.synthesize_speech(
        text=request.text,
        voice_name=request.voice,
        speed=request.speed
    )
    return result


@router.get("/voices")
async def get_voices(current_user: User = Depends(get_current_user)):
    """Obtener voces disponibles"""
    if not tts_service:
        return {"voices": []}
    
    voices = tts_service.get_available_voices()
    return {"voices": voices}


@router.get("/settings")
async def get_voice_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener configuración de voz del usuario"""
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
    """Guardar configuración de voz"""
    return {"success": True, "settings": settings}


# ============================================
# ENDPOINTS WHISPER (NUEVOS)
# ============================================

@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("es")
):
    """
    Transcribe audio a texto usando OpenAI Whisper.
    Acepta: mp3, mp4, mpeg, mpga, m4a, wav, webm
    
    NO requiere autenticación para permitir uso desde chatbot público.
    """
    start_time = time.time()
    
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="OpenAI API key no configurada. Agregar OPENAI_API_KEY en .env"
        )
    
    if not httpx:
        raise HTTPException(
            status_code=500,
            detail="Librería httpx no instalada. Ejecutar: pip install httpx"
        )
    
    # Validar tipo de archivo
    filename = audio.filename or "audio.webm"
    ext = filename.split(".")[-1].lower()
    
    valid_extensions = ["mp3", "wav", "webm", "m4a", "ogg", "mp4", "mpeg", "mpga"]
    content_type = audio.content_type or ""
    
    if ext not in valid_extensions and "audio" not in content_type:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no soportado. Usar: {', '.join(valid_extensions)}"
        )
    
    try:
        audio_content = await audio.read()
        
        # Determinar mime type
        mime_types = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav", 
            "webm": "audio/webm",
            "m4a": "audio/m4a",
            "ogg": "audio/ogg",
            "mp4": "audio/mp4"
        }
        mime_type = mime_types.get(ext, content_type or "audio/webm")
        
        files = {
            "file": (filename, io.BytesIO(audio_content), mime_type),
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
            print(f"[Whisper] Error {response.status_code}: {error_detail}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Error de OpenAI Whisper: {error_detail[:200]}"
            )
        
        result = response.json()
        text = result.get("text", "").strip()
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return TranscriptionResponse(
            success=True,
            text=text,
            language=language,
            duration_ms=duration_ms,
            api_used="openai-whisper"
        )
        
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout al procesar audio con Whisper")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Whisper] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse-products", response_model=VoiceParseResponse)
async def parse_voice_to_products(
    request: VoiceParseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parsea texto de voz a lista de productos.
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
    
    # Usar parser local para extraer productos y cantidades
    parsed_items = extract_products_local(transcript)
    
    # Buscar productos en la base de datos
    found_products = []
    not_found = []
    
    for item in parsed_items:
        product = find_product_in_db(db, item["name"], current_user.store_id)
        
        if product:
            found_products.append(ParsedProduct(
                name=product.name,
                quantity=item["quantity"],
                product_id=product.id,
                price=float(product.sale_price) if hasattr(product, 'sale_price') and product.sale_price else 0,
                unit=getattr(product, 'unit', 'unidad') or 'unidad'
            ))
        else:
            not_found.append(item["name"])
    
    duration_ms = int((time.time() - start_time) * 1000)
    
    return VoiceParseResponse(
        success=len(found_products) > 0,
        products=found_products,
        not_found=not_found,
        api_used="local-parser",
        latency_ms=duration_ms
    )


def extract_products_local(transcript: str) -> list:
    """
    Parser local para extraer productos y cantidades del texto.
    Ejemplo: "dame 2 cocas, medio kilo de arroz y 3 panes"
    """
    items = []
    text = transcript.lower().strip()
    
    # Diccionario de cantidades en español
    quantities = {
        "un": 1, "una": 1, "uno": 1,
        "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
        "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
        "media": 0.5, "medio": 0.5,
        "cuarto": 0.25, "un cuarto": 0.25,
        "docena": 12, "decena": 10
    }
    
    stop_words = ["dame", "quiero", "necesito", "por favor", "de", "del", 
                  "la", "el", "y", "con", "me", "das", "ponme", "agrega"]
    
    # Dividir por comas y "y"
    parts = re.split(r',|\s+y\s+', text)
    
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
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
        
        # Limpiar nombre
        for sw in stop_words:
            product_name = re.sub(r'\b' + sw + r'\b', '', product_name)
        
        product_name = re.sub(r'\s+', ' ', product_name).strip()
        
        # Manejar unidades
        for unit in ["kilo", "kilos", "litro", "litros", "gramo", "gramos"]:
            product_name = product_name.replace(unit, "").strip()
        
        if product_name and len(product_name) >= 2:
            items.append({
                "name": product_name,
                "quantity": quantity
            })
    
    return items


def find_product_in_db(db: Session, search_term: str, store_id: Optional[int] = None):
    """Busca un producto en la base de datos."""
    try:
        from app.models.product import Product
    except ImportError:
        print("[Voice] No se pudo importar modelo Product")
        return None
    
    query = db.query(Product).filter(
        Product.is_active == True,
        Product.name.ilike(f"%{search_term}%")
    )
    
    if store_id:
        query = query.filter(Product.store_id == store_id)
    
    product = query.first()
    
    if product:
        return product
    
    # Búsqueda por palabras individuales
    words = search_term.split()
    if len(words) > 1:
        for word in words:
            if len(word) >= 3:
                query = db.query(Product).filter(
                    Product.is_active == True,
                    Product.name.ilike(f"%{word}%")
                )
                if store_id:
                    query = query.filter(Product.store_id == store_id)
                product = query.first()
                if product:
                    return product
    
    return None


# ============================================
# CHATBOT PARA MAPA DE DELITOS
# ============================================

@router.post("/chatbot", response_model=ChatbotResponse)
async def chatbot_query(request: ChatbotRequest):
    """
    Procesa mensajes del chatbot y devuelve respuestas + acciones.
    NO requiere autenticación para uso público en el mapa.
    """
    message = request.message.lower().strip()
    context = request.context or "general"
    
    if context == "mapa":
        return process_map_chatbot(message)
    elif context == "pos":
        return process_pos_chatbot(message)
    
    return ChatbotResponse(
        reply="¿En qué puedo ayudarte?",
        action=None
    )


def process_map_chatbot(message: str) -> ChatbotResponse:
    """Procesa mensajes del chatbot del mapa de delitos."""
    
    # Zonas peligrosas
    if any(w in message for w in ["peligros", "peligrosa", "más incidentes", "zona roja", "alto riesgo"]):
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
    if any(w in message for w in ["estadística", "cuantos", "número", "total", "resumen"]):
        return ChatbotResponse(
            reply="📊 Mostrando estadísticas del período seleccionado...",
            action="showStats",
            action_params={}
        )
    
    # Distritos de Lima
    distritos = {
        "sjl": "San Juan de Lurigancho",
        "san juan de lurigancho": "San Juan de Lurigancho",
        "comas": "Comas",
        "villa el salvador": "Villa El Salvador",
        "los olivos": "Los Olivos",
        "ate": "Ate",
        "chorrillos": "Chorrillos",
        "san martín": "San Martín de Porres",
        "san isidro": "San Isidro",
        "miraflores": "Miraflores",
        "la victoria": "La Victoria",
        "surco": "Santiago de Surco",
        "callao": "Callao",
        "ventanilla": "Ventanilla",
        "independencia": "Independencia",
        "el agustino": "El Agustino",
        "rimac": "Rímac",
        "breña": "Breña"
    }
    
    for key, distrito in distritos.items():
        if key in message:
            return ChatbotResponse(
                reply=f"📍 Enfocando en {distrito}...",
                action="focusDistrict",
                action_params={"distrito": distrito}
            )
    
    # Limpiar filtros
    if any(w in message for w in ["limpiar", "reset", "quitar filtro", "borrar"]):
        return ChatbotResponse(
            reply="🔄 Limpiando todos los filtros...",
            action="clearFilters",
            action_params={}
        )
    
    # Ayuda
    if any(w in message for w in ["ayuda", "qué puedes", "cómo funciona", "help"]):
        return ChatbotResponse(
            reply="🤖 Puedo ayudarte con:\n• \"Zonas peligrosas\" - Activa heatmap\n• \"Extorsiones en [distrito]\" - Filtra\n• \"Estadísticas\" - Muestra números\n• \"Limpiar filtros\" - Resetea todo",
            action=None
        )
    
    return ChatbotResponse(
        reply="🤔 No entendí. Prueba: \"zonas peligrosas\", \"extorsiones en Comas\", o \"estadísticas\".",
        action=None
    )


def process_pos_chatbot(message: str) -> ChatbotResponse:
    """Procesa mensajes del chatbot del POS (futuro)."""
    return ChatbotResponse(
        reply="El asistente del POS está en desarrollo. Usa el micrófono para agregar productos.",
        action=None
    )