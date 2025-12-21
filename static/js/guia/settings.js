/**
 * BODEGA INTELIGENTE - Settings Module
 * Font, theme, and reading preferences
 */

const Settings = {
    init() {
        this.setupEventListeners();
        this.loadSettings();
    },

    setupEventListeners() {
        // Font settings toggle
        const fontSettingsToggle = document.getElementById('font-settings-toggle');
        const fontSettingsClose = document.getElementById('font-settings-close');
        const settingsPanel = document.getElementById('font-settings-panel');
        
        if (fontSettingsToggle) {
            fontSettingsToggle.addEventListener('click', () => {
                settingsPanel?.classList.toggle('active');
                document.getElementById('modal-overlay')?.classList.toggle('active');
            });
        }
        
        if (fontSettingsClose) {
            fontSettingsClose.addEventListener('click', () => {
                settingsPanel?.classList.remove('active');
                document.getElementById('modal-overlay')?.classList.remove('active');
            });
        }

        // Font size controls
        const sizeBtns = document.querySelectorAll('.size-btn');
        sizeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const size = btn.getAttribute('data-size');
                this.setFontSize(size);
                
                sizeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Font family select
        const fontFamilySelect = document.getElementById('font-family-select');
        if (fontFamilySelect) {
            fontFamilySelect.addEventListener('change', (e) => {
                this.setFontFamily(e.target.value);
            });
        }

        // Line height select
        const lineHeightSelect = document.getElementById('line-height-select');
        if (lineHeightSelect) {
            lineHeightSelect.addEventListener('change', (e) => {
                this.setLineHeight(e.target.value);
            });
        }

        // Content width select
        const contentWidthSelect = document.getElementById('content-width-select');
        if (contentWidthSelect) {
            contentWidthSelect.addEventListener('change', (e) => {
                this.setContentWidth(e.target.value);
            });
        }
    },

    loadSettings() {
        if (!window.App) return;
        
        const settings = window.App.state.settings;
        
        // Apply font size
        const sizeBtn = document.querySelector(`[data-size="${settings.fontSize}"]`);
        if (sizeBtn) {
            document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
            sizeBtn.classList.add('active');
        }
        
        // Apply font family
        const fontFamilySelect = document.getElementById('font-family-select');
        if (fontFamilySelect) {
            fontFamilySelect.value = settings.fontFamily;
        }
        
        // Apply line height
        const lineHeightSelect = document.getElementById('line-height-select');
        if (lineHeightSelect) {
            lineHeightSelect.value = settings.lineHeight;
        }
        
        // Apply content width
        const contentWidthSelect = document.getElementById('content-width-select');
        if (contentWidthSelect) {
            contentWidthSelect.value = settings.contentWidth;
        }
    },

    setFontSize(size) {
        document.body.setAttribute('data-font-size', size);
        
        if (window.App) {
            window.App.state.settings.fontSize = size;
            window.App.saveState();
        }
    },

    setFontFamily(family) {
        document.body.setAttribute('data-font-family', family);
        
        if (window.App) {
            window.App.state.settings.fontFamily = family;
            window.App.saveState();
        }
    },

    setLineHeight(lineHeight) {
        document.body.setAttribute('data-reading-mode', lineHeight);
        
        if (window.App) {
            window.App.state.settings.lineHeight = lineHeight;
            window.App.saveState();
        }
    },

    setContentWidth(width) {
        document.body.setAttribute('data-content-width', width);
        
        if (window.App) {
            window.App.state.settings.contentWidth = width;
            window.App.saveState();
        }
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Settings.init());
} else {
    Settings.init();
}

window.Settings = Settings;
