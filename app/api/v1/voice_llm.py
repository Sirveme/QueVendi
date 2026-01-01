"""
Voice LLM Parser - Parseo de comandos de voz con LLM
Soporta: Claude, OpenAI, Gemini
CORREGIDO: Lógica de búsqueda unificada con VoiceService
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel
from typing import List, Literal, Optional
import time
import re
import unicodedata
from difflib import SequenceMatcher

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.voice_log import VoiceCommandLog
from app.services.llm_service import LLMService

router = APIRouter(prefix="/voice")

# ============================================
# PALABRAS CORTAS QUE REQUIEREN MATCH EXACTO
# ============================================
PALABRAS_CORTAS_EXACTAS = [
    "pan", "sal", "te", "ron", "ace", "gas", "luz", "aji", "col"
]

# ============================================
# CORRECCIONES PARA MARCAS PERUANAS
# ============================================
CORRECCIONES_TRANSCRIPT = {
    # Bebidas
    "coca cola": "coca-cola",
    "coca-cola": "coca cola",
    "cocacola": "coca cola",
    "hinca cola": "inca kola",
    "inka cola": "inca kola",
    "inca cola": "inca kola",
    "hinca cola": "inca kola", "inka cola": "inca kola", "inca cola": "inca kola",
    "incacola": "inca kola", "hinca kola": "inca kola",
    "coca cola": "coca cola", "cocacola": "coca cola",
    "spore": "sporade", "esporade": "sporade", "sport": "sporade",
    "gatore": "gatorade", "gatorate": "gatorade",
    "pilsen": "pilsen", "pilsner": "pilsen",
    "cusquenia": "cusqueña", "cusquenya": "cusqueña",
    "cristal": "cristal", "frugos": "frugos", "cifrut": "cifrut",
    
    # Panadería
    "pang": "pan",
    "pan!": "pan",
    "pán": "pan",

    # Lácteos
    "gloría": "gloria", "laive": "laive", "layve": "laive",
    "pura vida": "pura vida", "puravida": "pura vida",
    
    # Golosinas
    "sublime": "sublime", "sublima": "sublime",
    "triángulo": "triangulo", "triangulo": "triangulo",
    "cua cua": "cuacua", "cuacuá": "cuacua",
    "field": "field", "fill": "field",
    "rellenita": "rellenita", "morocha": "morochas",
    "galletas": "galleta", # Forzamos singular para estandarizar
    
    # Snacks
    "lays": "lays", "leis": "lays", "doritos": "doritos",
    "cheetos": "cheetos", "chitos": "cheetos",
    "piqueos": "piqueo", "piqueo snax": "piqueo snax",
    
    # Limpieza
    "ace": "ace", "ase": "ace", "bolívar": "bolivar", "bolivar": "bolivar",
    "sapolio": "sapolio", "clorox": "clorox", "poett": "poett", "poet": "poett",
    
    # Básicos
    "huevos": "huevo", "panes": "pan", "fideos": "fideo",
}

def corregir_transcript(texto: str) -> str:
    """Corrige errores comunes de transcripción"""
    texto_lower = texto.lower()

    # Limpiar signos de puntuación
    texto_lower = texto_lower.strip('¡!¿?.,;:')

    # 🔥 NORMALIZAR: Quitar guiones de marcas
    # "coca-cola" → "coca cola" para match con BD
    texto_lower = texto_lower.replace('-', ' ')
    
    # Eliminar espacios dobles
    texto_lower = re.sub(r'\s+', ' ', texto_lower)

    for incorrecto, correcto in CORRECCIONES_TRANSCRIPT.items():
        texto_lower = re.sub(r'\b' + re.escape(incorrecto) + r'\b', correcto, texto_lower)
    
    return texto_lower

def normalize_text(text: str) -> str:
    """Normalizar texto (quitar tildes, lowercase)"""
    if not text: return ""
    return unicodedata.normalize('NFD', text.lower()).encode('ascii', 'ignore').decode('utf-8')

def calcular_score_avanzado(product_name: str, query: str) -> float:
    """
    Calcula score robusto soportando prefijos y contención
    Versión mejorada con reglas estrictas para palabras cortas
    """
    p_name = normalize_text(product_name)
    q = normalize_text(query)
    
    # 1. Match Exacto
    if p_name == q:
        return 1.0
    
    # 2. Empieza con (producto empieza con query)
    if p_name.startswith(q + " ") or p_name == q:
        return 0.95
    
    # 3. Primera palabra coincide exactamente
    p_words = p_name.split()
    if p_words and p_words[0] == q:
        return 0.9
    
    # 4. Palabra contenida exacta (query es una palabra completa en el producto)
    if q in p_words:
        return 0.85
    
    # 🔥 REGLAS ESTRICTAS PARA PALABRAS CORTAS (3 chars o menos)
    if q in PALABRAS_CORTAS_EXACTAS or len(q) <= 3:
        # Solo aceptar match de palabra completa con word boundaries
        import re
        pattern = r'\b' + re.escape(q) + r'\b'
        if re.search(pattern, p_name):
            return 0.75
        else:
            # NO aceptar substring match para palabras cortas
            return 0.0
    
    # 5. Palabra contenida como prefijo (solo para palabras 4+ chars)
    if len(q) >= 4:
        for word in p_words:
            if word.startswith(q):
                return 0.7
    
    # 6. Contiene string (fallback, solo para queries largas)
    if q in p_name and len(q) >= 5:
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
    product_id: int
    name: str
    price: float
    unit: str
    stock: Optional[float] = None
    score: float = 0.0

class ProductMatch(BaseModel):
    search_term: str
    quantity: float
    unit_requested: Optional[str] = None
    product_id: Optional[int] = None
    name: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    has_variants: bool = False
    variants: List[ProductOption] = []

class TimingMetrics(BaseModel):
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
    total_start = time.time()
    
    # 1. Preprocesamiento
    preprocess_start = time.time()
    transcript_original = request.transcript
    transcript_corregido = corregir_transcript(transcript_original)
    preprocess_ms = int((time.time() - preprocess_start) * 1000)
    
    print(f"\n[Voice LLM] ═══════════════════════════════════════════")
    print(f"[Voice LLM] Transcript: '{transcript_original}' -> '{transcript_corregido}'")
    
    # 2. LLM
    llm_start = time.time()
    try:
        if request.api == "claude":
            parsed_result, llm_latency, cost = await LLMService.parse_with_claude(transcript_corregido)
        elif request.api == "openai":
            parsed_result, llm_latency, cost = await LLMService.parse_with_openai(transcript_corregido)
        else:
            parsed_result, llm_latency, cost = await LLMService.parse_with_gemini(transcript_corregido)
        llm_ms = int((time.time() - llm_start) * 1000)
    except Exception as e:
        print(f"[Voice LLM] ❌ Error en LLM: {str(e)}")
        raise HTTPException(500, detail=f"Error en API {request.api}: {str(e)}")
    
    # 3. Extraer items
    items_list = parsed_result.get('productos', []) if isinstance(parsed_result, dict) else parsed_result if isinstance(parsed_result, list) else []
    print(f"[Voice LLM] Items detectados: {len(items_list)}")
    
    # 4. Búsqueda en BD (OPTIMIZADA)
    db_start = time.time()
    matched_products = []
    products_with_variants = []
    not_found = []
    
    # Cargar TODOS los productos activos de la tienda en memoria
    all_store_products = db.query(Product).filter(
        Product.store_id == current_user.store_id,
        Product.is_active == True
    ).all()
    
    for item in items_list:
        if isinstance(item, str):
            search_term = item
            cantidad = 1.0
            unidad = None
        else:
            search_term = str(item.get("nombre", item.get("name", "")))
            cantidad = float(item.get("cantidad", item.get("quantity", 1.0)) or 1.0)
            unidad = item.get("unidad", item.get("unit"))
            
        search_term = normalize_text(search_term.strip())
        if not search_term or len(search_term) < 2: continue
        
        # Generar variantes de búsqueda (singular/plural)
        queries = {search_term}
        if search_term.endswith('s'): queries.add(search_term.rstrip('s'))
        else: queries.add(search_term + 's')
        
        scored_candidates = []
        
        # Scoring contra todos los productos en memoria
        for product in all_store_products:
            best_p_score = 0
            
            for q in queries:
                # 1. Score por Nombre Principal
                score = calcular_score_avanzado(product.name, q)
                
                # 2. Score por ALIASES (¡Aquí está la lógica!)
                if hasattr(product, 'aliases') and product.aliases:
                    # Manejar si es string ("pan, yema") o lista ["pan", "yema"]
                    aliases_list = []
                    if isinstance(product.aliases, list):
                        aliases_list = product.aliases
                    elif isinstance(product.aliases, str):
                        aliases_list = product.aliases.split(',')
                    
                    for alias in aliases_list:
                        if alias and alias.strip():
                            alias_score = calcular_score_avanzado(alias.strip(), q)
                            # Si el alias hace match, cuenta igual que el nombre
                            score = max(score, alias_score)
                
                best_p_score = max(best_p_score, score)
            
            # Solo considerar si tiene un mínimo de sentido (>0.5)
            if best_p_score > 0.5:
                scored_candidates.append({'product': product, 'score': best_p_score})
        
        # Ordenar por score descendente (Mejor match primero)
        scored_candidates.sort(key=lambda x: (-x['score'], x['product'].name))
        
        # -----------------------------------------------------------
        # LÓGICA DE DECISIÓN: ¿AUTOMÁTICO O VARIANTES?
        # -----------------------------------------------------------
        is_clear_match = False
        
        if not scored_candidates:
            print(f"[Voice LLM] ❌ No encontrado: '{search_term}'")
            not_found.append(search_term)
            continue
            
        top_candidate = scored_candidates[0]
        top_score = top_candidate['score']
        
        if len(scored_candidates) == 1:
            # Solo hay uno. Si el score es decente, pasa.
            if top_score >= 0.6: 
                is_clear_match = True
        else:
            # Hay competencia. Aplicar "Margen de Victoria"
            second_score = scored_candidates[1]['score']
            diff = top_score - second_score
            
            # CASO A: Match EXACTO (1.0) mata a todo lo demás
            if top_score == 1.0 and second_score < 1.0:
                is_clear_match = True
            
            # CASO B: Score alto (>0.85) Y gana por goleada (>0.15)
            # Ejemplo: Azul (0.90) vs Roja (0.60) -> Diff 0.30 -> Pasa Automático
            # Ejemplo: Azul (0.90) vs Roja (0.85) -> Diff 0.05 -> NO Pasa (Modal)
            elif top_score >= 0.85 and diff > 0.15:
                is_clear_match = True
        
        # -----------------------------------------------------------
        # ASIGNACIÓN FINAL
        # -----------------------------------------------------------
        if is_clear_match:
            # ✅ AUTOMÁTICO
            best = top_candidate['product']
            print(f"[Voice LLM] ✅ Match claro: '{search_term}' -> {best.name} (Score: {top_score:.2f})")
            matched_products.append(ProductMatch(
                search_term=search_term,
                quantity=cantidad,
                unit_requested=unidad,
                product_id=best.id,
                name=best.name,
                price=float(best.sale_price),
                unit=getattr(best, 'unit', 'unidad'),
                has_variants=False
            ))
        else:
            # 🔀 AMBIGUO (MODAL)
            print(f"[Voice LLM] ⚠️ Ambiguo: '{search_term}' (Top: {top_score:.2f}, 2nd: {scored_candidates[1]['score'] if len(scored_candidates)>1 else 0:.2f})")
            variants = [
                ProductOption(
                    product_id=c['product'].id,
                    name=c['product'].name,
                    price=float(c['product'].sale_price),
                    unit=getattr(c['product'], 'unit', 'unidad'),
                    score=c['score']
                ) for c in scored_candidates[:6] # Top 6 para el modal
            ]
            products_with_variants.append(ProductMatch(
                search_term=search_term,
                quantity=cantidad,
                unit_requested=unidad,
                has_variants=True,
                variants=variants
            ))

    db_ms = int((time.time() - db_start) * 1000)
    total_ms = int((time.time() - total_start) * 1000)
    
    # 5. Logging
    try:
        log_entry = VoiceCommandLog(
            store_id=current_user.store_id,
            user_id=current_user.id,
            transcript=transcript_original,
            api_used=request.api,
            parsed_result={"items": items_list},
            products_found=len(matched_products) + len(products_with_variants),
            success=len(matched_products) > 0,
            latency_ms=total_ms,
            cost_usd=cost
        )
        db.add(log_entry)
        db.commit()
    except Exception: pass
    
    return VoiceParseResponse(
        success=len(matched_products) > 0 or len(products_with_variants) > 0,
        products=matched_products,
        products_with_variants=products_with_variants,
        not_found=not_found,
        api_used=request.api,
        latency_ms=total_ms,
        timing=TimingMetrics(total_ms=total_ms, llm_ms=llm_ms, db_search_ms=db_ms, preprocessing_ms=preprocess_ms),
        cost_usd=cost,
        transcript_corregido=transcript_corregido
    )