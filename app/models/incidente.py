# app/models/incidente.py
"""
Modelo para incidentes de seguridad (denuncias/alertas)
"""

from sqlalchemy import Column, Integer, String, Float, Boolean, Text, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Incidente(Base):
    __tablename__ = "incidentes"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Clasificación
    nivel = Column(String(10), nullable=False)  # 'ROJO', 'AMBAR', 'VERDE'
    tipo = Column(String(50), nullable=False)  # 'robo', 'extorsion_whatsapp', etc.
    
    # Detalles
    descripcion = Column(Text, nullable=True)
    numero_extorsionador = Column(String(20), nullable=True)
    cuenta_bancaria_extorsionador = Column(String(50), nullable=True)
    monto_exigido = Column(Numeric(10, 2), nullable=True)
    
    # Ubicación
    latitud = Column(Float, nullable=True)
    longitud = Column(Float, nullable=True)
    direccion = Column(String(300), nullable=True)
    distrito = Column(String(100), nullable=True)
    provincia = Column(String(100), nullable=True)
    departamento = Column(String(100), nullable=True)
    
    # Evidencias (URLs de archivos)
    evidencias = Column(JSONB, default=list)
    
    # Privacidad
    identidad_reservada = Column(Boolean, default=True)
    
    # Notificaciones enviadas
    notificados = Column(JSONB, default=list)  # [{user_id, canal, timestamp}]
    
    # Estado
    estado = Column(String(20), default='pendiente')  # 'pendiente', 'atendido', 'archivado', 'falsa_alarma'
    atendido_por = Column(String(100), nullable=True)
    tiempo_respuesta_minutos = Column(Integer, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    resuelto_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relaciones
    store = relationship("Store", backref="incidentes")
    user = relationship("User", backref="incidentes_reportados")


class ContactoEmergencia(Base):
    __tablename__ = "contactos_emergencia"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    nombre = Column(String(100), nullable=False)
    telefono = Column(String(20), nullable=False)
    relacion = Column(String(50), nullable=True)  # 'familiar', 'amigo', 'vecino', 'otro'
    
    # Configuración de alertas
    notificar_rojo = Column(Boolean, default=True)
    notificar_ambar = Column(Boolean, default=False)
    notificar_verde = Column(Boolean, default=False)
    
    # Canal preferido
    canal_preferido = Column(String(20), default='push')  # 'push', 'sms'
    
    # Estado
    verificado = Column(Boolean, default=False)
    activo = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relación
    user = relationship("User", backref="contactos_emergencia")


class RedBodegueros(Base):
    __tablename__ = "red_bodegueros"
    
    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), unique=True, nullable=False)
    
    # Ubicación para calcular cercanía
    latitud = Column(Float, nullable=False)
    longitud = Column(Float, nullable=False)
    radio_alerta_km = Column(Float, default=1.0)
    
    # Configuración
    recibir_alertas_rojas = Column(Boolean, default=True)
    recibir_alertas_ambar = Column(Boolean, default=True)
    recibir_alertas_verdes = Column(Boolean, default=True)
    
    # Push subscription
    push_subscription = Column(JSONB, nullable=True)
    
    # Estado
    activo = Column(Boolean, default=True)
    ultimo_ping = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relación
    store = relationship("Store", backref="red_bodegueros")


class Notificacion(Base):
    __tablename__ = "notificaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Contenido
    titulo = Column(String(200), nullable=False)
    mensaje = Column(Text, nullable=False)
    tipo = Column(String(30), nullable=False)  # 'alerta_seguridad', 'promocion', 'sistema', 'chat'
    
    # Referencia opcional
    incidente_id = Column(Integer, ForeignKey("incidentes.id"), nullable=True)
    
    # Estado
    leida = Column(Boolean, default=False)
    leida_at = Column(DateTime(timezone=True), nullable=True)
    
    # Acción
    url_accion = Column(String(500), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relaciones
    user = relationship("User", backref="notificaciones")
    incidente = relationship("Incidente", backref="notificaciones")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Datos de suscripción
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    
    # Metadata
    user_agent = Column(String(500), nullable=True)
    dispositivo = Column(String(100), nullable=True)  # 'android', 'ios', 'desktop'
    
    activo = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relación
    user = relationship("User", backref="push_subscriptions")