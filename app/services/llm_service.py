import os
import time
import json
from typing import List, Dict, Literal
import anthropic
import openai
import google.generativeai as genai

# Configurar APIs
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
openai.api_key = os.getenv("OPENAI_API_KEY")
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

SYSTEM_PROMPT = """Eres un asistente para una bodega en Perú. 
Tu trabajo es extraer productos de un comando de voz.

IMPORTANTE:
- Extrae TODOS los productos mencionados
- Identifica cantidades: números, fracciones (1/2, 1/4, 3/4), palabras (medio, un cuarto)
- Identifica montos: "X soles de..."
- Maneja plurales
- Productos en español peruano

Retorna JSON array:
[
  {
    "nombre": "papa",
    "cantidad": 2.0,
    "unidad": "kg",
    "monto": null
  },
  {
    "nombre": "limón",
    "cantidad": null,
    "unidad": null,
    "monto": 3.0
  }
]

Si cantidad es por monto, pon null en cantidad y el monto en soles.
Si es por cantidad, pon cantidad y null en monto."""


class LLMService:
    
    @staticmethod
    async def parse_with_claude(transcript: str) -> tuple[List[Dict], int, float]:
        """Parse con Claude 3.5 Sonnet"""
        start = time.time()
        
        try:
            message = anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{
                    "role": "user",
                    "content": f"Comando: {transcript}\n\nRetorna SOLO el JSON array, sin explicaciones."
                }]
            )
            
            latency = int((time.time() - start) * 1000)
            
            # Extraer JSON del response
            response_text = message.content[0].text.strip()
            
            # Limpiar markdown si existe
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
            
            products = json.loads(response_text)
            
            # Calcular costo aproximado
            input_tokens = message.usage.input_tokens
            output_tokens = message.usage.output_tokens
            cost = (input_tokens * 0.003 / 1_000_000) + (output_tokens * 0.015 / 1_000_000)
            
            return products, latency, cost
            
        except Exception as e:
            print(f"[Claude] Error: {str(e)}")
            raise
    
    
    @staticmethod
    async def parse_with_openai(transcript: str) -> tuple[List[Dict], int, float]:
        """Parse con GPT-4o-mini"""
        start = time.time()
        
        try:
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Comando: {transcript}\n\nRetorna SOLO el JSON array."}
                ],
                response_format={"type": "json_object"},
                max_tokens=1024
            )
            
            latency = int((time.time() - start) * 1000)
            
            content = response.choices[0].message.content
            data = json.loads(content)
            
            # OpenAI puede wrappear en {"products": [...]}
            products = data.get("products", data) if isinstance(data, dict) else data
            
            # Calcular costo
            input_tokens = response.usage.prompt_tokens
            output_tokens = response.usage.completion_tokens
            cost = (input_tokens * 0.15 / 1_000_000) + (output_tokens * 0.60 / 1_000_000)
            
            return products, latency, cost
            
        except Exception as e:
            print(f"[OpenAI] Error: {str(e)}")
            raise
    
    
    @staticmethod
    async def parse_with_gemini(transcript: str) -> tuple[List[Dict], int, float]:
        """Parse con Gemini 1.5 Flash"""
        start = time.time()
        
        try:
            model = genai.GenerativeModel("gemini-1.5-flash")
            
            prompt = f"""{SYSTEM_PROMPT}

Comando: {transcript}

Retorna SOLO el JSON array, sin markdown ni explicaciones."""
            
            response = model.generate_content(prompt)
            
            latency = int((time.time() - start) * 1000)
            
            # Extraer JSON
            response_text = response.text.strip()
            
            # Limpiar markdown
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
            
            products = json.loads(response_text)
            
            # Gemini es gratis (por ahora)
            cost = 0.0
            
            return products, latency, cost
            
        except Exception as e:
            print(f"[Gemini] Error: {str(e)}")
            raise