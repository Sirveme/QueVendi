import re
from typing import Dict, List, Optional
from difflib import SequenceMatcher
from app.models.product import Product

class VoiceService:
    
    # Variable de clase para opciones ambiguas
    _last_ambiguous_options = []
    
    FRACTIONS = {
        'medio': 0.5, 'media': 0.5, 'un medio': 0.5, 'una media': 0.5,
        'cuarto': 0.25, 'un cuarto': 0.25, 'cuartito': 0.25,
        'tres cuartos': 0.75, 'tres cuartitos': 0.75,
        'tercio': 1/3, 'un tercio': 1/3, 'una tercera parte': 1/3,
        'dos tercios': 2/3, 'dos tercio': 2/3,
    }
    
    NUMBERS = {
        'un': 1, 'uno': 1, 'una': 1,
        'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
        'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
        'once': 11, 'doce': 12, 'quince': 15, 'veinte': 20,
        'treinta': 30, 'cuarenta': 40, 'cincuenta': 50,
    }
    
    # Comandos especiales
    CANCEL_WORDS = ['cancelar', 'anular', 'borra', 'borrar', 'elimina', 'eliminar']
    CONFIRM_WORDS = ['listo', 'total', 'confirmar', 'suma', 'sumar', 'cierra', 'cerrar', 'terminar', 'termina', 'dale', 'ok', 'vale']
    ADD_WORDS = ['adicionar', 'adiciona', 'sumale', 'agregar', 'agrega', 'añadir', 'añade', 'aumentar', 'aumenta', 'pon', 'poner', 'meter', 'mete']
    CHANGE_WORDS = ['cambiar', 'cambia', 'modificar', 'modifica', 'corregir', 'corrige', 'actualizar', 'actualiza', 'ajustar', 'ajusta', 'cambio', 'cambios', 'modificacion', 'modificaciones']
    REMOVE_WORDS = ['quitar', 'quita', 'eliminar', 'elimina', 'sacar', 'saca', 'borrar', 'borra', 'sustraccion', 'sustraer', 'restar', 'resta', 'borrale']
    
    @staticmethod
    def detect_command_type(text: str) -> str:
        """Detectar tipo de comando"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in VoiceService.CANCEL_WORDS):
            if not any(word in text_lower for word in VoiceService.REMOVE_WORDS):
                return 'cancel'
        
        if any(word in text_lower for word in VoiceService.CONFIRM_WORDS):
            return 'confirm'
        
        if any(word in text_lower for word in VoiceService.ADD_WORDS):
            return 'add'
        
        if ' por ' in text_lower and any(word in text_lower for word in VoiceService.CHANGE_WORDS):
            return 'change_product'
        
        if re.search(r'\ba\s+\d+\s*soles?\b', text_lower):
            return 'change_price'
        
        if 'precio' in text_lower and ' a ' in text_lower:
            return 'change_price'
        
        if any(word in text_lower for word in VoiceService.CHANGE_WORDS):
            return 'change'
        
        if any(word in text_lower for word in VoiceService.REMOVE_WORDS):
            return 'remove'
        
        return 'sale'
    
    @staticmethod
    def parse_price_change(text: str) -> Optional[Dict]:
        """Parsear cambio de precio"""
        text_lower = text.lower()
        
        match = re.search(r'precio\s+(?:de\s+)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?', text_lower)
        if match:
            return {
                'product_query': match.group(1).strip(),
                'new_price': float(match.group(2))
            }
        
        if ' y ' not in text_lower:
            match = re.search(r'(?:cambiar\s+precio\s+(?:de\s+)?)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?', text_lower)
            if match:
                product_text = match.group(1).strip()
                product_text = re.sub(r'\b(cambiar|precio|modificar|cambia|modifica|de|del|la|el)\b', '', product_text).strip()
                if product_text:
                    return {
                        'product_query': product_text,
                        'new_price': float(match.group(2))
                    }
        
        match = re.search(r'precio\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:soles?)?', text_lower)
        if match:
            return {
                'product_query': match.group(1).strip(),
                'new_price': float(match.group(2))
            }
        
        return None
    
    @staticmethod
    def parse_product_change(text: str) -> Optional[Dict]:
        """Parsear cambio de producto"""
        text_lower = text.lower()
        
        match = re.search(r'(?:cambiar|cambia|cambio)\s+(.+?)\s+por\s+(.+)', text_lower)
        if match:
            old_prod = match.group(1).strip()
            new_prod = match.group(2).strip()
            
            old_prod = re.sub(r'\b(el|la|los|las|un|una)\b', '', old_prod).strip()
            new_prod = re.sub(r'\b(el|la|los|las|un|una)\b', '', new_prod).strip()
            
            return {
                'old_product': old_prod,
                'new_product': new_prod
            }
        
        return None
    
    @staticmethod
    def parse_remove(text: str) -> Optional[str]:
        """Parsear eliminación de producto"""
        text_lower = text.lower()
        
        for word in VoiceService.REMOVE_WORDS:
            text_lower = text_lower.replace(word, '').strip()
        
        text_lower = re.sub(r'\b(el|la|los|las|un|una|de|del)\b', '', text_lower).strip()
        
        return text_lower if text_lower else None
    
    @staticmethod
    def parse_quantity(text: str) -> Optional[float]:
        """Parsear cantidad con fracciones"""
        text = text.lower().strip()
        text = re.sub(r'\b(kilo|kilos|kg|litro|litros|unidad|unidades)\b', '', text).strip()
        
        match = re.search(r'(\w+)\s+y\s+(\w+)', text)
        if match:
            base_text = match.group(1)
            fraction_text = match.group(2)
            
            if base_text.isdigit():
                base = float(base_text)
            elif base_text in VoiceService.NUMBERS:
                base = float(VoiceService.NUMBERS[base_text])
            elif base_text in ['kilo', 'litro', 'unidad']:
                base = 1.0
            else:
                base = 0
            
            fraction = VoiceService.FRACTIONS.get(fraction_text, 0)
            return base + fraction
        
        for phrase, value in VoiceService.FRACTIONS.items():
            if phrase in text:
                return value
        
        for word, value in VoiceService.NUMBERS.items():
            if word in text:
                return float(value)
        
        match = re.search(r'\b(\d+(?:\.\d+)?)\b', text)
        if match:
            return float(match.group(1))
        
        return None
    
    @staticmethod
    def parse_command(text: str) -> Optional[Dict]:
        """Parsear comando completo"""
        text = text.lower().strip()
        
        print(f"[VoiceService] Parseando: '{text}'")
        
        command_type = VoiceService.detect_command_type(text)
        print(f"[VoiceService] Tipo detectado: {command_type}")
        
        if command_type == 'cancel':
            return {'type': 'cancel'}
        
        if command_type == 'confirm':
            return {'type': 'confirm'}
        
        if command_type == 'change_product':
            product_change = VoiceService.parse_product_change(text)
            if product_change:
                print(f"[VoiceService] Cambio de producto: {product_change}")
                return {
                    'type': 'change_product',
                    **product_change
                }
        
        if command_type == 'change_price':
            price_change = VoiceService.parse_price_change(text)
            if price_change:
                print(f"[VoiceService] Cambio de precio: {price_change}")
                return {
                    'type': 'change_price',
                    **price_change
                }
        
        if command_type == 'change':
            price_change = VoiceService.parse_price_change(text)
            if price_change:
                print(f"[VoiceService] Cambio de precio: {price_change}")
                return {
                    'type': 'change_price',
                    **price_change
                }
            
            product_change = VoiceService.parse_product_change(text)
            if product_change:
                print(f"[VoiceService] Cambio de producto: {product_change}")
                return {
                    'type': 'change_product',
                    **product_change
                }
        
        if command_type == 'remove':
            product_query = VoiceService.parse_remove(text)
            if product_query:
                print(f"[VoiceService] Eliminar: {product_query}")
                return {
                    'type': 'remove',
                    'product_query': product_query
                }
        
        action = 'add' if command_type == 'add' else 'sale'
        cleaned_text = text
        for word in VoiceService.ADD_WORDS + ['vender', 'vende', 'registrar', 'registra']:
            cleaned_text = cleaned_text.replace(word, '').strip()
        
        items = []
        if ' y ' in cleaned_text:
            parts = cleaned_text.split(' y ')
            print(f"[VoiceService] Detectados {len(parts)} productos separados por 'y'")
            for part in parts:
                parsed = VoiceService._parse_single_item(part.strip())
                if parsed:
                    items.append(parsed)
        else:
            parsed = VoiceService._parse_single_item(cleaned_text)
            if parsed:
                items.append(parsed)
        
        if not items:
            print(f"[VoiceService] No se pudieron parsear items")
            return None
        
        print(f"[VoiceService] Items parseados: {len(items)}")
        return {
            'type': action,
            'items': items
        }
    
    @staticmethod
    def _parse_single_item(text: str) -> Optional[Dict]:
        """Parsear un solo item"""
        quantity = VoiceService.parse_quantity(text)
        if quantity is None:
            quantity = 1.0
        
        product_query = text
        product_query = re.sub(r'\b\d+(?:\.\d+)?\b', '', product_query)
        
        for phrase in VoiceService.FRACTIONS.keys():
            product_query = product_query.replace(phrase, '')
        
        for word in VoiceService.NUMBERS.keys():
            product_query = product_query.replace(word, '')
        
        product_query = re.sub(r'\b(de|del|la|el|los|las)\b', '', product_query)
        product_query = re.sub(r'\b(kilo|kilos|kg|litro|litros|unidad|unidades)\b', '', product_query)
        
        product_query = ' '.join(product_query.split()).strip()
        
        if not product_query:
            return None
        
        print(f"[VoiceService]   - cantidad={quantity}, producto='{product_query}'")
        
        return {
            'quantity': quantity,
            'product_query': product_query
        }
    
    @staticmethod
    def find_product_fuzzy(query: str, products: List[Product]) -> Optional[Product]:
        """
        Buscar producto con fuzzy matching.
        Si hay múltiples matches similares, devuelve None y guarda opciones.
        """
        if not products:
            return None
        
        query = query.lower().strip()
        query_singular = query.rstrip('s')
        
        matches = []
        
        for product in products:
            if not product.is_active:
                continue
            
            product_name = product.name.lower()
            scores = []
            
            if query == product_name:
                return product
            
            if product_name.startswith(query) or product_name.startswith(query_singular):
                scores.append(80)
            
            if query in product_name or query_singular in product_name:
                scores.append(60)
            
            similarity = SequenceMatcher(None, query, product_name).ratio()
            scores.append(similarity * 50)
            
            if hasattr(product, 'aliases') and product.aliases:
                aliases = []
                if isinstance(product.aliases, list):
                    aliases = [a.lower() for a in product.aliases]
                elif isinstance(product.aliases, str):
                    aliases = [a.strip().lower() for a in product.aliases.split(',')]
                
                for alias in aliases:
                    if query == alias or query_singular == alias:
                        return product
                    if alias.startswith(query) or alias.startswith(query_singular):
                        scores.append(80)
                    if query in alias or query_singular in alias:
                        scores.append(60)
                    similarity = SequenceMatcher(None, query, alias).ratio()
                    scores.append(similarity * 50)
            
            max_score = max(scores) if scores else 0
            
            if max_score > 40:
                matches.append((product, max_score))
        
        matches.sort(key=lambda x: x[1], reverse=True)
        
        if not matches:
            print(f"[VoiceService] '{query}' → NO ENCONTRADO")
            return None
        
        # Si hay múltiples matches con score similar, es ambiguo
        if len(matches) > 1 and matches[0][1] - matches[1][1] < 10:
            print(f"[VoiceService] '{query}' → AMBIGUO: {len(matches)} opciones similares")
            VoiceService._last_ambiguous_options = [m[0] for m in matches[:4]]
            return None
        
        best_match = matches[0][0]
        print(f"[VoiceService] '{query}' → '{best_match.name}' (score: {matches[0][1]:.1f})")
        return best_match