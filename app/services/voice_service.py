import re
from typing import Dict, List, Optional
from difflib import SequenceMatcher
from app.models.product import Product
import unicodedata

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
        'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
        'veinte': 20, 'treinta': 30, 'cuarenta': 40, 'cincuenta': 50,
    }
    
    # Comandos especiales
    CANCEL_WORDS = ['cancelar', 'anular', 'borra todo', 'borrar todo', 'elimina todo']
    CONFIRM_WORDS = ['listo', 'total', 'confirmar', 'suma', 'cierra', 'terminar', 'dale', 'ok', 'vale', 'eso es todo']
    ADD_WORDS = ['adicionar', 'sumale', 'agregar', 'agrega', 'añadir', 'añade', 'aumentar', 'pon', 'incluye']
    CHANGE_WORDS = ['cambiar', 'cambia', 'modificar', 'corregir', 'actualizar', 'ajustar', 'mejor']
    REMOVE_WORDS = ['quitar', 'quita', 'eliminar', 'elimina', 'sacar', 'saca', 'borrar', 'borra', 'ya no', 'no quiero']
    QUERY_WORDS = ['cuánto', 'cuanto', 'total', 'suma', 'va']
    
    @staticmethod
    def detect_command_type(text: str) -> str:
        """Detectar tipo de comando"""
        text_lower = text.lower()
        
        print(f"[VoiceService] detect_command_type: '{text_lower}'")
        
        # Consulta de total
        if any(word in text_lower for word in VoiceService.QUERY_WORDS):
            if 'va' in text_lower or 'total' in text_lower:
                return 'query_total'
        
        # Cancelar TODO
        if any(phrase in text_lower for phrase in ['borra todo', 'borrar todo', 'elimina todo']):
            return 'cancel'
        
        if any(word in text_lower for word in VoiceService.CANCEL_WORDS):
            if not any(word in text_lower for word in VoiceService.REMOVE_WORDS):
                return 'cancel'
        
        # Confirmar
        if any(word in text_lower for word in VoiceService.CONFIRM_WORDS):
            return 'confirm'
        
        # Quitar producto
        if any(word in text_lower for word in VoiceService.REMOVE_WORDS):
            return 'remove'
        
        # Cambio de producto (X por Y)
        if ' por ' in text_lower and any(word in text_lower for word in VoiceService.CHANGE_WORDS):
            return 'change_product'
        
        # Venta por PRECIO objetivo - MÚLTIPLES PATRONES
        if re.search(r'\d+\s*soles?\s+de\s+', text_lower):
            print(f"[VoiceService] ✅ Detectado sale_by_price (patrón: X soles de Y)")
            return 'sale_by_price'
        
        if re.search(r'por\s+\d+\s*soles?', text_lower) and not any(word in text_lower for word in VoiceService.CHANGE_WORDS):
            print(f"[VoiceService] ✅ Detectado sale_by_price (patrón: Y por X soles)")
            return 'sale_by_price'
        
        if re.search(r'(?:dame|quiero)\s+\d+\s*soles?\s+(?:en|de)\s+', text_lower):
            return 'sale_by_price'
        
        # Cambio de precio
        if re.search(r'\ba\s+\d+\s*soles?\b', text_lower):
            return 'change_price'
        
        if 'precio' in text_lower and ' a ' in text_lower:
            return 'change_price'
        
        if re.search(r'(ponle|ponlo|dale)\s+\d+\s*soles?', text_lower):
            return 'change_price'
        
        # Cambio genérico
        if any(word in text_lower for word in VoiceService.CHANGE_WORDS):
            return 'change'
        
        # Agregar explícito
        if any(word in text_lower for word in VoiceService.ADD_WORDS):
            return 'add'
        
        # Por defecto: SALE
        return 'sale'
    
    @staticmethod
    def parse_price_change(text: str) -> Optional[Dict]:
        """Parsear cambio de precio"""
        text_lower = text.lower()
        
        # Patrón: "precio de X a Y soles"
        match = re.search(r'precio\s+(?:de\s+)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?', text_lower)
        if match:
            return {
                'product_query': match.group(1).strip(),
                'new_price': float(match.group(2))
            }
        
        # Patrón coloquial: "ponle 8 soles al aceite"
        match = re.search(r'(ponle|ponlo|dale)\s+(\d+(?:\.\d+)?)\s*soles?\s+(?:al?|a la)\s+(.+)', text_lower)
        if match:
            return {
                'product_query': match.group(3).strip(),
                'new_price': float(match.group(2))
            }
        
        # Patrón: "cambiar X a Y soles"
        if ' y ' not in text_lower:
            match = re.search(r'(?:cambiar\s+precio\s+(?:de\s+)?)?(.+?)\s+a\s+(\d+(?:\.\d+)?)\s*soles?', text_lower)
            if match:
                product_text = match.group(1).strip()
                product_text = re.sub(r'\b(cambiar|precio|modificar|de|del|la|el)\b', '', product_text).strip()
                if product_text:
                    return {
                        'product_query': product_text,
                        'new_price': float(match.group(2))
                    }
        
        return None
    
    @staticmethod
    def parse_sale_by_price(text: str) -> Optional[Dict]:
        """Parsear venta por precio objetivo"""
        text_lower = text.lower()
        
        # PATRÓN 1: "2 soles de papa"
        match = re.search(r'(\d+(?:\.\d+)?)\s*soles?\s+de\s+(.+)', text_lower)
        if match:
            target_amount = float(match.group(1))
            product_query = match.group(2).strip()
            product_query = re.sub(r'\b(de|del|la|el|un|una)\b', '', product_query).strip()
            
            return {
                'product_query': product_query,
                'target_amount': target_amount
            }
        
        # PATRÓN 2: "papa por 2 soles"
        match = re.search(r'(.+?)\s+por\s+(\d+(?:\.\d+)?)\s*soles?', text_lower)
        if match:
            product_query = match.group(1).strip()
            target_amount = float(match.group(2))
            product_query = re.sub(r'\b(de|del|la|el|un|una)\b', '', product_query).strip()
            
            return {
                'product_query': product_query,
                'target_amount': target_amount
            }
        
        # PATRÓN 3: "dame 2 soles en papa"
        match = re.search(r'(?:dame|quiero)\s+(\d+(?:\.\d+)?)\s*soles?\s+(?:en|de)\s+(.+)', text_lower)
        if match:
            target_amount = float(match.group(1))
            product_query = match.group(2).strip()
            product_query = re.sub(r'\b(de|del|la|el|un|una)\b', '', product_query).strip()
            
            return {
                'product_query': product_query,
                'target_amount': target_amount
            }
        
        return None
    
    @staticmethod
    def parse_product_change(text: str) -> Optional[Dict]:
        """Parsear cambio de producto"""
        text_lower = text.lower()
        
        match = re.search(r'(?:cambiar|cambia|cambio|mejor)\s+(?:el|la|los|las)?\s*(.+?)\s+por\s+(.+)', text_lower)
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
        
        text_lower = text_lower.replace('ya no quiero', '').strip()
        text_lower = text_lower.replace('no quiero', '').strip()
        text_lower = re.sub(r'\b(el|la|los|las|un|una|de|del)\b', '', text_lower).strip()
        
        return text_lower if text_lower else None
    
    @staticmethod
    def parse_quantity(text: str) -> Optional[float]:
        """Parsear cantidad con fracciones"""
        text = text.lower().strip()
        
        # Quitar unidades
        text = re.sub(r'\b(kilo|kilos|kg|litro|litros|unidad|unidades|und)\b', '', text).strip()
        
        # Detectar decimales: "dos cincuenta" = 2.5
        match = re.search(r'(\w+)\s+(cincuenta|setenta y cinco)', text)
        if match:
            base_word = match.group(1)
            decimal_word = match.group(2)
            
            if base_word in VoiceService.NUMBERS:
                base = float(VoiceService.NUMBERS[base_word])
                if decimal_word == 'cincuenta':
                    return base + 0.5
                elif decimal_word == 'setenta y cinco':
                    return base + 0.75
        
        # Fracciones: "uno y medio"
        match = re.search(r'(\w+)\s+y\s+(\w+)', text)
        if match:
            base_text = match.group(1)
            fraction_text = match.group(2)
            
            if base_text.isdigit():
                base = float(base_text)
            elif base_text in VoiceService.NUMBERS:
                base = float(VoiceService.NUMBERS[base_text])
            else:
                base = 0
            
            fraction = VoiceService.FRACTIONS.get(fraction_text, 0)
            return base + fraction
        
        # Solo fracciones
        for phrase, value in VoiceService.FRACTIONS.items():
            if phrase in text:
                return value
        
        # Palabras numéricas
        for word, value in VoiceService.NUMBERS.items():
            if word in text:
                return float(value)
        
        # Números directos
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
        
        if command_type == 'query_total':
            return {'type': 'query_total'}
        
        if command_type == 'sale_by_price':
            sale_data = VoiceService.parse_sale_by_price(text)
            if sale_data:
                print(f"[VoiceService] Venta por precio: {sale_data}")
                return {
                    'type': 'sale_by_price',
                    **sale_data
                }
        
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
                    **price_change,
                    'requires_owner': True
                }
        
        if command_type == 'change':
            price_change = VoiceService.parse_price_change(text)
            if price_change:
                return {
                    'type': 'change_price',
                    **price_change,
                    'requires_owner': True
                }
            
            product_change = VoiceService.parse_product_change(text)
            if product_change:
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
        
        # Ventas/agregar
        # SIEMPRE usar 'add' para no borrar carrito
        if any(word in text for word in ['vender', 'vende', 'nueva venta', 'empezar venta']):
            action = 'sale'
        else:
            action = 'add'
        
        cleaned_text = text
        for word in VoiceService.ADD_WORDS + ['vender', 'vende', 'registrar']:
            cleaned_text = cleaned_text.replace(word, '').strip()
        
        items = []
        if ' y ' in cleaned_text:
            parts = cleaned_text.split(' y ')
            for part in parts:
                parsed = VoiceService._parse_single_item(part.strip())
                if parsed:
                    items.append(parsed)
        else:
            parsed = VoiceService._parse_single_item(cleaned_text)
            if parsed:
                items.append(parsed)
        
        if not items:
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
        
        product_query = re.sub(r'\b(cincuenta|setenta y cinco)\b', '', product_query)
        product_query = re.sub(r'\b(de|del|la|el|los|las|un|una)\b', '', product_query)
        product_query = re.sub(r'\b(kilo|kilos|kg|litro|litros|unidad|unidades|und)\b', '', product_query)
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
        print(f"[VoiceService] 🚨 find_product_fuzzy EJECUTÁNDOSE")
        print(f"[VoiceService] Query: '{query}'")
        print(f"[VoiceService] Products: {len(products) if products else 0}")
        
        if not products:
            return None
        
        # ⬇️⬇️⬇️ CAMBIAR ESTAS LÍNEAS ⬇️⬇️⬇️
        query = VoiceService.normalize_text(query.lower().strip())  # ← AGREGAR normalize_text
        print(f"[VoiceService] Query NORMALIZADO: '{query}'")        # ← AGREGAR log
        # ⬆️⬆️⬆️ FIN CAMBIO ⬆️⬆️⬆️

        query_singular = query.rstrip('s')
        
        print(f"[VoiceService] 🔍 Buscando '{query}' en {len(products)} productos")
        
        matches = []
        
        for product in products:
            if not product.is_active:
                continue
            
            # ⬇️⬇️⬇️ CAMBIAR ESTA LÍNEA ⬇️⬇️⬇️
            product_name = VoiceService.normalize_text(product.name.lower())  # ← AGREGAR normalize_text
            # ⬆️⬆️⬆️ FIN CAMBIO ⬆️⬆️⬆️

            scores = []
            
            # Match exacto - NO retornar, evaluar todos
            if query == product_name:
                print(f"[VoiceService] ✅ Match exacto: {product.name}")
                scores.append(100)  # Score perfecto
            
            # Empieza con
            # Empieza con - PERO SOLO SI ES PALABRA COMPLETA
            if product_name.startswith(query) or product_name.startswith(query_singular):
                # Verificar si después del query hay espacio (es palabra completa)
                if (product_name.startswith(query + ' ') or 
                    product_name.startswith(query_singular + ' ') or
                    product_name == query or 
                    product_name == query_singular):
                    scores.append(85)
                    print(f"[VoiceService]   ✅ {product.name}: empieza con '{query}' (palabra completa)")
                else:
                    scores.append(35)  # Solo prefijo, no palabra completa
                    print(f"[VoiceService]   ⚠️ {product.name}: empieza con '{query}' pero no es palabra completa (score bajo)")
            
            # Contiene
            # Contiene - SOLO PALABRAS COMPLETAS
            if query in product_name or query_singular in product_name:
                # ⬇️⬇️⬇️ VALIDACIÓN DE PALABRA COMPLETA ⬇️⬇️⬇️
                words_in_name = product_name.split()
                
                # Verificar si es palabra completa
                is_complete_word = False
                for word in words_in_name:
                    # Quitar caracteres especiales para comparar
                    clean_word = word.strip('.,;:()[]{}')
                    if query == clean_word or query_singular == clean_word:
                        is_complete_word = True
                        break
                
                if is_complete_word:
                    scores.append(85)  # Palabra completa
                    print(f"[VoiceService]   ✅ {product.name}: palabra completa")
                else:
                    # Solo subcadena (ej: "agua" en "aguaymanto")
                    scores.append(35)  # Score bajo
                    print(f"[VoiceService]   ⚠️ {product.name}: solo subcadena (score bajo)")
                # ⬆️⬆️⬆️ FIN VALIDACIÓN ⬆️⬆️⬆️
            
            # Similaridad general
            similarity = SequenceMatcher(None, query, product_name).ratio()
            scores.append(similarity * 50)
            
            # Buscar en aliases
            if hasattr(product, 'aliases') and product.aliases:
                aliases = []
                if isinstance(product.aliases, list):
                    aliases = [a.lower() for a in product.aliases]
                elif isinstance(product.aliases, str):
                    aliases = [a.strip().lower() for a in product.aliases.split(',')]
                
                for alias in aliases:
                    # ⬇️⬇️⬇️ AGREGAR ESTA LÍNEA ⬇️⬇️⬇️
                    alias = VoiceService.normalize_text(alias)  # ← AGREGAR
                    # ⬆️⬆️⬆️ FIN CAMBIO ⬆️⬆️⬆️

                    if query == alias or query_singular == alias:
                        print(f"[VoiceService] ✅ Match en alias: {product.name} → '{alias}'")
                        scores.append(100)
                    
                    # ⬇️⬇️⬇️ VALIDAR PALABRA COMPLETA EN ALIASES TAMBIÉN ⬇️⬇️⬇️
                    elif query in alias or query_singular in alias:
                        # Verificar si es palabra completa
                        words_in_alias = alias.split()
                        clean_words = [w.strip('.,;:()[]{}') for w in words_in_alias]
                        
                        if query in clean_words or query_singular in clean_words:
                            scores.append(85)  # Palabra completa en alias
                            print(f"[VoiceService]   ✅ {product.name}: palabra completa en alias '{alias}'")
                        else:
                            scores.append(35)  # Solo subcadena
                            print(f"[VoiceService]   ⚠️ {product.name}: subcadena en alias '{alias}' (score bajo)")
                    # ⬆️⬆️⬆️ FIN VALIDACIÓN ⬆️⬆️⬆️
                    
                    # Starts with
                    elif alias.startswith(query) or alias.startswith(query_singular):
                        scores.append(85)
                    
                    # Similarity
                    similarity = SequenceMatcher(None, query, alias).ratio()
                    scores.append(similarity * 50)
            
            max_score = max(scores) if scores else 0
            
            if max_score > 40:
                matches.append((product, max_score))
        
        matches.sort(key=lambda x: x[1], reverse=True)
        
        # LOGS DE MATCHES
        if matches:
            print(f"[VoiceService] Matches encontrados para '{query}':")
            for i, (prod, score) in enumerate(matches[:5]):
                print(f"  {i+1}. {prod.name} (score: {score:.1f})")
        
        if not matches:
            print(f"[VoiceService] '{query}' → NO ENCONTRADO")
            return None
        
        # Verificar ambigüedad: 
        # Si hay 2+ productos con score >= 80, es ambiguo
        high_score_matches = [m for m in matches if m[1] >= 80]

        if len(high_score_matches) > 1:
            print(f"[VoiceService] '{query}' → AMBIGUO: {len(high_score_matches)} opciones con score alto")
            print(f"[VoiceService] Opciones: {[m[0].name for m in high_score_matches[:4]]}")
            print(f"[VoiceService] Scores: {[m[1] for m in high_score_matches[:4]]}")
            VoiceService._last_ambiguous_options = [m[0] for m in high_score_matches[:4]]
            return None
        
        best_match = matches[0][0]
        print(f"[VoiceService] '{query}' → '{best_match.name}' (score: {matches[0][1]:.1f})")
        return best_match
    
    import unicodedata

    @staticmethod
    def normalize_text(text: str) -> str:
        """
        Normalizar texto removiendo acentos/tildes
        'papá' → 'papa'
        'café' → 'cafe'
        'limón' → 'limon'
        """
        if not text:
            return text
        
        # Descomponer caracteres Unicode (á → a + ´)
        nfd = unicodedata.normalize('NFD', text)
        
        # Remover marcas diacríticas (categoría Unicode 'Mn')
        without_accents = ''.join(
            char for char in nfd 
            if unicodedata.category(char) != 'Mn'
        )
        
        # Recomponer caracteres
        return unicodedata.normalize('NFC', without_accents)