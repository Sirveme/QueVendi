from sqlalchemy.orm import Session
from app.models.product import Product
from typing import List
from difflib import SequenceMatcher

class ProductService:
    def __init__(self, db: Session):
        self.db = db
    
    def get_products_by_store(self, store_id: int, active_only: bool = True) -> List[Product]:
        """
        Obtener productos de una tienda
        """
        try:
            query = self.db.query(Product).filter(Product.store_id == store_id)
            
            if active_only:
                query = query.filter(Product.is_active == True)
            
            return query.order_by(Product.name).all()
        except Exception as e:
            print(f"[ProductService] Error al obtener productos: {e}")
            # Si hay error de columna, reintentar sin columnas opcionales
            return self.db.query(
                Product.id,
                Product.store_id,
                Product.name,
                Product.category,
                Product.sale_price,
                Product.stock,
                Product.is_active
            ).filter(Product.store_id == store_id).all()
    
    def search_products(self, store_id: int, query: str) -> List[Product]:
        """
        Búsqueda inteligente optimizada para prefijos y plurales
        """
        import unicodedata
        
        def normalize(text):
            if not text: return ""
            return unicodedata.normalize('NFD', text.lower()).encode('ascii', 'ignore').decode('utf-8')

        query = normalize(query.strip())
        if not query: return []
        
        # Generar variantes (singular/plural)
        queries = {query}
        if query.endswith('s'): queries.add(query.rstrip('s'))
        else: queries.add(query + 's')
        
        # Obtener productos
        all_products = self.db.query(Product).filter(
            Product.store_id == store_id,
            Product.is_active == True
        ).all()
        
        scored_products = []
        
        for product in all_products:
            p_name = normalize(product.name)
            p_words = p_name.split()
            
            max_score = 0
            
            # Chequear variantes
            for q in queries:
                # 1. Match Exacto o Inicio de nombre
                if p_name == q:
                    max_score = 100
                elif p_name.startswith(q):
                    max_score = 90
                
                # 2. Match de palabras (El producto contiene la palabra que empieza con q)
                # Ejemplo: q="galleta", p="soda galletas" -> "galletas" empieza con "galleta" -> 85 pts
                for word in p_words:
                    if word == q:
                        max_score = max(max_score, 95)
                    elif word.startswith(q) and len(q) >= 3:
                        max_score = max(max_score, 85)
                
                # 3. Contenido general
                if q in p_name:
                    max_score = max(max_score, 60)
                
                # 4. Fuzzy (si no hubo match fuerte)
                if max_score < 60:
                    ratio = SequenceMatcher(None, q, p_name).ratio()
                    if ratio > 0.6:
                        max_score = max(max_score, ratio * 60)

            if max_score >= 50:
                scored_products.append((product, max_score))
        
        scored_products.sort(key=lambda x: x[1], reverse=True)
        return [p[0] for p in scored_products[:10]]
    
    def get_product_by_id(self, product_id: int) -> Product:
        """Obtener un producto por ID"""
        return self.db.query(Product).filter(Product.id == product_id).first()
    
    def create_product(self, store_id: int, product_data: dict) -> Product:
        """Crear un nuevo producto"""
        product = Product(
            store_id=store_id,
            **product_data
        )
        self.db.add(product)
        self.db.commit()
        self.db.refresh(product)
        return product
    
    def update_product(self, product_id: int, product_data: dict) -> Product:
        """Actualizar un producto existente"""
        product = self.get_product_by_id(product_id)
        if not product:
            raise ValueError(f"Producto {product_id} no encontrado")
        
        for key, value in product_data.items():
            if hasattr(product, key):
                setattr(product, key, value)
        
        self.db.commit()
        self.db.refresh(product)
        return product
    
    def delete_product(self, product_id: int) -> bool:
        """Desactivar un producto (soft delete)"""
        product = self.get_product_by_id(product_id)
        if not product:
            raise ValueError(f"Producto {product_id} no encontrado")
        
        product.is_active = False
        self.db.commit()
        return True