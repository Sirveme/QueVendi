"""
Modelo Product - Actualizado para Fase 1
"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Product(Base):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    
    # Información básica
    name = Column(String(200), nullable=False, index=True)
    aliases = Column(ARRAY(String), default=list)  # ["inka", "kola amarilla"]
    category = Column(String(100), nullable=True, index=True)

    # ⬇️ AGREGAR ESTE CAMPO
    catalog_code = Column(String(50), nullable=True, index=True)  # 'bodega_estandar', 'ferreteria_grande', etc.
    
    unit = Column(String(20), default='unidad')  # 'unidad', 'kg', 'litro', 'docena'
    
    # Identificación
    brand = Column(String(100), nullable=True)
    barcode = Column(String(50), nullable=True)
    sku = Column(String(50), nullable=True)
    
    # Media
    image_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    is_featured = Column(Boolean, default=False)  # Para mostrar en inicio
    
    # Precios
    cost_price = Column(Float, default=0)
    sale_price = Column(Float, nullable=False)
    
    # Stock
    stock = Column(Integer, default=0)
    min_stock_alert = Column(Integer, default=5)
    
    # Estado
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relaciones
    store = relationship("Store", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")