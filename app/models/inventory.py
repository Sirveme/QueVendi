"""
Modelo InventoryMovement — Kardex valorizado.
Tabla: inventory_movements
"""
from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class InventoryMovement(Base):
    """
    Movimiento de inventario (entrada / salida).
    quantity > 0 → entrada, quantity < 0 → salida.
    """
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="NO ACTION"), nullable=True)

    movement_type = Column(String(30), nullable=False)
    quantity = Column(Numeric(10, 3), nullable=False)
    cost_price = Column(Numeric(10, 2), nullable=True)

    reference_type = Column(String(50), nullable=True)
    reference_id = Column(Integer, nullable=True)

    stock_before = Column(Numeric(10, 3), nullable=False)
    stock_after = Column(Numeric(10, 3), nullable=False)

    notes = Column(Text, nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    product = relationship("Product")
    store = relationship("Store")
