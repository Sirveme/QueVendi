"""
Servicio de Text-to-Speech usando Google Cloud TTS con fallback a Web Speech API
"""
import os
from typing import Optional
from google.cloud import texttospeech
import base64

class TTSService:
    """Servicio de conversión texto a voz"""
    
    def __init__(self):
        self.use_google = False
        self.client = None
        
        # Intentar inicializar Google TTS
        try:
            credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
            if credentials_path and os.path.exists(credentials_path):
                self.client = texttospeech.TextToSpeechClient()
                self.use_google = True
                print("[TTS] Google Cloud TTS inicializado")
            else:
                print("[TTS] Google credentials no encontradas, usando Web Speech API")
        except Exception as e:
            print(f"[TTS] Error al inicializar Google TTS: {e}")
            print("[TTS] Fallback a Web Speech API")
    
    def synthesize_speech(
        self, 
        text: str, 
        voice_name: Optional[str] = None,
        speed: float = 1.0
    ) -> dict:
        """
        Sintetizar voz desde texto
        
        Args:
            text: Texto a convertir
            voice_name: Nombre de voz (ej: 'es-PE-Standard-A')
            speed: Velocidad (0.25 - 4.0)
        
        Returns:
            Dict con audio en base64 o instrucciones para Web Speech API
        """
        if not self.use_google or not self.client:
            # Fallback: devolver instrucciones para usar Web Speech API en el cliente
            return {
                "method": "web_speech",
                "text": text,
                "voice": voice_name or "es-PE",
                "speed": speed
            }
        
        try:
            # Configurar síntesis con Google TTS
            synthesis_input = texttospeech.SynthesisInput(text=text)
            
            # Configurar voz
            voice = texttospeech.VoiceSelectionParams(
                language_code=os.getenv('TTS_LANGUAGE', 'es-PE'),
                name=voice_name or os.getenv('TTS_DEFAULT_VOICE', 'es-PE-Standard-A')
            )
            
            # Configurar audio
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=speed,
                pitch=0.0,
                volume_gain_db=0.0
            )
            
            # Sintetizar
            response = self.client.synthesize_speech(
                input=synthesis_input,
                voice=voice,
                audio_config=audio_config
            )
            
            # Convertir a base64 para enviar al cliente
            audio_base64 = base64.b64encode(response.audio_content).decode('utf-8')
            
            return {
                "method": "google_tts",
                "audio": audio_base64,
                "format": "mp3"
            }
            
        except Exception as e:
            print(f"[TTS] Error en Google TTS: {e}")
            # Fallback a Web Speech API
            return {
                "method": "web_speech",
                "text": text,
                "voice": voice_name or "es-PE",
                "speed": speed
            }
    
    def get_available_voices(self) -> list:
        """Obtener lista de voces disponibles"""
        if not self.use_google or not self.client:
            return [
                {"name": "Web Speech API", "language": "es-PE", "gender": "neutral"}
            ]
        
        try:
            voices = self.client.list_voices(language_code="es")
            
            voice_list = []
            for voice in voices.voices:
                if 'es-PE' in voice.language_codes or 'es-ES' in voice.language_codes:
                    voice_list.append({
                        "name": voice.name,
                        "language": voice.language_codes[0],
                        "gender": texttospeech.SsmlVoiceGender(voice.ssml_gender).name
                    })
            
            return voice_list
            
        except Exception as e:
            print(f"[TTS] Error obteniendo voces: {e}")
            return []

# Instancia global
tts_service = TTSService()