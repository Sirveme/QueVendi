"""
Servicio para manejo de archivos (imágenes de perfil, productos, etc)
"""
import os
import uuid
from typing import Optional
from fastapi import UploadFile, HTTPException, status
from PIL import Image
import io


class UploadService:
    """Servicio para subir y procesar archivos"""
    
    ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
    
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
        product_id: int
    ) -> dict:
        """Sube imagen de producto"""
        self._validate_file(file)
        
        content = await file.read()
        
        if len(content) > self.MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Archivo muy grande"
            )
        
        # Optimizar
        optimized_content = await self._optimize_image(content, max_size=(800, 800))
        
        # Nombre con UUID para evitar colisiones
        unique_id = str(uuid.uuid4())[:8]
        filename = f"product_{product_id}_{unique_id}.jpg"
        filepath = os.path.join(self.PRODUCTS_DIR, filename)
        
        with open(filepath, 'wb') as f:
            f.write(optimized_content)
        
        public_url = f"/static/uploads/products/{filename}"
        
        return {
            'filename': filename,
            'filepath': filepath,
            'url': public_url,
            'size': len(optimized_content)
        }
    
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