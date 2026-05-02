"""
Servicio para manejo de archivos (imágenes de perfil, productos, etc).

- Avatares de usuario → filesystem local (clase UploadService).
- Imágenes de productos → Google Cloud Storage (funciones de módulo).
"""
import os
import time
import uuid
import glob
import io
import json
import logging
from typing import Optional
from fastapi import UploadFile, HTTPException, status
from PIL import Image

from app.core.config import settings

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════
# GOOGLE CLOUD STORAGE — imágenes de productos
# ════════════════════════════════════════════════════════════════
# El bucket no es público (política de la organización).
# QueVendi actúa como proxy autenticado: subimos a GCS y el blob_name
# se sirve via /api/v1/products/imagen/{store_id}/{filename}.

_gcs_client_cache = None


def get_gcs_client():
    """
    Cliente GCS singleton. Carga credenciales desde:
      1) GCS_CREDENTIALS_JSON (env var con el JSON inline) — para Railway.
      2) GCS_CREDENTIALS_FILE (path al .json) — para desarrollo local.
    """
    global _gcs_client_cache
    if _gcs_client_cache is not None:
        return _gcs_client_cache

    from google.cloud import storage
    from google.oauth2 import service_account

    creds_json = settings.GCS_CREDENTIALS_JSON or os.environ.get("GCS_CREDENTIALS_JSON")
    if creds_json:
        creds_dict = json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(creds_dict)
    else:
        credentials = service_account.Credentials.from_service_account_file(
            settings.GCS_CREDENTIALS_FILE
        )

    _gcs_client_cache = storage.Client(credentials=credentials)
    return _gcs_client_cache


def upload_product_image_gcs(
    file_bytes: bytes,
    product_id: int,
    store_id: int
) -> str:
    """
    Sube imagen optimizada a GCS y devuelve el blob_name interno.

    - Redimensiona a 800x800 manteniendo aspecto.
    - Convierte a JPEG calidad 85.
    - Borra cualquier blob anterior del mismo producto.
    """
    img = Image.open(io.BytesIO(file_bytes))
    img.thumbnail((800, 800), Image.Resampling.LANCZOS)
    if img.mode in ('RGBA', 'LA', 'P'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        img = background

    output = io.BytesIO()
    img.save(output, format='JPEG', quality=85, optimize=True)
    output.seek(0)

    timestamp = int(time.time())
    folder = settings.GCS_PRODUCTS_FOLDER
    blob_name = f"{folder}/{store_id}/product_{product_id}_{timestamp}.jpg"

    client = get_gcs_client()
    bucket = client.bucket(settings.GCS_BUCKET_NAME)

    # Borrar imágenes previas del mismo producto
    prefix = f"{folder}/{store_id}/product_{product_id}_"
    for blob in bucket.list_blobs(prefix=prefix):
        try:
            blob.delete()
        except Exception as e:
            logger.warning(f"[GCS] No se pudo borrar blob previo {blob.name}: {e}")

    blob = bucket.blob(blob_name)
    blob.upload_from_file(output, content_type='image/jpeg')

    return blob_name


def delete_product_image_gcs(image_url_or_blob: Optional[str]) -> bool:
    """
    Borra una imagen de GCS.
    Acepta:
      - blob_name (ej. "productos/2/product_3542_1234.jpg")
      - URL del proxy (ej. "/api/v1/products/imagen/2/product_3542_1234.jpg")
    """
    if not image_url_or_blob:
        return False

    proxy_prefix = "/api/v1/products/imagen/"
    if image_url_or_blob.startswith(proxy_prefix):
        rest = image_url_or_blob[len(proxy_prefix):]
        blob_name = f"{settings.GCS_PRODUCTS_FOLDER}/{rest}"
    else:
        blob_name = image_url_or_blob

    try:
        client = get_gcs_client()
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        bucket.blob(blob_name).delete()
        return True
    except Exception as e:
        logger.warning(f"[GCS] No se pudo borrar {blob_name}: {e}")
        return False


def download_product_image_gcs(store_id: int, filename: str) -> Optional[bytes]:
    """Descarga bytes del blob; devuelve None si no existe o falla."""
    blob_name = f"{settings.GCS_PRODUCTS_FOLDER}/{store_id}/{filename}"
    try:
        client = get_gcs_client()
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob = bucket.blob(blob_name)
        if not blob.exists():
            return None
        return blob.download_as_bytes()
    except Exception as e:
        logger.warning(f"[GCS] No se pudo descargar {blob_name}: {e}")
        return None



class UploadService:
    """Servicio para subir y procesar archivos"""
    
    ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
    PRODUCT_ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
    MAX_FILE_SIZE = 5 * 1024 * 1024            # 5MB (avatares)
    PRODUCT_MAX_FILE_SIZE = 2 * 1024 * 1024    # 2MB (productos, según zClaude-10)
    
    # Directorios
    UPLOAD_DIR = "app/static/uploads"
    AVATARS_DIR = f"{UPLOAD_DIR}/avatars"
    PRODUCTS_DIR = f"{UPLOAD_DIR}/products"
    
    def __init__(self):
        # Crear directorios si no existen
        os.makedirs(self.AVATARS_DIR, exist_ok=True)
        os.makedirs(self.PRODUCTS_DIR, exist_ok=True)
    
    def _validate_file(self, file: UploadFile) -> None:
        """Valida el archivo antes de subirlo"""
        # Validar extensión
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nombre de archivo inválido"
            )
        
        extension = file.filename.split('.')[-1].lower()
        if extension not in self.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Extensión no permitida. Use: {', '.join(self.ALLOWED_EXTENSIONS)}"
            )
        
        # Validar tipo MIME
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo debe ser una imagen"
            )
    
    async def _optimize_image(self, file_content: bytes, max_size: tuple = (800, 800)) -> bytes:
        """Optimiza y redimensiona la imagen"""
        try:
            image = Image.open(io.BytesIO(file_content))
            
            # Convertir a RGB si es necesario (para PNG con transparencia)
            if image.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', image.size, (255, 255, 255))
                if image.mode == 'P':
                    image = image.convert('RGBA')
                background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                image = background
            
            # Redimensionar manteniendo aspecto
            image.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Guardar optimizado
            output = io.BytesIO()
            image.save(output, format='JPEG', quality=85, optimize=True)
            return output.getvalue()
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Error procesando imagen: {str(e)}"
            )
    
    async def upload_avatar(
        self, 
        file: UploadFile, 
        user_id: int,
        dni: Optional[str] = None
    ) -> dict:
        """
        Sube avatar de usuario
        
        Args:
            file: Archivo a subir
            user_id: ID del usuario
            dni: DNI del usuario (opcional, para nombrar el archivo)
        
        Returns:
            {
                'filename': str,
                'filepath': str,
                'url': str,
                'size': int
            }
        """
        self._validate_file(file)
        
        # Leer contenido
        content = await file.read()
        
        # Validar tamaño
        if len(content) > self.MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Archivo muy grande. Máximo: {self.MAX_FILE_SIZE / (1024*1024)}MB"
            )
        
        # Optimizar imagen
        optimized_content = await self._optimize_image(content, max_size=(500, 500))
        
        # Generar nombre de archivo
        # Si hay DNI, usar DNI.jpg, sino usar user_id_uuid.jpg
        if dni:
            filename = f"{dni}.jpg"
        else:
            unique_id = str(uuid.uuid4())[:8]
            filename = f"user_{user_id}_{unique_id}.jpg"
        
        filepath = os.path.join(self.AVATARS_DIR, filename)
        
        # Eliminar archivo anterior si existe (para DNI)
        if dni and os.path.exists(filepath):
            os.remove(filepath)
        
        # Guardar archivo
        with open(filepath, 'wb') as f:
            f.write(optimized_content)
        
        # URL pública
        public_url = f"/static/uploads/avatars/{filename}"
        
        return {
            'filename': filename,
            'filepath': filepath,
            'url': public_url,
            'size': len(optimized_content)
        }
    
    async def upload_product_image(
        self,
        file: UploadFile,
        product_id: int,
        store_id: int
    ) -> dict:
        """
        Sube imagen de un producto.

        - Valida extensión (jpg/jpeg/png/webp) y tamaño (≤ 2MB).
        - Redimensiona a 800×800 manteniendo aspecto.
        - Guarda en static/uploads/products/{store_id}/product_{product_id}_{ts}.jpg
        - Elimina cualquier imagen previa del mismo producto.
        """
        # Validación específica de productos (no admite gif)
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nombre de archivo inválido"
            )
        extension = file.filename.split('.')[-1].lower()
        if extension not in self.PRODUCT_ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Extensión no permitida. Use: {', '.join(self.PRODUCT_ALLOWED_EXTENSIONS)}"
            )
        if not file.content_type or not file.content_type.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo debe ser una imagen"
            )

        content = await file.read()

        if len(content) > self.PRODUCT_MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La imagen no puede superar 2MB"
            )

        # Optimizar (redimensiona a máx 800×800, manteniendo aspecto)
        optimized_content = await self._optimize_image(content, max_size=(800, 800))

        # Carpeta por tienda
        store_dir = os.path.join(self.PRODUCTS_DIR, str(store_id))
        os.makedirs(store_dir, exist_ok=True)

        # Eliminar imágenes previas de este producto (cualquier timestamp)
        for prev in glob.glob(os.path.join(store_dir, f"product_{product_id}_*.jpg")):
            try:
                os.remove(prev)
            except OSError:
                pass

        # Nombre con timestamp para invalidar caché del navegador
        ts = int(time.time())
        filename = f"product_{product_id}_{ts}.jpg"
        filepath = os.path.join(store_dir, filename)

        with open(filepath, 'wb') as f:
            f.write(optimized_content)

        public_url = f"/static/uploads/products/{store_id}/{filename}"

        return {
            'filename': filename,
            'filepath': filepath,
            'url': public_url,
            'size': len(optimized_content)
        }

    def delete_product_image(self, image_url: Optional[str]) -> bool:
        """Elimina del filesystem la imagen apuntada por image_url (si es local)."""
        if not image_url or not image_url.startswith("/static/uploads/products/"):
            return False
        rel = image_url.lstrip("/")
        filepath = os.path.join(*rel.split("/"))
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                return True
        except OSError:
            return False
        return False
    
    def delete_file(self, filepath: str) -> bool:
        """Elimina un archivo del sistema"""
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                return True
            return False
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error al eliminar archivo: {str(e)}"
            )


# Instancia global
upload_service = UploadService()