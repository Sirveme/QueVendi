from sqlalchemy import Column, Integer, String, DECIMAL, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base

class Invoice(Base):
    __tablename__ = "invoices"
    
    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    
    # Tipo de comprobante
    type = Column(String(20), nullable=False)  # TICKET, BOLETA, FACTURA
    series = Column(String(10), nullable=True)  # B001, F001
    number = Column(Integer, nullable=False)
    
    # Montos
    amount = Column(DECIMAL(10, 2), nullable=False)
    base_amount = Column(DECIMAL(10, 2), nullable=True)  # Sin IGV
    igv_amount = Column(DECIMAL(10, 2), nullable=True)
    
    # Cliente
    customer_dni = Column(String(8), nullable=True)
    customer_ruc = Column(String(11), nullable=True)
    customer_name = Column(String(200), nullable=True)
    customer_address = Column(Text, nullable=True)
    
    # SUNAT
    sunat_cdr = Column(Text, nullable=True)  # Constancia de Recepción
    sunat_status = Column(String(50), nullable=True)  # ACEPTADO, RECHAZADO
    pdf_url = Column(String(500), nullable=True)
    xml_url = Column(String(500), nullable=True)
    
    # Fechas
    issued_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    sale = relationship("Sale", back_populates="invoices")
    store = relationship("Store")