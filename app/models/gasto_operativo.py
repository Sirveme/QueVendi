"""
Modelo GastoOperativo — gastos del negocio para cálculo tributario.
Tabla: gastos_operativos
"""
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.core.database import Base


class GastoOperativo(Base):
    __tablename__ = "gastos_operativos"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    categoria = Column(String(50))           # alquiler, servicios, planilla, mantenimiento, otros
    descripcion = Column(String(200))
    monto = Column(Numeric(12, 2), nullable=False)
    comprobante_tipo = Column(String(20))
    comprobante_numero = Column(String(50))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
