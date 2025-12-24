"""
Endpoints para gestión de usuarios
"""
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.user import User
from app.api.dependencies import get_current_user
from app.services.upload_service import upload_service

router = APIRouter(prefix="/users", tags=["users"])

@router.post("/avatar/upload")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sube o actualiza el avatar del usuario actual
    
    - Acepta: JPG, PNG, GIF, WEBP
    - Máximo: 5MB
    - Se optimiza automáticamente a 500x500
    - Se nombra con DNI del usuario (dni.jpg)
    """
    try:
        # Subir archivo
        result = await upload_service.upload_avatar(
            file=file,
            user_id=current_user.id,
            dni=current_user.dni  # Usamos DNI para nombrar el archivo
        )
        
        # Actualizar URL en BD
        current_user.avatar_url = result['url']
        db.commit()
        db.refresh(current_user)
        
        return {
            'message': 'Avatar actualizado exitosamente',
            'avatar_url': result['url'],
            'filename': result['filename'],
            'size': result['size']
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al subir avatar: {str(e)}"
        )


@router.get("/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """
    Obtiene información del usuario actual
    """
    return {
        'id': current_user.id,
        'dni': current_user.dni,
        'full_name': current_user.full_name,
        'username': current_user.username,
        'role': current_user.role,
        'avatar_url': current_user.avatar_url,
        'store_id': current_user.store_id
    }


@router.delete("/avatar")
async def delete_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Elimina el avatar del usuario actual
    """
    if not current_user.avatar_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes avatar para eliminar"
        )
    
    # Eliminar archivo físico
    filepath = f"app/static/uploads/avatars/{current_user.dni}.jpg"
    upload_service.delete_file(filepath)
    
    # Actualizar BD
    current_user.avatar_url = None
    db.commit()
    
    return {'message': 'Avatar eliminado exitosamente'}