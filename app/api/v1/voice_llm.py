"""
Voice LLM Parser - Parseo de comandos de voz con LLM
Soporta: Claude, OpenAI, Gemini
Incluye:
- Métricas de tiempo detalladas
- Correcciones para marcas peruanas
- Soporte para variantes de productos
- Matching mejorado (evita falsos positivos)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel
from typing import List, Literal, Optional
import time
import re

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.voice_log import VoiceCommandLog
from app.services.llm_service import LLMService

router = APIRouter(prefix="/voice", tags=["voice-llm"])

# ============================================
# CORRECCIONES PARA MARCAS PERUANAS
# ============================================
CORRECCIONES_TRANSCRIPT = {
    # Bebidas
    "hinca cola": "inca kola",
    "inka cola": "inca kola",
    "inca cola": "inca kola",
    "incacola": "inca kola",
    "hinca kola": "inca kola",
    "coca cola": "coca cola",
    "cocacola": "coca cola",
    "spore": "sporade",
    "esporade": "sporade",
    "sport": "sporade",
    "gatore": "gatorade",
    "gatorate": "gatorade",
    "pilsen": "pilsen",
    "pilsner": "pilsen",
    "cusquenia": "cusqueña",
    "cusquenya": "cusqueña",
    "cristal": "cristal",
    "frugos": "frugos",
    "cifrut": "cifrut",
    
    # Lácteos
    "gloría": "gloria",
    "laive": "laive",
    "layve": "laive",
    "pura vida": "pura vida",
    "puravida": "pura vida",
    
    # Golosinas
    "sublime": "sublime",
    "sublima": "sublime",
    "triángulo": "triangulo",
    "triangulo": "triangulo",
    "cua cua": "cuacua",
    "cuacuá": "cuacua",
    "field": "field",
    "fill": "field",
    "rellenita": "rellenita",
    "morocha": "morochas",
    
    # Snacks
    "lays": "lays",
    "leis": "lays",
    "doritos": "doritos",
    "cheetos": "cheetos",
    "chitos": "cheetos",
    "piqueos": "piqueo",
    "piqueo snax": "piqueo snax",
    
    # Limpieza
    "ace": "ace",
    "ase": "ace",
    "bolívar": "bolivar",
    "bolivar": "bolivar",
    "sapolio": "sapolio",
    "clorox": "clorox",
    "poett": "poett",
    "poet": "poett",
    
    # Genéricos - singular
    "galletas": "galleta",
    "huevos": "huevo",
    "panes": "pan",
    "fideos": "fideo",
}

# Palabras que NO deben hacer match parcial (evita "pan" → "Aji Panca")
PALABRAS_CORTAS_EXACTAS = ["pan", "sal", "te", "ron", "ace", "gas", "luz"]


def corregir_transcript(texto: str) -> str:
    """Corrige errores comunes de transcripción para marcas peruanas"""
    texto_lower = texto.lower()
    
    for incorrecto, correcto in CORRECCIONES_TRANSCRIPT.items():
        texto_lower = texto_lower.replace(incorrecto, correcto)
    
    return texto_lower


def calcular_score_match(nombre_producto: str, termino_busqueda: str) -> float:
    """
    Calcula un score de relevancia para el match
    1.0 = match exacto
    0.9 = empieza con el término
    0.8 = palabra completa dentro del nombre
    0.5 = contiene el término (parcial)
    0.0 = no match
    """
    nombre_lower = nombre_producto.lower()
    termino_lower = termino_busqueda.lower().strip()
    
    # Match exacto del nombre completo
    if nombre_lower == termino_lower:
        return 1.0
    
    # El nombre empieza con el término
    if nombre_lower.startswith(termino_lower + " ") or nombre_lower == termino_lower:
        return 0.95
    
    # Primera palabra del nombre coincide exactamente
    primera_palabra = nombre_lower.split()[0] if nombre_lower.split() else ""
    if primera_palabra == termino_lower:
        return 0.9
    
    # Es una palabra completa dentro del nombre
    palabras = nombre_lower.split()
    if termino_lower in palabras:
        return 0.8
    
    # Para palabras cortas (<=3 chars), solo aceptar match de palabra completa
    if termino_lower in PALABRAS_CORTAS_EXACTAS or len(termino_lower) <= 3:
        # Buscar como palabra completa con regex
        pattern = r'\b' + re.escape(termino_lower) + r'\b'
        if re.search(pattern, nombre_lower):
            return 0.7
        else:
            return 0.0  # NO aceptar match parcial
    
    # Contiene el término (solo para términos de 4+ caracteres)
    if len(termino_lower) >= 4 and termino_lower in nombre_lower:
        return 0.5
    
    return 0.0


# ============================================
# MODELOS PYDANTIC
# ============================================

class VoiceParseRequest(BaseModel):
    transcript: str
    api: Literal["claude", "openai", "gemini"] = "openai"
    session_id: str | None = None


class ProductOption(BaseModel):
    """Una opción de producto (para variantes)"""
    product_id: int
    name: str
    price: float
    unit: str
    stock: Optional[float] = None
    score: float = 0.0


class ProductMatch(BaseModel):
    """Producto encontrado (puede tener variantes)"""
    search_term: str
    quantity: float
    unit_requested: Optional[str] = None
    
    # Si hay match único
    product_id: Optional[int] = None
    name: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    
    # Si hay variantes
    has_variants: bool = False
    variants: List[ProductOption] = []
    

class TimingMetrics(BaseModel):
    """Métricas de tiempo detalladas"""
    total_ms: int
    transcription_ms: int = 0
    llm_ms: int
    db_search_ms: int
    preprocessing_ms: int


class VoiceParseResponse(BaseModel):
    success: bool
    products: List[ProductMatch]
    products_with_variants: List[ProductMatch]
    not_found: List[str]
    api_used: str
    latency_ms: int
    timing: Optional[TimingMetrics] = None
    cost_usd: float
    transcript_corregido: Optional[str] = None


# ============================================
# ENDPOINT PRINCIPAL
# ============================================

@router.post("/parse-llm", response_model=VoiceParseResponse)
async def parse_voice_with_llm(
    request: VoiceParseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parsear comando de voz usando LLM
    Soporta múltiples productos en un solo comando
    Devuelve variantes cuando hay múltiples coincidencias
    """
    
    total_start = time.time()
    
    # ========================================
    # 1. PRE-PROCESAMIENTO
    # ========================================
    preprocess_start = time.time()
    
    transcript_original = request.transcript
    transcript_corregido = corregir_transcript(transcript_original)
    
    preprocess_ms = int((time.time() - preprocess_start) * 1000)
    
    print(f"\n[Voice LLM] ═══════════════════════════════════════════")
    print(f"[Voice LLM] Transcript original: '{transcript_original}'")
    if transcript_corregido != transcript_original.lower():
        print(f"[Voice LLM] Transcript corregido: '{transcript_corregido}'")
    print(f"[Voice LLM] API: {request.api}")
    
    # ========================================
    # 2. LLAMADA AL LLM
    # ========================================
    llm_start = time.time()
    
    try:
        if request.api == "claude":
            parsed_result, llm_latency, cost = await LLMService.parse_with_claude(transcript_corregido)
        elif request.api == "openai":
            parsed_result, llm_latency, cost = await LLMService.parse_with_openai(transcript_corregido)
        else:
            parsed_result, llm_latency, cost = await LLMService.parse_with_gemini(transcript_corregido)
        
        llm_ms = int((time.time() - llm_start) * 1000)
        print(f"[Voice LLM] LLM Response: {llm_ms}ms")
        
    except Exception as e:
        print(f"[Voice LLM] ❌ Error en LLM: {str(e)}")
        raise HTTPException(500, detail=f"Error en API {request.api}: {str(e)}")
    
    # ========================================
    # 3. EXTRAER LISTA DE ITEMS
    # ========================================
    if isinstance(parsed_result, dict):
        items_list = (
            parsed_result.get('productos') or 
            parsed_result.get('products') or 
            parsed_result.get('items') or 
            []
        )
    elif isinstance(parsed_result, list):
        items_list = parsed_result
    else:
        items_list = []
    
    print(f"[Voice LLM] Items a procesar: {len(items_list)}")
    
    # ========================================
    # 4. BUSCAR PRODUCTOS EN BD
    # ========================================
    db_start = time.time()
    
    matched_products = []
    products_with_variants = []
    not_found = []
    
    for item in items_list:
        # Extraer datos del item
        if isinstance(item, str):
            search_term = item.lower().strip()
            cantidad = 1.0
            unidad = None
        elif isinstance(item, dict):
            search_term = str(item.get("nombre", item.get("name", ""))).lower().strip()
            cantidad = item.get("cantidad", item.get("quantity", 1.0)) or 1.0
            unidad = item.get("unidad", item.get("unit"))
        else:
            continue
        
        if not search_term or len(search_term) < 2:
            continue
        
        # ----------------------------------------
        # Buscar candidatos en BD
        # ----------------------------------------
        # Para palabras cortas, buscar solo coincidencias de palabra completa
        if search_term in PALABRAS_CORTAS_EXACTAS or len(search_term) <= 3:
            # Búsqueda estricta: el nombre debe empezar con el término
            # o contener el término como palabra completa
            candidates = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                or_(
                    Product.name.ilike(f"{search_term} %"),  # Empieza con "pan "
                    Product.name.ilike(f"% {search_term} %"),  # Contiene " pan "
                    Product.name.ilike(f"% {search_term}"),  # Termina con " pan"
                    func.lower(Product.name) == search_term  # Es exactamente "pan"
                )
            ).limit(10).all()
        else:
            # Búsqueda más amplia para términos largos
            candidates = db.query(Product).filter(
                Product.store_id == current_user.store_id,
                Product.is_active == True,
                Product.name.ilike(f"%{search_term}%")
            ).limit(15).all()
        
        # ----------------------------------------
        # Calcular scores y filtrar
        # ----------------------------------------
        scored_candidates = []
        for product in candidates:
            score = calcular_score_match(product.name, search_term)
            if score > 0:
                scored_candidates.append({
                    'product': product,
                    'score': score
                })
        
        # Ordenar por score descendente
        scored_candidates.sort(key=lambda x: (-x['score'], x['product'].name))
        
        # ----------------------------------------
        # Decidir: match único, variantes, o no encontrado
        # ----------------------------------------
        if len(scored_candidates) == 0:
            not_found.append(search_term)
            print(f"[Voice LLM] ❌ No encontrado: '{search_term}'")
            
        elif len(scored_candidates) == 1:
            # Un solo resultado → match único
            best = scored_candidates[0]['product']
            matched_products.append(ProductMatch(
                search_term=search_term,
                quantity=float(cantidad),
                unit_requested=unidad,
                product_id=best.id,
                name=best.name,
                price=float(best.sale_price),
                unit=getattr(best, 'unit', 'unidad'),
                has_variants=False,
                variants=[]
            ))
            print(f"[Voice LLM] ✅ Match único: '{search_term}' → {best.name} x{cantidad}")
            
        elif scored_candidates[0]['score'] >= 0.9:
            # Score muy alto → confiar en el mejor match
            best = scored_candidates[0]['product']
            matched_products.append(ProductMatch(
                search_term=search_term,
                quantity=float(cantidad),
                unit_requested=unidad,
                product_id=best.id,
                name=best.name,
                price=float(best.sale_price),
                unit=getattr(best, 'unit', 'unidad'),
                has_variants=False,
                variants=[]
            ))
            print(f"[Voice LLM] ✅ Match confiable (score={scored_candidates[0]['score']:.2f}): '{search_term}' → {best.name}")
            
        else:
            # Múltiples variantes → el usuario debe elegir
            variants = [
                ProductOption(
                    product_id=c['product'].id,
                    name=c['product'].name,
                    price=float(c['product'].sale_price),
                    unit=getattr(c['product'], 'unit', 'unidad'),
                    stock=float(c['product'].stock) if hasattr(c['product'], 'stock') and c['product'].stock else None,
                    score=round(c['score'], 2)
                )
                for c in scored_candidates[:6]
            ]
            
            products_with_variants.append(ProductMatch(
                search_term=search_term,
                quantity=float(cantidad),
                unit_requested=unidad,
                has_variants=True,
                variants=variants
            ))
            print(f"[Voice LLM] 🔀 Variantes para '{search_term}': {[v.name for v in variants]}")
    
    db_ms = int((time.time() - db_start) * 1000)
    
    # ========================================
    # 5. MÉTRICAS
    # ========================================
    total_ms = int((time.time() - total_start) * 1000)
    
    timing = TimingMetrics(
        total_ms=total_ms,
        llm_ms=llm_ms,
        db_search_ms=db_ms,
        preprocessing_ms=preprocess_ms
    )
    
    print(f"[Voice LLM] ───────────────────────────────────────────")
    print(f"[Voice LLM] 📊 MÉTRICAS DE TIEMPO:")
    print(f"[Voice LLM]    • Preprocesamiento: {preprocess_ms}ms")
    print(f"[Voice LLM]    • LLM ({request.api}): {llm_ms}ms")
    print(f"[Voice LLM]    • Búsqueda BD: {db_ms}ms")
    print(f"[Voice LLM]    • TOTAL: {total_ms}ms")
    print(f"[Voice LLM] 📦 Resultados:")
    print(f"[Voice LLM]    • Match único: {len(matched_products)}")
    print(f"[Voice LLM]    • Con variantes: {len(products_with_variants)}")
    print(f"[Voice LLM]    • No encontrados: {len(not_found)}")
    print(f"[Voice LLM] ═══════════════════════════════════════════\n")
    
    # ========================================
    # 6. LOG EN BD
    # ========================================
    try:
        log_entry = VoiceCommandLog(
            store_id=current_user.store_id,
            user_id=current_user.id,
            transcript=transcript_original,
            api_used=request.api,
            parsed_result=parsed_result if isinstance(parsed_result, dict) else {"items": parsed_result},
            products_found=len(matched_products) + len(products_with_variants),
            products_added=len(matched_products),
            success=len(matched_products) > 0 or len(products_with_variants) > 0,
            latency_ms=total_ms,
            cost_usd=cost,
            session_id=request.session_id
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        print(f"[Voice LLM] ⚠️ Error guardando log: {e}")
    
    # ========================================
    # 7. RESPUESTA
    # ========================================
    return VoiceParseResponse(
        success=len(matched_products) > 0 or len(products_with_variants) > 0,
        products=matched_products,
        products_with_variants=products_with_variants,
        not_found=not_found,
        api_used=request.api,
        latency_ms=total_ms,
        timing=timing,
        cost_usd=cost,
        transcript_corregido=transcript_corregido if transcript_corregido != transcript_original.lower() else None
    )