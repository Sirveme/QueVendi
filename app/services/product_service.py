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
        Búsqueda inteligente de productos con similitud de texto
        
        Args:
            store_id: ID de la tienda
            query: Texto de búsqueda
        
        Returns:
            Lista de productos ordenados por relevancia
        """
        query = query.lower().strip()
        
        # Obtener todos los productos activos de la tienda
        all_products = self.db.query(Product).filter(
            Product.store_id == store_id,
            Product.is_active == True
        ).all()
        
        if not all_products:
            return []
        
        # Calcular similitud para cada producto
        scored_products = []
        for product in all_products:
            product_name = product.name.lower()
            
            # Si el producto tiene aliases, buscar también ahí
            product_aliases = []
            if hasattr(product, 'aliases') and product.aliases:
                # Puede ser una lista o un string separado por comas
                if isinstance(product.aliases, list):
                    product_aliases = [a.lower() for a in product.aliases]
                elif isinstance(product.aliases, str):
                    product_aliases = [a.strip().lower() for a in product.aliases.split(',')]
            
            max_score = 0
            
            # Buscar en el nombre del producto
            if query == product_name:
                max_score = 100
            elif product_name.startswith(query):
                max_score = 80
            elif query in product_name:
                max_score = 60
            else:
                similarity = SequenceMatcher(None, query, product_name).ratio()
                max_score = similarity * 50
            
            # Buscar en los aliases (si existen)
            for alias in product_aliases:
                if query == alias:
                    max_score = max(max_score, 100)
                elif alias.startswith(query):
                    max_score = max(max_score, 80)
                elif query in alias:
                    max_score = max(max_score, 60)
                else:
                    similarity = SequenceMatcher(None, query, alias).ratio()
                    max_score = max(max_score, similarity * 50)
            
            # Solo incluir productos con score > 50% (más estricto)
            if max_score > 50:
                scored_products.append((product, max_score))
        
        # Ordenar por score descendente
        scored_products.sort(key=lambda x: x[1], reverse=True)
        
        # Log para debug
        if scored_products:
            print(f"[ProductService] Búsqueda '{query}':")
            for product, score in scored_products[:5]:
                print(f"  - {product.name}: {score:.1f} puntos")
        else:
            print(f"[ProductService] Búsqueda '{query}': Sin resultados (ningún producto > 50% similitud)")
        
        # Retornar los top 10 productos
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