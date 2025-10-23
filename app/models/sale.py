# ============================================
# ARCHIVO: app/models/sale.py
# ============================================
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Sale(Base):
    __tablename__ = "sales"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Totales
    total = Column(Float, nullable=False)
    
    # Pago
    payment_method = Column(String(20), nullable=False)  # efectivo, yape, plin
    payment_reference = Column(String(50), nullable=True)  # últimos 4 dígitos
    
    # Cliente (para fiados)
    customer_name = Column(String(100), nullable=True)
    is_credit = Column(Boolean, default=False)
    
    # Timestamps
    sale_date = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    store = relationship("Store", back_populates="sales")
    user = relationship("User", back_populates="sales")
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")


class SaleItem(Base):
    __tablename__ = "sale_items"
    
    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    # Cantidades y precios
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)
    
    # Relaciones
    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")