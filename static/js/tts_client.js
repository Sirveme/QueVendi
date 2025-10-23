/**
 * Cliente Text-to-Speech simplificado
 * Maneja reproducción de audio desde Google TTS o Web Speech API
 */

class TTSClient {
    constructor() {
        this.audioQueue = [];
        this.isPlaying = false;
    }
    
    async speak(text, options = {}) {
        const voice = options.voice || 'es-PE-Standard-A';
        const speed = options.speed || 1.0;
        
        try {
            const response = await fetch('/api/voice/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice, speed })
            });
            
            const data = await response.json();
            
            if (data.method === 'google_tts') {
                await this.playGoogleAudio(data.audio);
            } else {
                this.playWebSpeech(text, speed);
            }
            
        } catch (error) {
            console.error('[TTS] Error:', error);
            this.playWebSpeech(text, speed);
        }
    }
    
    async playGoogleAudio(base64Audio) {
        return new Promise((resolve, reject) => {
            const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
            audio.onended = resolve;
            audio.onerror = reject;
            audio.play();
        });
    }
    
    playWebSpeech(text, speed) {
        if (!('speechSynthesis' in window)) return;
        
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-PE';
        utterance.rate = speed;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        
        const voices = window.speechSynthesis.getVoices();
        const spanishVoice = voices.find(v => v.lang.startsWith('es'));
        if (spanishVoice) utterance.voice = spanishVoice;
        
        window.speechSynthesis.speak(utterance);
    }
    
    stop() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }
}

// Instancia global
window.ttsClient = new TTSClient();