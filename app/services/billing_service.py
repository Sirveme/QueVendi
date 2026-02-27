# app/services/billing_service.py
"""
Servicio de Facturación Electrónica - QueVendí
Integración con facturalo.pro para emisión de comprobantes

Basado en el patrón de ccploreto.org.pe

FIX 3 (2026-02-27):
- Método de pago (Yape, Plin, Tarjeta, etc.) en observaciones del comprobante
- forma_pago = "Credito" para ventas fiadas con cuotas SUNAT
- Dirección del cliente como parámetro
"""
import httpx
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from decimal import Decimal
from sqlalchemy.orm import Session

from app.models.billing import StoreBillingConfig, Comprobante
from app.models.sale import Sale, SaleItem

logger = logging.getLogger(__name__)

# Timezone Perú (UTC-5)
TZ_PERU = timezone(timedelta(hours=-5))

# ============================================
# FIX 3: Mapeo de métodos de pago para observaciones
# ============================================
METODO_PAGO_LABELS = {
    'efectivo': 'Efectivo',
    'yape': 'Yape',
    'plin': 'Plin',
    'tarjeta': 'Tarjeta',
    'fiado': 'Crédito',
}


class BillingService:
    """Servicio para emitir comprobantes electrónicos vía facturalo.pro"""

    def __init__(self, db: Session, store_id: int):
        self.db = db
        self.store_id = store_id
        self.config = self._get_config()

    def _get_config(self) -> Optional[StoreBillingConfig]:
        """Obtiene la configuración de facturación de la tienda"""
        return self.db.query(StoreBillingConfig).filter(
            StoreBillingConfig.store_id == self.store_id,
            StoreBillingConfig.is_active == True
        ).first()

    def esta_configurado(self) -> bool:
        """Verifica si la tienda tiene facturación configurada"""
        return (
            self.config is not None
            and self.config.facturalo_token is not None
            and self.config.is_active
        )

    async def emitir_comprobante(
        self,
        sale_id: int,
        tipo: str = "03",
        cliente_tipo_doc: str = "0",
        cliente_num_doc: str = "00000000",
        cliente_nombre: str = "CLIENTE VARIOS",
        cliente_direccion: str = None,
        cliente_email: str = None,
        # ============================================
        # FIX 3: Nuevos parámetros
        # ============================================
        payment_method: str = "efectivo",
        is_credit: bool = False,
        credit_days: int = 0,
    ) -> Dict[str, Any]:
        """
        Emite un comprobante electrónico para una venta.
        
        FIX v2: Llamar a facturalo PRIMERO, guardar DESPUÉS con número real.
        FIX v3: Incluir método de pago en observaciones + crédito SUNAT.
        """
        if not self.esta_configurado():
            return {"success": False, "error": "Facturación no configurada para esta tienda"}

        # Verificar que no exista comprobante EXITOSO previo
        existe = self.db.query(Comprobante).filter(
            Comprobante.sale_id == sale_id,
            Comprobante.status.in_(["accepted", "pending"])
        ).first()
        if existe:
            return {
                "success": False,
                "error": "Ya existe comprobante para esta venta",
                "comprobante_id": existe.id,
                "numero_formato": existe.numero_formato
            }

        # Obtener la venta
        sale = self.db.query(Sale).filter(Sale.id == sale_id).first()
        if not sale:
            return {"success": False, "error": "Venta no encontrada"}

        # Determinar serie
        if tipo == "01":
            serie = self.config.serie_factura
        else:
            serie = self.config.serie_boleta

        # Construir items del comprobante
        items = self._construir_items(sale)

        # Calcular totales
        subtotal = Decimal(str(sale.total))
        if self.config.tipo_afectacion_igv == "10":
            igv = round(subtotal - (subtotal / Decimal("1.18")), 2)
            subtotal_sin_igv = subtotal - igv
        else:
            igv = Decimal("0")
            subtotal_sin_igv = subtotal

        # ============================================
        # FIX 3: Construir observaciones con método de pago
        # ============================================
        observaciones = self._construir_observaciones(
            payment_method=payment_method,
            is_credit=is_credit,
            credit_days=credit_days
        )

        # ✅ FIX v2: Llamar a facturalo PRIMERO (sin guardar en BD)
        resultado = await self._enviar_a_facturalo_v2(
            sale_id=sale_id,
            tipo=tipo,
            serie=serie,
            items=items,
            cliente_tipo_doc=cliente_tipo_doc,
            cliente_num_doc=cliente_num_doc,
            cliente_nombre=cliente_nombre,
            cliente_direccion=cliente_direccion,
            cliente_email=cliente_email,
            # FIX 3: Pasar datos de pago
            payment_method=payment_method,
            is_credit=is_credit,
            credit_days=credit_days,
            observaciones=observaciones,
        )

        if not resultado["success"]:
            logger.warning(f"[Billing] ❌ facturalo rechazó: {resultado.get('error')}")
            return {
                "success": False,
                "comprobante_id": None,
                "numero_formato": None,
                "pdf_url": None,
                "error": resultado.get("error")
            }

        # ✅ FIX v2: Solo guardar si facturalo tuvo éxito
        numero_real = resultado.get("numero", 0)
        numero_formato_real = resultado.get("numero_formato", f"{serie}-{str(numero_real).zfill(8)}")

        comprobante = Comprobante(
            store_id=self.store_id,
            sale_id=sale_id,
            tipo=tipo,
            serie=serie,
            numero=numero_real,
            subtotal=subtotal_sin_igv,
            igv=igv,
            total=subtotal,
            cliente_tipo_doc=cliente_tipo_doc,
            cliente_num_doc=cliente_num_doc,
            cliente_nombre=cliente_nombre,
            cliente_direccion=cliente_direccion,
            cliente_email=cliente_email,
            items=items,
            status="accepted",
            facturalo_id=resultado.get("facturalo_id"),
            sunat_response_code=resultado.get("sunat_code", "0"),
            sunat_response_description=resultado.get("sunat_description"),
            sunat_hash=resultado.get("hash"),
            pdf_url=resultado.get("pdf_url"),
            xml_url=resultado.get("xml_url"),
            cdr_url=resultado.get("cdr_url"),
            verification_code=sale.verification_code
        )
        self.db.add(comprobante)

        # Actualizar correlativo en config
        if tipo == "01":
            self.config.ultimo_numero_factura = numero_real
        else:
            self.config.ultimo_numero_boleta = numero_real

        self.db.commit()

        logger.info(f"[Billing] ✅ Comprobante guardado: {numero_formato_real}")

        return {
            "success": True,
            "comprobante_id": comprobante.id,
            "serie": serie,
            "numero": numero_real,
            "numero_formato": numero_formato_real,
            "pdf_url": comprobante.pdf_url,
            "error": None
        }

    # ============================================
    # FIX 3: Nuevo método - Construir observaciones
    # ============================================
    def _construir_observaciones(
        self,
        payment_method: str = "efectivo",
        is_credit: bool = False,
        credit_days: int = 0
    ) -> str:
        """
        Construye el texto de observaciones para el comprobante.
        Incluye método de pago y datos de crédito si aplica.
        """
        partes = []

        # Método de pago
        label = METODO_PAGO_LABELS.get(payment_method, payment_method.capitalize())
        partes.append(f"Forma de pago: {label}")

        # Si es crédito, agregar info de plazo
        if is_credit and credit_days > 0:
            ahora = datetime.now(TZ_PERU)
            vencimiento = ahora + timedelta(days=credit_days)
            partes.append(f"Plazo: {credit_days} días")
            partes.append(f"Vence: {vencimiento.strftime('%d/%m/%Y')}")

        return " | ".join(partes)

    async def _enviar_a_facturalo_v2(
        self,
        sale_id: int,
        tipo: str,
        serie: str,
        items: list,
        cliente_tipo_doc: str,
        cliente_num_doc: str,
        cliente_nombre: str,
        cliente_direccion: str,
        cliente_email: str,
        # ============================================
        # FIX 3: Nuevos parámetros
        # ============================================
        payment_method: str = "efectivo",
        is_credit: bool = False,
        credit_days: int = 0,
        observaciones: str = "",
    ) -> Dict:
        """Envía el comprobante a facturalo.pro (sin objeto Comprobante)"""

        ahora_peru = datetime.now(TZ_PERU)

        # ============================================
        # FIX 3: Determinar forma de pago SUNAT
        # ============================================
        if is_credit and credit_days > 0:
            # CRÉDITO: SUNAT exige forma_pago, cuotas con fecha y monto
            forma_pago = "Credito"
            fecha_vencimiento = ahora_peru + timedelta(days=credit_days)

            # Calcular monto total para la cuota (puede ser 1 sola cuota)
            monto_total = sum(
                float(item.get("precio_unitario", 0)) * float(item.get("cantidad", 1))
                for item in items
            )

            cuotas = [{
                "moneda": "PEN",
                "monto": round(monto_total, 2),
                "fecha_pago": fecha_vencimiento.strftime("%Y-%m-%d")
            }]
        else:
            forma_pago = "Contado"
            cuotas = None

        payload = {
            "tipo_comprobante": tipo,
            "serie": serie,
            "fecha_emision": ahora_peru.strftime("%Y-%m-%d"),
            "hora_emision": ahora_peru.strftime("%H:%M:%S"),
            "moneda": "PEN",
            # ============================================
            # FIX 3: forma_pago dinámica + cuotas
            # ============================================
            "forma_pago": forma_pago,
            "cliente": {
                "tipo_documento": cliente_tipo_doc,
                "numero_documento": cliente_num_doc,
                "razon_social": cliente_nombre,
                "direccion": cliente_direccion,
                "email": cliente_email
            },
            "items": [{
                "descripcion": item.get("descripcion"),
                "cantidad": item.get("cantidad", 1),
                "unidad_medida": item.get("unidad", "NIU"),
                "precio_unitario": item.get("precio_unitario"),
                "tipo_afectacion_igv": self.config.tipo_afectacion_igv
            } for item in items],
            "enviar_email": bool(cliente_email),
            "referencia_externa": f"QUEVENDI-VENTA-{sale_id}",
            # ============================================
            # FIX 3: Observaciones con método de pago
            # ============================================
            "observaciones": observaciones,
        }

        # FIX 3: Agregar cuotas solo si es crédito
        # Por ahora NO enviar cuotas hasta que facturalo soporte XML UBL crédito
        # La forma_pago="Credito" ya se envía y facturalo la acepta
        # if cuotas:
        #     payload["cuotas"] = cuotas

        api_url = f"{self.config.facturalo_url}/comprobantes"
        logger.info(f"[Billing] Enviando a {api_url}: serie={serie}, tipo={tipo}, forma_pago={forma_pago}")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-API-Key": self.config.facturalo_token,
                        "X-API-Secret": self.config.facturalo_secret
                    }
                )

                logger.info(f"[Billing] Respuesta: status={response.status_code}")

                try:
                    data = response.json()
                    logger.info(f"[Billing] RESPUESTA COMPLETA: {data}")
                except Exception:
                    body_preview = response.text[:500] if response.text else "(vacío)"
                    logger.error(f"[Billing] Respuesta no-JSON: {body_preview}")
                    return {
                        "success": False,
                        "error": f"facturalo.pro respondió con formato inválido (HTTP {response.status_code})"
                    }

                if response.status_code in [200, 201] and data.get("exito"):
                    comp_data = data.get("comprobante", {})
                    archivos = data.get("archivos", {})
                    
                    numero = comp_data.get("numero")
                    numero_formato = comp_data.get("numero_formato")
                    
                    logger.info(f"[Billing] ✅ facturalo asignó: {numero_formato} (numero={numero})")
                    
                    return {
                        "success": True,
                        "facturalo_id": comp_data.get("id"),
                        "numero": numero,
                        "numero_formato": numero_formato,
                        "sunat_code": comp_data.get("codigo_sunat", "0"),
                        "sunat_description": comp_data.get("mensaje_sunat"),
                        "hash": comp_data.get("hash_cpe"),
                        "pdf_url": archivos.get("pdf_url"),
                        "xml_url": archivos.get("xml_url"),
                        "cdr_url": archivos.get("cdr_url"),
                    }
                else:
                    # === LOGGING MEJORADO PARA DIAGNÓSTICO ===
                    logger.error(f"[Billing] ❌ HTTP {response.status_code}")
                    logger.error(f"[Billing] ❌ Response body: {data}")
                    
                    # Intentar extraer error de múltiples formatos
                    error_msg = "Error desconocido"
                    
                    # Formato 1: {"mensaje": "..."}
                    if data.get("mensaje"):
                        error_msg = data["mensaje"]
                    # Formato 2: {"error": "..."}
                    elif data.get("error"):
                        error_msg = data["error"]
                    # Formato 3: {"detail": {"error": "..."}}
                    elif isinstance(data.get("detail"), dict):
                        error_msg = data["detail"].get("error", str(data["detail"]))
                    # Formato 4: {"detail": "string"}
                    elif isinstance(data.get("detail"), str):
                        error_msg = data["detail"]
                    # Formato 5: {"errors": [...]}
                    elif isinstance(data.get("errors"), list):
                        error_msg = "; ".join(str(e) for e in data["errors"])
                    # Formato 6: {"errors": {"campo": [...]}}
                    elif isinstance(data.get("errors"), dict):
                        parts = []
                        for k, v in data["errors"].items():
                            if isinstance(v, list):
                                parts.append(f"{k}: {', '.join(str(i) for i in v)}")
                            else:
                                parts.append(f"{k}: {v}")
                        error_msg = "; ".join(parts)
                    # Formato 7: Pydantic validation error (FastAPI 422)
                    elif response.status_code == 422:
                        detail = data.get("detail", [])
                        if isinstance(detail, list):
                            parts = [f"{e.get('loc', ['?'])[-1]}: {e.get('msg', '?')}" for e in detail]
                            error_msg = "Validación: " + "; ".join(parts)
                        else:
                            error_msg = f"Error de validación: {detail}"
                    
                    logger.error(f"[Billing] ❌ Error extraído: {error_msg}")
                    return {"success": False, "error": error_msg}

        except httpx.TimeoutException:
            return {"success": False, "error": "Timeout conectando a facturalo.pro"}
        except httpx.RequestError as e:
            return {"success": False, "error": f"Error de conexión: {str(e)}"}
        except Exception as e:
            return {"success": False, "error": f"Error inesperado: {str(e)}"}

    def _construir_items(self, sale: Sale) -> List[Dict]:
        """Construye la lista de items para el comprobante"""
        items = []
        for item in sale.items:
            items.append({
                "codigo": str(item.product_id),
                "descripcion": item.product.name if item.product else f"Producto #{item.product_id}",
                "unidad": "NIU",  # Unidad (NIU=unidad, KGM=kilo)
                "cantidad": item.quantity,
                "precio_unitario": float(item.unit_price),
                "valor_venta": float(item.subtotal),
                "tipo_afectacion_igv": self.config.tipo_afectacion_igv
            })
        return items

    async def verificar_conexion(self) -> Dict[str, Any]:
        """Verifica la conexión con facturalo.pro"""
        if not self.config or not self.config.facturalo_token:
            return {"success": False, "error": "No hay credenciales configuradas"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.config.facturalo_url}/empresa",
                    headers={
                        "X-API-Key": self.config.facturalo_token,
                        "X-API-Secret": self.config.facturalo_secret
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    self.config.is_verified = True
                    self.db.commit()
                    return {
                        "success": True,
                        "empresa": data.get("razon_social", "Conectado"),
                        "ruc": data.get("ruc")
                    }
                else:
                    return {"success": False, "error": "Credenciales inválidas"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def obtener_comprobante(self, comprobante_id: int) -> Optional[Comprobante]:
        """Obtiene un comprobante por ID"""
        return self.db.query(Comprobante).filter(
            Comprobante.id == comprobante_id,
            Comprobante.store_id == self.store_id
        ).first()

    def obtener_comprobante_por_venta(self, sale_id: int) -> Optional[Comprobante]:
        """Obtiene el comprobante asociado a una venta"""
        return self.db.query(Comprobante).filter(
            Comprobante.sale_id == sale_id
        ).first()

    def listar_comprobantes(
        self,
        limit: int = 50,
        offset: int = 0,
        tipo: str = None,
        status: str = None
    ) -> List[Comprobante]:
        """Lista los comprobantes de la tienda"""
        query = self.db.query(Comprobante).filter(
            Comprobante.store_id == self.store_id
        )
        if tipo:
            query = query.filter(Comprobante.tipo == tipo)
        if status:
            query = query.filter(Comprobante.status == status)

        return query.order_by(Comprobante.created_at.desc()).offset(offset).limit(limit).all()


# ============================================
# Helpers para uso simple
# ============================================

async def emitir_boleta(
    db: Session,
    sale_id: int,
    store_id: int,
    payment_method: str = "efectivo",
    is_credit: bool = False,
    credit_days: int = 0,
) -> Dict:
    """Emite una boleta simple (cliente genérico)"""
    service = BillingService(db, store_id)
    return await service.emitir_comprobante(
        sale_id,
        tipo="03",
        payment_method=payment_method,
        is_credit=is_credit,
        credit_days=credit_days,
    )


async def emitir_factura(
    db: Session,
    sale_id: int,
    store_id: int,
    ruc: str,
    razon_social: str,
    direccion: str = None,
    payment_method: str = "efectivo",
    is_credit: bool = False,
    credit_days: int = 0,
) -> Dict:
    """Emite una factura con datos del cliente"""
    service = BillingService(db, store_id)
    return await service.emitir_comprobante(
        sale_id,
        tipo="01",
        cliente_tipo_doc="6",
        cliente_num_doc=ruc,
        cliente_nombre=razon_social,
        cliente_direccion=direccion,
        payment_method=payment_method,
        is_credit=is_credit,
        credit_days=credit_days,
    )