/**
 * BODEGA INTELIGENTE - Main App
 * Core functionality and initialization
 */

// App state
const App = {
    state: {
        user: {
            name: 'Usuario',
            email: '',
            avatar: '',
            progress: {
                readingTime: 0,
                chaptersCompleted: 0,
                badgesEarned: 0,
                completedActions: []
            }
        },
        currentSection: 'hero',
        scrollPosition: 0,
        bookmarks: [],
        settings: {
            theme: 'dark',
            fontSize: 'medium',
            fontFamily: 'inter',
            lineHeight: 'comfortable',
            contentWidth: 'medium'
        }
    },

    init() {
        this.loadState();
        this.setupEventListeners();
        this.initializeComponents();
        this.startReadingTimer();
        this.hideLoader();
    },

    loadState() {
        // Load from localStorage
        const savedState = localStorage.getItem('bodegaInteligente');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                this.state = { ...this.state, ...parsed };
            } catch (e) {
                console.error('Error loading state:', e);
            }
        }

        // Apply saved settings
        this.applySettings();
    },

    saveState() {
        try {
            localStorage.setItem('bodegaInteligente', JSON.stringify(this.state));
        } catch (e) {
            console.error('Error saving state:', e);
        }
    },

    applySettings() {
        const { theme, fontSize, fontFamily, lineHeight, contentWidth } = this.state.settings;
        
        document.body.className = `theme-${theme}`;
        document.body.setAttribute('data-font-size', fontSize);
        document.body.setAttribute('data-font-family', fontFamily);
        document.body.setAttribute('data-reading-mode', lineHeight);
        document.body.setAttribute('data-content-width', contentWidth);
    },

    setupEventListeners() {
        // Scroll tracking
        window.addEventListener('scroll', this.handleScroll.bind(this));
        
        // Menu toggle
        const menuToggle = document.getElementById('menu-toggle');
        if (menuToggle) {
            menuToggle.addEventListener('click', () => this.toggleSidebar());
        }

        // Sidebar close
        const sidebarClose = document.querySelector('.sidebar-close');
        if (sidebarClose) {
            sidebarClose.addEventListener('click', () => this.closeSidebar());
        }

        // TOC navigation
        const tocItems = document.querySelectorAll('.toc-item');
        tocItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.getAttribute('data-section');
                this.navigateToSection(section);
            });
        });

        // Overlay click
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                this.closeSidebar();
                this.closeSettings();
            });
        }

        // Floating action buttons
        const fabTop = document.querySelector('.fab-top');
        if (fabTop) {
            fabTop.addEventListener('click', () => this.scrollToTop());
        }

        const fabBookmark = document.querySelector('.fab-bookmark');
        if (fabBookmark) {
            fabBookmark.addEventListener('click', () => this.saveBookmark());
        }

        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // Version selector
        const versionBtns = document.querySelectorAll('.version-btn');
        versionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const version = btn.getAttribute('data-version');
                this.switchVersion(version);
            });
        });

        // Action cards completion
        const actionCards = document.querySelectorAll('.action-card');
        actionCards.forEach(card => {
            const checkBtn = card.querySelector('.action-check-btn');
            if (checkBtn) {
                checkBtn.addEventListener('click', () => {
                    const actionId = card.getAttribute('data-action');
                    this.toggleActionCompletion(actionId, card);
                });
            }
        });

        // Feedback buttons
        const feedbackBtns = document.querySelectorAll('.feedback-btn');
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                feedbackBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                
                const feedbackComment = document.querySelector('.feedback-comment');
                if (feedbackComment) {
                    feedbackComment.classList.add('active');
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape key - close modals
            if (e.key === 'Escape') {
                this.closeSidebar();
                this.closeSettings();
            }
            
            // Ctrl/Cmd + K - toggle sidebar
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggleSidebar();
            }
        });
    },

    initializeComponents() {
        // Update user profile
        this.updateUserProfile();
        
        // Update progress stats
        this.updateProgressStats();
        
        // Restore action completions
        this.restoreActionCompletions();
        
        // Initialize intersection observer for animations
        this.initializeAnimations();
        
        // Update reading progress
        this.updateReadingProgress();
    },

    updateUserProfile() {
        const { name, avatar } = this.state.user;
        const userNameEl = document.querySelector('.user-name');
        const userAvatarEl = document.querySelector('.user-avatar');
        
        if (userNameEl) userNameEl.textContent = name;
        if (userAvatarEl && avatar) userAvatarEl.src = avatar;
    },

    updateProgressStats() {
        const { readingTime, chaptersCompleted, badgesEarned } = this.state.user.progress;
        
        const readingTimeEl = document.getElementById('reading-time');
        const chaptersEl = document.getElementById('chapters-completed');
        const badgesEl = document.getElementById('badges-earned');
        
        if (readingTimeEl) readingTimeEl.textContent = `${readingTime} min`;
        if (chaptersEl) chaptersEl.textContent = `${chaptersCompleted}/8`;
        if (badgesEl) badgesEl.textContent = `${badgesEarned}/12`;
    },

    restoreActionCompletions() {
        const { completedActions } = this.state.user.progress;
        
        completedActions.forEach(actionId => {
            const card = document.querySelector(`[data-action="${actionId}"]`);
            if (card) {
                card.classList.add('completed');
            }
        });
        
        this.updateActionTracker();
    },

    toggleActionCompletion(actionId, card) {
        const { completedActions } = this.state.user.progress;
        const index = completedActions.indexOf(actionId);
        
        if (index > -1) {
            completedActions.splice(index, 1);
            card.classList.remove('completed');
        } else {
            completedActions.push(actionId);
            card.classList.add('completed');
        }
        
        this.updateActionTracker();
        this.saveState();
    },

    updateActionTracker() {
        const { completedActions } = this.state.user.progress;
        const total = 5;
        const completed = completedActions.length;
        const percentage = (completed / total) * 100;
        
        const completedEl = document.getElementById('completed-actions');
        const trackerFill = document.querySelector('.tracker-fill');
        const trackerMessage = document.getElementById('tracker-message');
        
        if (completedEl) completedEl.textContent = completed;
        if (trackerFill) trackerFill.style.width = `${percentage}%`;
        
        if (trackerMessage) {
            if (completed === 0) {
                trackerMessage.textContent = '¡Comienza con la primera acción!';
            } else if (completed < total) {
                trackerMessage.textContent = `¡Excelente! Ya completaste ${completed} de ${total} acciones.`;
            } else {
                trackerMessage.textContent = '🎉 ¡Felicitaciones! Completaste todas las acciones del día.';
                trackerMessage.style.color = 'var(--accent-success)';
            }
        }
    },

    handleScroll() {
        const scrollY = window.scrollY;
        this.state.scrollPosition = scrollY;
        
        // Update reading progress
        this.updateReadingProgress();
        
        // Update active section
        this.updateActiveSection();
        
        // Show/hide navigation
        const nav = document.getElementById('main-nav');
        if (nav) {
            if (scrollY > this.state.scrollPosition && scrollY > 100) {
                nav.classList.add('hidden');
            } else {
                nav.classList.remove('hidden');
            }
        }
        
        this.state.scrollPosition = scrollY;
    },

    updateReadingProgress() {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = (window.scrollY / scrollHeight) * 100;
        
        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');
        
        if (progressFill) {
            progressFill.style.width = `${Math.min(scrollPercent, 100)}%`;
        }
        
        if (progressText) {
            progressText.textContent = `${Math.round(scrollPercent)}% completado`;
        }
    },

    updateActiveSection() {
        const sections = document.querySelectorAll('.section[data-section]');
        let activeSection = null;
        
        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            if (rect.top <= 200 && rect.bottom >= 200) {
                activeSection = section.getAttribute('data-section');
            }
        });
        
        if (activeSection && activeSection !== this.state.currentSection) {
            this.state.currentSection = activeSection;
            
            // Update TOC
            const tocItems = document.querySelectorAll('.toc-item');
            tocItems.forEach(item => {
                if (item.getAttribute('data-section') === activeSection) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }
    },

    navigateToSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            const offset = 80;
            const top = section.offsetTop - offset;
            window.scrollTo({ top, behavior: 'smooth' });
            this.closeSidebar();
        }
    },

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('modal-overlay');
        
        if (sidebar && overlay) {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        }
    },

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('modal-overlay');
        
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    },

    closeSettings() {
        const settingsPanel = document.getElementById('font-settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.remove('active');
        }
    },

    toggleTheme() {
        const currentTheme = this.state.settings.theme;
        const newTheme = currentTheme === 'dark' ? 'semi-dark' : 'dark';
        
        this.state.settings.theme = newTheme;
        document.body.className = `theme-${newTheme}`;
        
        this.saveState();
    },

    switchVersion(version) {
        const versionBtns = document.querySelectorAll('.version-btn');
        const versionContents = document.querySelectorAll('.chapter-content');
        
        versionBtns.forEach(btn => {
            if (btn.getAttribute('data-version') === version) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        versionContents.forEach(content => {
            if (content.getAttribute('data-version') === version) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    },

    saveBookmark() {
        const currentSection = this.state.currentSection;
        const bookmark = {
            section: currentSection,
            timestamp: new Date().toISOString(),
            scrollPosition: window.scrollY
        };
        
        this.state.bookmarks.push(bookmark);
        this.saveState();
        
        // Show notification
        this.showNotification('📚 Marcador guardado');
    },

    showNotification(message, duration = 3000) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 100px;
            right: 24px;
            padding: 16px 24px;
            background: var(--bg-elevated);
            border: var(--border-medium);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-xl);
            z-index: 10000;
            animation: slideLeft 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideRight 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    },

    startReadingTimer() {
        setInterval(() => {
            this.state.user.progress.readingTime++;
            this.updateProgressStats();
            
            // Save every 5 minutes
            if (this.state.user.progress.readingTime % 5 === 0) {
                this.saveState();
            }
        }, 60000); // Every minute
    },

    initializeAnimations() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -100px 0px'
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);
        
        const animatedElements = document.querySelectorAll('[class*="animate-"]');
        animatedElements.forEach(el => observer.observe(el));
    },

    hideLoader() {
        setTimeout(() => {
            const loader = document.getElementById('app-loader');
            if (loader) {
                loader.classList.add('hidden');
                setTimeout(() => loader.remove(), 500);
            }
        }, 1500);
    }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

// Export for use in other modules
window.App = App;
