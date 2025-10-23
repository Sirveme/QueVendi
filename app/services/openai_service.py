# app/services/openai_service.py - CREAR ESTE ARCHIVO

import os
from openai import OpenAI
from typing import Dict, Optional
import json
from fastapi  import HTTPException

class OpenAIService:
    
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    @staticmethod
    async def parse_command_with_context(text: str, cart_context: list = None) -> Optional[Dict]:
        """
        Parsear comando usando OpenAI GPT-4o-mini con contexto del carrito
        
        Args:
            text: Texto del comando
            cart_context: Lista de items en el carrito actual
        
        Returns:
            Dict con el comando parseado en el mismo formato que VoiceService.parse_command()
        """
        
        # Construir contexto del carrito
        cart_str = ""
        if cart_context:
            cart_str = "Carrito actual:\n"
            for item in cart_context:
                cart_str += f"- {item['product_name']}: {item['quantity']} unidades\n"
        
        # Prompt para OpenAI
        system_prompt = """Eres un asistente para bodegas en Perú que interpreta comandos de voz.

Tu trabajo es convertir comandos naturales en JSON estructurado.

TIPOS DE COMANDOS:
- sale/add: Agregar productos (ej: "un café", "10 panes")
- change_price: Cambiar precio (ej: "café a 5 soles")
- change_product: Cambiar producto (ej: "cambiar café por leche")
- remove: Quitar producto (ej: "quitar pan")
- confirm: Confirmar venta (ej: "listo", "total")
- cancel: Cancelar (ej: "cancelar", "anular")

FORMATO DE RESPUESTA (JSON):
{
  "type": "sale|add|change_price|change_product|remove|confirm|cancel",
  "items": [{"product_query": "café", "quantity": 1.0}],  // para sale/add
  "product_query": "café",  // para remove/change_price
  "new_price": 5.0,  // para change_price
  "old_product": "café",  // para change_product
  "new_product": "leche"  // para change_product
}

REGLAS:
- Detecta fracciones: "medio" = 0.5, "cuarto" = 0.25
- Jerga peruana: "chochera" = descuento, "yapa" = extra gratis
- Si dice "agregá/añade", type debe ser "add" (NO sale)
- Si dice "otro/otra" o "más", usa el último producto del carrito
- Responde SOLO con JSON válido, sin explicaciones"""

        user_prompt = f"""{cart_str}

Comando: "{text}"

Interpreta este comando y responde en JSON:"""

        try:
            response = OpenAIService.client.chat.completions.create(
                model="gpt-4o-mini",  # Modelo más barato y rápido
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1,  # Baja temperatura para más consistencia
                max_tokens=200
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # Limpiar markdown si viene con ```json
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
            
            parsed = json.loads(result_text)
            
            print(f"[OpenAI] ✅ Comando parseado: {text} → {parsed['type']}")
            
            return parsed
            
        except Exception as e:
            print(f"[OpenAI] ❌ Error: {e}")
            return None


# En app/api/v1/sales.py - MODIFICAR parse_voice_command

from app.services.openai_service import OpenAIService

@router.post("/voice/parse")
async def parse_voice_command(
    command: VoiceCommandRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Parsear comando de voz con fallback a OpenAI"""
    
    # 1. Intentar con parser local
    parsed = VoiceService.parse_command(command.text)
    
    # 2. Si falla, intentar con OpenAI (si está habilitado)
    if not parsed and os.getenv("OPENAI_API_KEY"):
        print("[VoiceParser] Parser local falló, intentando con OpenAI...")
        
        # Obtener contexto del carrito (si existe en sesión)
        cart_context = []  # Aquí deberías obtener el carrito del usuario
        
        parsed = await OpenAIService.parse_command_with_context(
            command.text,
            cart_context
        )
        
        if parsed:
            print("[VoiceParser] ✅ OpenAI entendió el comando")
    
    if not parsed:
        raise HTTPException(400, detail="No se pudo entender el comando")
    
    # ... resto del código igual