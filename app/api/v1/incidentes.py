# app/api/v1/incidentes.py
"""
Endpoints para gestión de incidentes de seguridad
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel

from app.core.database import get_db
from app.models.incidente import Incidente, ContactoEmergencia, RedBodegueros, Notificacion
from app.models.store import Store
from app.api.dependencies import get_current_user


router = APIRouter(prefix="/incidentes", tags=["Incidentes"])


# ============================================
# SCHEMAS
# ============================================

class IncidenteCreate(BaseModel):
    nivel: str  # 'ROJO', 'AMBAR', 'VERDE'
    tipo: str
    descripcion: Optional[str] = None
    numero_extorsionador: Optional[str] = None
    cuenta_bancaria_extorsionador: Optional[str] = None
    monto_exigido: Optional[float] = None
    latitud: Optional[float] = None
    longitud: Optional[float] = None
    direccion: Optional[str] = None
    evidencias: Optional[List[str]] = []
    identidad_reservada: bool = True


class IncidenteResponse(BaseModel):
    id: int
    nivel: str
    tipo: str
    descripcion: Optional[str]
    latitud: Optional[float]
    longitud: Optional[float]
    distrito: Optional[str]
    provincia: Optional[str]
    departamento: Optional[str]
    estado: str
    created_at: datetime
    
    class Config:
        from_attributes = True


class IncidentePublico(BaseModel):
    """Versión pública del incidente (sin datos sensibles)"""
    id: int
    nivel: str
    tipo: str
    latitud: float  # Ofuscada
    longitud: float  # Ofuscada
    distrito: Optional[str]
    provincia: Optional[str]
    departamento: Optional[str]
    estado: str
    created_at: datetime


class EstadisticasResponse(BaseModel):
    total: int
    rojo: int
    ambar: int
    verde: int
    por_tipo: dict
    por_distrito: dict


# ============================================
# ENDPOINTS PÚBLICOS (para el mapa)
# ============================================
@router.get("/test-public")
async def test_publico():
    """Endpoint de prueba SIN dependencias"""
    return {"status": "ok", "public": True, "message": "Funciona sin auth"}
    
@router.get("/", response_model=dict)
async def listar_incidentes_publicos(
    nivel: Optional[str] = Query(None, description="Filtrar por nivel: ROJO, AMBAR, VERDE"),
    tipo: Optional[str] = Query(None, description="Filtrar por tipo de incidente"),
    departamento: Optional[str] = Query(None),
    provincia: Optional[str] = Query(None),
    distrito: Optional[str] = Query(None),
    fecha_desde: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    fecha_hasta: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    limit: int = Query(500, le=1000),
    db: Session = Depends(get_db)
):
    """
    Lista incidentes para el mapa público.
    Las ubicaciones se ofuscan por privacidad (+/- 200m).
    """
    query = db.query(Incidente).filter(
        Incidente.estado != 'falsa_alarma',
        Incidente.latitud.isnot(None),
        Incidente.longitud.isnot(None)
    )
    
    # Filtros
    if nivel:
        query = query.filter(Incidente.nivel == nivel.upper())
    
    if tipo:
        query = query.filter(Incidente.tipo == tipo)
    
    if departamento:
        query = query.filter(func.lower(Incidente.departamento) == departamento.lower())
    
    if provincia:
        query = query.filter(func.lower(Incidente.provincia) == provincia.lower())
    
    if distrito:
        query = query.filter(func.lower(Incidente.distrito) == distrito.lower())
    
    if fecha_desde:
        try:
            desde = datetime.strptime(fecha_desde, "%Y-%m-%d")
            query = query.filter(Incidente.created_at >= desde)
        except ValueError:
            pass
    
    if fecha_hasta:
        try:
            hasta = datetime.strptime(fecha_hasta, "%Y-%m-%d")
            hasta = hasta.replace(hour=23, minute=59, second=59)
            query = query.filter(Incidente.created_at <= hasta)
        except ValueError:
            pass
    
    # Ordenar y limitar
    incidentes = query.order_by(Incidente.created_at.desc()).limit(limit).all()
    
    # Ofuscar ubicaciones (+/- ~200m)
    import random
    
    resultado = []
    for inc in incidentes:
        # Agregar variación aleatoria de ~200m
        lat_offset = (random.random() - 0.5) * 0.004  # ~200m
        lng_offset = (random.random() - 0.5) * 0.004
        
        resultado.append({
            "id": inc.id,
            "nivel": inc.nivel,
            "tipo": inc.tipo,
            "latitud": inc.latitud + lat_offset if inc.latitud else None,
            "longitud": inc.longitud + lng_offset if inc.longitud else None,
            "distrito": inc.distrito,
            "provincia": inc.provincia,
            "departamento": inc.departamento,
            "estado": inc.estado,
            "created_at": inc.created_at.isoformat()
        })
    
    return {
        "total": len(resultado),
        "incidentes": resultado
    }


@router.get("/estadisticas", response_model=EstadisticasResponse)
async def obtener_estadisticas(
    periodo: str = Query("week", description="today, week, month, year"),
    departamento: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Obtiene estadísticas agregadas de incidentes.
    """
    # Calcular fecha de inicio según periodo
    ahora = datetime.now(timezone.utc)
    if periodo == "today":
        desde = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
    elif periodo == "week":
        desde = ahora - timedelta(days=7)
    elif periodo == "month":
        desde = ahora - timedelta(days=30)
    elif periodo == "year":
        desde = ahora - timedelta(days=365)
    else:
        desde = ahora - timedelta(days=7)
    
    query = db.query(Incidente).filter(
        Incidente.created_at >= desde,
        Incidente.estado != 'falsa_alarma'
    )
    
    if departamento:
        query = query.filter(func.lower(Incidente.departamento) == departamento.lower())
    
    incidentes = query.all()
    
    # Contar por nivel
    rojo = sum(1 for i in incidentes if i.nivel == 'ROJO')
    ambar = sum(1 for i in incidentes if i.nivel == 'AMBAR')
    verde = sum(1 for i in incidentes if i.nivel == 'VERDE')
    
    # Contar por tipo
    por_tipo = {}
    for inc in incidentes:
        por_tipo[inc.tipo] = por_tipo.get(inc.tipo, 0) + 1
    
    # Contar por distrito (top 10)
    por_distrito = {}
    for inc in incidentes:
        if inc.distrito:
            por_distrito[inc.distrito] = por_distrito.get(inc.distrito, 0) + 1
    
    # Ordenar y limitar a top 10
    por_distrito = dict(sorted(por_distrito.items(), key=lambda x: x[1], reverse=True)[:10])
    
    return EstadisticasResponse(
        total=len(incidentes),
        rojo=rojo,
        ambar=ambar,
        verde=verde,
        por_tipo=por_tipo,
        por_distrito=por_distrito
    )


# ============================================
# ENDPOINTS PRIVADOS (requieren auth)
# ============================================

@router.post("/", response_model=IncidenteResponse)
async def crear_incidente(
    data: IncidenteCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Crea un nuevo incidente/reporte.
    """
    # Validar nivel
    if data.nivel not in ['ROJO', 'AMBAR', 'VERDE']:
        raise HTTPException(status_code=400, detail="Nivel inválido. Use: ROJO, AMBAR, VERDE")
    
    # Obtener datos de la tienda para ubicación
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    
    incidente = Incidente(
        store_id=current_user.store_id,
        user_id=current_user.id,
        nivel=data.nivel.upper(),
        tipo=data.tipo,
        descripcion=data.descripcion,
        numero_extorsionador=data.numero_extorsionador,
        cuenta_bancaria_extorsionador=data.cuenta_bancaria_extorsionador,
        monto_exigido=data.monto_exigido,
        latitud=data.latitud or (store.latitude if store else None),
        longitud=data.longitud or (store.longitude if store else None),
        direccion=data.direccion or (store.address if store else None),
        distrito=store.district if store else None,
        provincia=store.province if store else None,
        departamento=store.department if store else None,
        evidencias=data.evidencias or [],
        identidad_reservada=data.identidad_reservada
    )
    
    db.add(incidente)
    db.commit()
    db.refresh(incidente)
    
    # TODO: Disparar notificaciones según nivel
    # - ROJO: Notificar inmediatamente a red de bodegueros cercanos, Serenazgo, contactos de emergencia
    # - AMBAR: Notificar a familia y registrar para estadísticas
    # - VERDE: Solo registrar para estadísticas (alerta preventiva)
    
    return incidente


@router.get("/mis-reportes", response_model=List[IncidenteResponse])
async def mis_reportes(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lista los incidentes reportados por el usuario actual.
    """
    incidentes = db.query(Incidente).filter(
        Incidente.user_id == current_user.id
    ).order_by(Incidente.created_at.desc()).all()
    
    return incidentes


@router.get("/{incidente_id}", response_model=IncidenteResponse)
async def detalle_incidente(
    incidente_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Obtiene el detalle de un incidente.
    Solo el creador puede ver todos los detalles.
    """
    incidente = db.query(Incidente).filter(Incidente.id == incidente_id).first()
    
    if not incidente:
        raise HTTPException(status_code=404, detail="Incidente no encontrado")
    
    # Solo el creador puede ver el detalle completo
    if incidente.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="No autorizado")
    
    return incidente


@router.patch("/{incidente_id}/estado")
async def actualizar_estado(
    incidente_id: int,
    estado: str = Query(..., description="pendiente, atendido, archivado, falsa_alarma"),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualiza el estado de un incidente.
    """
    incidente = db.query(Incidente).filter(Incidente.id == incidente_id).first()
    
    if not incidente:
        raise HTTPException(status_code=404, detail="Incidente no encontrado")
    
    if estado not in ['pendiente', 'atendido', 'archivado', 'falsa_alarma']:
        raise HTTPException(status_code=400, detail="Estado inválido")
    
    incidente.estado = estado
    if estado == 'atendido':
        incidente.resuelto_at = datetime.now(timezone.utc)
        # Calcular tiempo de respuesta
        if incidente.created_at:
            delta = datetime.now(timezone.utc) - incidente.created_at.replace(tzinfo=None)
            incidente.tiempo_respuesta_minutos = int(delta.total_seconds() / 60)
    
    db.commit()
    
    return {"message": "Estado actualizado", "estado": estado}


# ============================================
# CONTACTOS DE EMERGENCIA
# ============================================

class ContactoCreate(BaseModel):
    nombre: str
    telefono: str
    relacion: Optional[str] = None
    notificar_rojo: bool = True
    notificar_ambar: bool = False
    notificar_verde: bool = False


@router.get("/contactos/emergencia")
async def listar_contactos(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lista contactos de emergencia del usuario."""
    contactos = db.query(ContactoEmergencia).filter(
        ContactoEmergencia.user_id == current_user.id,
        ContactoEmergencia.activo == True
    ).all()
    
    return contactos


@router.post("/contactos/emergencia")
async def agregar_contacto(
    data: ContactoCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Agrega un contacto de emergencia."""
    # Máximo 5 contactos
    count = db.query(ContactoEmergencia).filter(
        ContactoEmergencia.user_id == current_user.id,
        ContactoEmergencia.activo == True
    ).count()
    
    if count >= 5:
        raise HTTPException(status_code=400, detail="Máximo 5 contactos de emergencia")
    
    contacto = ContactoEmergencia(
        user_id=current_user.id,
        nombre=data.nombre,
        telefono=data.telefono,
        relacion=data.relacion,
        notificar_rojo=data.notificar_rojo,
        notificar_ambar=data.notificar_ambar,
        notificar_verde=data.notificar_verde
    )
    
    db.add(contacto)
    db.commit()
    db.refresh(contacto)
    
    return contacto


@router.delete("/contactos/emergencia/{contacto_id}")
async def eliminar_contacto(
    contacto_id: int,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Elimina (desactiva) un contacto de emergencia."""
    contacto = db.query(ContactoEmergencia).filter(
        ContactoEmergencia.id == contacto_id,
        ContactoEmergencia.user_id == current_user.id
    ).first()
    
    if not contacto:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    
    contacto.activo = False
    db.commit()
    
    return {"message": "Contacto eliminado"}


# ============================================
# RED DE BODEGUEROS
# ============================================

@router.post("/red/unirse")
async def unirse_red(
    latitud: float,
    longitud: float,
    radio_km: float = 1.0,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Une la tienda a la red de bodegueros para recibir alertas."""
    # Verificar si ya está en la red
    existente = db.query(RedBodegueros).filter(
        RedBodegueros.store_id == current_user.store_id
    ).first()
    
    if existente:
        # Actualizar ubicación
        existente.latitud = latitud
        existente.longitud = longitud
        existente.radio_alerta_km = radio_km
        existente.activo = True
        db.commit()
        return {"message": "Ubicación actualizada en la red"}
    
    # Crear nuevo registro
    registro = RedBodegueros(
        store_id=current_user.store_id,
        latitud=latitud,
        longitud=longitud,
        radio_alerta_km=radio_km
    )
    
    db.add(registro)
    db.commit()
    
    return {"message": "Te has unido a la red de bodegueros"}


@router.get("/red/cercanos")
async def bodegueros_cercanos(
    latitud: float,
    longitud: float,
    radio_km: float = 1.0,
    db: Session = Depends(get_db)
):
    """
    Encuentra bodegueros cercanos a una ubicación.
    Usado para enviar alertas zonales.
    """
    # Fórmula aproximada para filtrar por distancia (Haversine simplificada)
    # 1 grado de latitud ≈ 111 km
    lat_range = radio_km / 111.0
    lng_range = radio_km / (111.0 * abs(cos(radians(latitud))))
    
    cercanos = db.query(RedBodegueros).filter(
        RedBodegueros.activo == True,
        RedBodegueros.latitud.between(latitud - lat_range, latitud + lat_range),
        RedBodegueros.longitud.between(longitud - lng_range, longitud + lng_range)
    ).all()
    
    return {
        "total": len(cercanos),
        "bodegueros": [{"store_id": b.store_id} for b in cercanos]
    }


# Helper para calcular distancia

from math import cos, radians
