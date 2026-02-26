# app/models/billing.py
"""
Modelos para Facturación Electrónica - QueVendí
Integración con facturalo.pro
"""
from sqlalchemy import Column, Integer, String, Float, Text, Boolean, DateTime, ForeignKey, JSON, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class StoreBillingConfig(Base):
    """
    Configuración de facturación electrónica por tienda (tenant)
    Cada bodega puede tener su propia configuración con facturalo.pro
    """
    __tablename__ = "store_billing_configs"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), unique=True, nullable=False)

    # Datos del emisor (bodega)
    ruc = Column(String(11), nullable=True)  # RUC del negocio
    razon_social = Column(String(255), nullable=True)
    nombre_comercial = Column(String(255), nullable=True)  # Nombre de fantasía
    direccion = Column(String(255), nullable=True)
    ubigeo = Column(String(6), nullable=True)  # Código UBIGEO Perú

    # Conexión con facturalo.pro
    facturalo_url = Column(String(255), default="https://facturalo.pro/api/v1")
    facturalo_token = Column(String(255), nullable=True)  # API Key
    facturalo_secret = Column(String(255), nullable=True)  # API Secret

    # Series de comprobantes
    serie_boleta = Column(String(4), default="B001")
    serie_factura = Column(String(4), default="F001")

    # Correlativos actuales
    ultimo_numero_boleta = Column(Integer, default=0)
    ultimo_numero_factura = Column(Integer, default=0)

    # Configuración de emisión
    emitir_automatico = Column(Boolean, default=False)  # Emitir al completar venta
    tipo_afectacion_igv = Column(String(2), default="20")  # '10'=Gravado, '20'=Exonerado
    porcentaje_igv = Column(Float, default=0)  # 0 para exonerados, 18 para gravados

    # Estado
    is_active = Column(Boolean, default=False)  # Solo activo cuando está configurado
    is_verified = Column(Boolean, default=False)  # Conexión verificada con facturalo

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relación
    store = relationship("Store", back_populates="billing_config")

    def __repr__(self):
        return f"<StoreBillingConfig store_id={self.store_id} ruc={self.ruc}>"


class Comprobante(Base):
    """
    Comprobante Electrónico (Boleta/Factura)
    Almacena los comprobantes emitidos vía facturalo.pro
    """
    __tablename__ = "comprobantes"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    # Relación con venta
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False, index=True)

    # Tipo de comprobante SUNAT
    tipo = Column(String(2), nullable=False)  # '01'=Factura, '03'=Boleta
    serie = Column(String(4), nullable=False)  # B001, F001
    numero = Column(Integer, nullable=False)

    verification_code = Column(String(30), nullable=True, index=True)

    # Fecha de emisión
    fecha_emision = Column(DateTime(timezone=True), server_default=func.now())
    moneda = Column(String(3), default="PEN")  # PEN, USD

    # Importes
    subtotal = Column(Numeric(10, 2), nullable=False)
    igv = Column(Numeric(10, 2), default=0)  # 0 para exonerados
    total = Column(Numeric(10, 2), nullable=False)

    # Cliente (receptor del comprobante)
    cliente_tipo_doc = Column(String(1), nullable=False)  # '0'=Sin doc, '1'=DNI, '6'=RUC
    cliente_num_doc = Column(String(15), nullable=False)
    cliente_nombre = Column(String(255), nullable=False)
    cliente_direccion = Column(String(255), nullable=True)
    cliente_email = Column(String(100), nullable=True)

    # Items del comprobante (JSON)
    items = Column(JSON, default=list)

    # Respuesta de SUNAT
    sunat_response_code = Column(String(10), nullable=True)
    sunat_response_description = Column(Text, nullable=True)
    sunat_hash = Column(String(100), nullable=True)

    # Archivos generados por facturalo.pro
    xml_url = Column(String(500), nullable=True)
    pdf_url = Column(String(500), nullable=True)
    cdr_url = Column(String(500), nullable=True)

    # Estado del comprobante
    status = Column(String(20), default="pending")

    # Integración con facturalo.pro
    facturalo_id = Column(String(50), nullable=True)
    facturalo_response = Column(JSON, nullable=True)

    # Notas internas
    observaciones = Column(Text, nullable=True)

    # Auditoría
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relaciones
    sale = relationship("Sale", back_populates="comprobante")
    store = relationship("Store")

    def __repr__(self):
        return f"<Comprobante {self.serie}-{str(self.numero).zfill(8)} tipo={self.tipo}>"

    @property
    def numero_formato(self):
        """Número formateado: B001-00000001"""
        return f"{self.serie}-{str(self.numero).zfill(8)}"
