"""
Modelos Sale y SaleItem - Actualizados para Fase 1
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Numeric, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class Sale(Base):
    __tablename__ = "sales"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Identificador
    sale_number = Column(String(50), unique=True, nullable=True)  # 'V-000001'

    # Montos
    subtotal = Column(Numeric(10, 2), nullable=True)
    discount = Column(Numeric(10, 2), default=0)
    total = Column(Float, nullable=False)
    
    verification_code = Column(String(30), nullable=True, index=True)
    is_offline = Column(Boolean, default=False)
    offline_created_at = Column(DateTime(timezone=True), nullable=True)

    # Pago
    payment_details = Column(JSON, nullable=True)
    payment_method = Column(String(20), nullable=False)  # 'efectivo', 'yape', 'plin', 'tarjeta'
    payment_reference = Column(String(50), nullable=True)  # Últimos 4 dígitos / código
    payment_status = Column(String(20), default='paid')  # 'paid', 'pending', 'cancelled'
    paid_at = Column(DateTime(timezone=True), nullable=True)
    
    # Cliente
    customer_name = Column(String(100), nullable=True)
    customer_dni = Column(String(8), nullable=True)
    customer_phone = Column(String(20), nullable=True)
    is_credit = Column(Boolean, default=False)
    
    # Estado
    status = Column(String(20), default='completed')  # 'pending', 'completed', 'cancelled'
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Timestamps
    sale_date = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    store = relationship("Store", back_populates="sales")
    user = relationship("User", back_populates="sales", foreign_keys=[user_id])
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    invoices = relationship("Invoice", back_populates="sale")
    credit = relationship("Credit", back_populates="sale", uselist=False)
    comprobante = relationship("Comprobante", back_populates="sale", uselist=False)


class SaleItem(Base):
    __tablename__ = "sale_items"
    
    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    # Cantidades y precios
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")