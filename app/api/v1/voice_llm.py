from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Literal
import uuid

from app.core.database import get_db
from app.api.dependencies import get_current_user
from app.models.user import User
from app.models.product import Product
from app.models.voice_log import VoiceCommandLog
from app.services.llm_service import LLMService

router = APIRouter(prefix="/voice", tags=["voice-llm"])

class VoiceParseRequest(BaseModel):
    transcript: str
    api: Literal["claude", "openai", "gemini"] = "claude"
    session_id: str | None = None


class ProductMatch(BaseModel):
    product_id: int
    name: str
    quantity: float
    unit: str
    price: float
    

class VoiceParseResponse(BaseModel):
    success: bool
    products: List[ProductMatch]
    not_found: List[str]
    api_used: str
    latency_ms: int
    cost_usd: float


@router.post("/parse-llm", response_model=VoiceParseResponse)
async def parse_voice_with_llm(
    request: VoiceParseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parsear comando de voz usando LLM
    Soporta múltiples productos en un solo comando
    """
    
    print(f"\n[Voice LLM] Transcript: '{request.transcript}'")
    print(f"[Voice LLM] API: {request.api}")
    
    # 1. Llamar al LLM según API elegida
    try:
        if request.api == "claude":
            parsed_items, latency, cost = await LLMService.parse_with_claude(request.transcript)
        elif request.api == "openai":
            parsed_items, latency, cost = await LLMService.parse_with_openai(request.transcript)
        else:  # gemini
            parsed_items, latency, cost = await LLMService.parse_with_gemini(request.transcript)
            
        print(f"[Voice LLM] Parsed: {parsed_items}")
        
    except Exception as e:
        print(f"[Voice LLM] Error en LLM: {str(e)}")
        raise HTTPException(500, detail=f"Error en API: {str(e)}")
    
    # 2. Buscar productos en DB
    matched_products = []
    not_found = []
    
    for item in parsed_items:
        product_name = item.get("nombre", "").lower().strip()
        
        if not product_name:
            continue
        
        # Buscar en DB
        product = db.query(Product).filter(
            Product.store_id == current_user.store_id,
            Product.is_active == True,
            Product.name.ilike(f"%{product_name}%")
        ).first()
        
        if product:
            # Calcular cantidad
            if item.get("monto"):
                # Por monto: calcular cantidad según precio
                quantity = item["monto"] / float(product.sale_price)
            else:
                # Por cantidad directa
                quantity = item.get("cantidad", 1.0)
            
            matched_products.append(ProductMatch(
                product_id=product.id,
                name=product.name,
                quantity=round(quantity, 2),
                unit=getattr(product, 'unit', 'unidad'),
                price=float(product.sale_price)
            ))
        else:
            not_found.append(product_name)
    
    # 3. Log en DB
    log_entry = VoiceCommandLog(
        store_id=current_user.store_id,
        user_id=current_user.id,
        transcript=request.transcript,
        api_used=request.api,
        parsed_result=parsed_items,
        products_found=len(matched_products),
        products_added=len(matched_products),
        success=len(matched_products) > 0,
        latency_ms=latency,
        cost_usd=cost,
        session_id=request.session_id
    )
    
    db.add(log_entry)
    db.commit()
    
    print(f"[Voice LLM] Matched: {len(matched_products)}, Not found: {len(not_found)}")
    
    return VoiceParseResponse(
        success=len(matched_products) > 0,
        products=matched_products,
        not_found=not_found,
        api_used=request.api,
        latency_ms=latency,
        cost_usd=cost
    )