# ============================================
# ARCHIVO: app/models/product.py
# ============================================
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Product(Base):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    unit = Column(String(20), default='unidad')  # 'unidad', 'kg', 'litro'
    
    # Información básica
    name = Column(String(200), nullable=False, index=True)
    aliases = Column(ARRAY(String), default=list)  # ["inka", "kola amarilla"]
    category = Column(String(100), nullable=True, index=True)
    
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