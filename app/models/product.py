"""
Modelo Product - Actualizado para Fase 1
"""
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text,
    ForeignKey, ARRAY, DECIMAL
)
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Product(Base):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    
    # ──────────────────────────────────────────────
    # Información básica
    # ──────────────────────────────────────────────
    name = Column(String(200), nullable=False, index=True)
    aliases = Column(ARRAY(String), default=list)       # ["inka", "kola amarilla"] → búsqueda voz
    category = Column(String(100), nullable=True, index=True)
    catalog_code = Column(String(50), nullable=True, index=True)  # Código del catálogo origen: 'BOD-BEB-001'
    unit = Column(String(20), default='unidad')          # 'unidad', 'kg', 'litro', 'docena'
    
    # Identificación
    brand = Column(String(100), nullable=True)
    barcode = Column(String(50), nullable=True)
    sku = Column(String(50), nullable=True)
    
    # Media
    image_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    is_featured = Column(Boolean, default=False)
    
    # ──────────────────────────────────────────────
    # Precios
    # ──────────────────────────────────────────────
    cost_price = Column(Float, default=0)
    sale_price = Column(Float, nullable=False)
    
    # ──────────────────────────────────────────────
    # Stock
    # ──────────────────────────────────────────────
    stock = Column(Integer, default=0)
    min_stock_alert = Column(Integer, default=5)
    
    # ──────────────────────────────────────────────
    # Estado
    # ──────────────────────────────────────────────
    is_active = Column(Boolean, default=True)
    
    # ──────────────────────────────────────────────
    # FASE 2: Campos enriquecidos (catálogos V2)
    # ──────────────────────────────────────────────
    
    # Agrupación inteligente para IA y filtros
    tags = Column(JSONB, default=list)
    # Ej: ["gaseosa", "refresco", "popular", "alta_rotacion"]
    
    # Relaciones entre productos (almacenan IDs de products del mismo store)
    complementarios = Column(JSONB, default=list)
    # Ej: [45, 78, 102] → "¿También lleva...?" en POS
    
    sustitutos = Column(JSONB, default=list)
    # Ej: [46, 50] → "No hay X, ¿quiere Y?" cuando stock=0
    
    # Precio por mayor
    mayoreo_cantidad_min = Column(Integer, nullable=True)
    # Cantidad mínima para activar mayoreo. NULL = sin mayoreo
    
    mayoreo_precio = Column(DECIMAL(10, 2), nullable=True)
    # Precio unitario en mayoreo
    
    mayoreo_nota = Column(String(100), nullable=True)
    # "Pack 6 unidades", "Caja 12 botellas"
    
    # Datos exclusivos para motor IA (invisibles al usuario)
    _ia_data = Column(JSONB, default=dict)
    # {
    #   "costo_ref": 2.80,
    #   "margen_tipico": 0.20,
    #   "rotacion": "alta",
    #   "temporalidad": "todo_año",
    #   "elasticidad": "baja"
    # }
    
    # Trazabilidad de catálogo
    catalog_origin = Column(String(20), nullable=True)
    # 'bodega', 'minimarket', 'farmacia', etc.
    # NULL = producto creado manualmente
    
    # ──────────────────────────────────────────────
    # Timestamps
    # ──────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    # ──────────────────────────────────────────────
    # Relaciones ORM
    # ──────────────────────────────────────────────
    store = relationship("Store", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")
    
    # ──────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────
    @property
    def is_low_stock(self) -> bool:
        """True si stock está por debajo del mínimo de alerta"""
        return self.stock <= self.min_stock_alert
    
    @property
    def is_out_of_stock(self) -> bool:
        """True si stock es 0"""
        return self.stock <= 0
    
    @property
    def has_mayoreo(self) -> bool:
        """True si tiene precio por mayor configurado"""
        return self.mayoreo_cantidad_min is not None and self.mayoreo_precio is not None
    
    def get_price_for_quantity(self, quantity: int) -> float:
        """Retorna el precio unitario según la cantidad (normal o mayoreo)"""
        if self.has_mayoreo and quantity >= self.mayoreo_cantidad_min:
            return float(self.mayoreo_precio)
        return self.sale_price
    
    def to_dict(self) -> dict:
        """Serialización para API/frontend"""
        return {
            "id": self.id,
            "store_id": self.store_id,
            "name": self.name,
            "aliases": self.aliases or [],
            "category": self.category,
            "catalog_code": self.catalog_code,
            "unit": self.unit,
            "brand": self.brand,
            "barcode": self.barcode,
            "image_url": self.image_url,
            "cost_price": self.cost_price,
            "sale_price": self.sale_price,
            "stock": self.stock,
            "min_stock_alert": self.min_stock_alert,
            "is_active": self.is_active,
            "is_low_stock": self.is_low_stock,
            "is_out_of_stock": self.is_out_of_stock,
            "tags": self.tags or [],
            "complementarios": self.complementarios or [],
            "sustitutos": self.sustitutos or [],
            "mayoreo": {
                "cantidad_min": self.mayoreo_cantidad_min,
                "precio": float(self.mayoreo_precio) if self.mayoreo_precio else None,
                "nota": self.mayoreo_nota
            } if self.has_mayoreo else None,
            "catalog_origin": self.catalog_origin,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
    
    def to_pos_dict(self) -> dict:
        """Versión ligera para el POS (solo lo que necesita la caja)"""
        return {
            "id": self.id,
            "name": self.name,
            "aliases": self.aliases or [],
            "category": self.category,
            "unit": self.unit,
            "sale_price": self.sale_price,
            "stock": self.stock,
            "image_url": self.image_url,
            "is_low_stock": self.is_low_stock,
            "mayoreo": {
                "cantidad_min": self.mayoreo_cantidad_min,
                "precio": float(self.mayoreo_precio) if self.mayoreo_precio else None,
                "nota": self.mayoreo_nota
            } if self.has_mayoreo else None,
            "complementarios": self.complementarios or [],
        }
