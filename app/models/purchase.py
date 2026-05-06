"""
Modelos Purchase / PurchaseItem — Registro de compras.
Tablas: purchases, purchase_items
"""
from sqlalchemy import (
    Column, Integer, String, Numeric, Date, DateTime, Text,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="NO ACTION"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="NO ACTION"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="NO ACTION"), nullable=True)

    purchase_number = Column(String(50), nullable=True)

    # Documento de la compra (zClaude-27)
    tipo_documento = Column(String(20), default="FACTURA")
    serie = Column(String(10), nullable=True)
    numero = Column(String(20), nullable=True)
    fecha_emision = Column(Date, nullable=True)
    fecha_vencimiento = Column(Date, nullable=True)

    # Compatibilidad con columnas antiguas del DDL original
    supplier_invoice_series = Column(String(10), nullable=True)
    supplier_invoice_number = Column(String(20), nullable=True)
    purchase_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)

    subtotal = Column(Numeric(12, 2), default=0)
    igv = Column(Numeric(12, 2), default=0)
    total = Column(Numeric(12, 2), nullable=False, default=0)

    payment_method = Column(String(20), default="contado")
    payment_status = Column(String(20), default="paid")
    paid_at = Column(DateTime(timezone=True), nullable=True)

    estado = Column(String(20), default="registrado")  # registrado | anulado
    status = Column(String(20), default="completed")    # legacy

    notes = Column(Text, nullable=True)
    ocr_raw = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)

    supplier = relationship("Supplier")
    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id", ondelete="CASCADE"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="NO ACTION"), nullable=True)

    product_name = Column(String(200), nullable=True)
    quantity = Column(Numeric(10, 3), nullable=False)
    unit = Column(String(20), nullable=True)
    cost_price = Column(Numeric(10, 2), nullable=False)
    sale_price = Column(Numeric(10, 2), nullable=True)
    subtotal = Column(Numeric(12, 2), nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")
