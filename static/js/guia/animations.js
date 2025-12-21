/**
 * BODEGA INTELIGENTE - Navigation & Animations Module
 */

const Navigation = {
    init() {
        this.setupSmoothScrolling();
        this.setupIntersectionObserver();
        this.setupKeyboardNavigation();
    },
    
    setupSmoothScrolling() {
        // Smooth scroll for all internal links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(anchor.getAttribute('href'));
                
                if (target) {
                    const offset = 80;
                    const top = target.offsetTop - offset;
                    
                    window.scrollTo({
                        top,
                        behavior: 'smooth'
                    });
                }
            });
        });
    },
    
    setupIntersectionObserver() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('in-view');
                }
            });
        }, observerOptions);
        
        // Observe animated elements
        document.querySelectorAll('[class*="animate-"]').forEach(el => {
            observer.observe(el);
        });
        
        // Observe sections for active state
        document.querySelectorAll('.section[data-section]').forEach(section => {
            observer.observe(section);
        });
    },
    
    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Arrow keys for navigation
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (e.key === 'ArrowDown' || e.key === 'PageDown') {
                e.preventDefault();
                this.scrollToNextSection();
            } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault();
                this.scrollToPreviousSection();
            } else if (e.key === 'Home') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                window.scrollTo({
                    top: document.documentElement.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    },
    
    scrollToNextSection() {
        const sections = Array.from(document.querySelectorAll('.section'));
        const currentScroll = window.scrollY + window.innerHeight / 2;
        
        const nextSection = sections.find(section => {
            return section.offsetTop > currentScroll;
        });
        
        if (nextSection) {
            const offset = 80;
            window.scrollTo({
                top: nextSection.offsetTop - offset,
                behavior: 'smooth'
            });
        }
    },
    
    scrollToPreviousSection() {
        const sections = Array.from(document.querySelectorAll('.section')).reverse();
        const currentScroll = window.scrollY + window.innerHeight / 2;
        
        const previousSection = sections.find(section => {
            return section.offsetTop + section.offsetHeight < currentScroll;
        });
        
        if (previousSection) {
            const offset = 80;
            window.scrollTo({
                top: previousSection.offsetTop - offset,
                behavior: 'smooth'
            });
        }
    }
};

const Animations = {
    init() {
        this.setupAnimationTriggers();
        this.setupParallaxEffects();
    },
    
    setupAnimationTriggers() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animationPlayState = 'running';
                    entry.target.classList.add('animated');
                }
            });
        }, {
            threshold: 0.1
        });
        
        document.querySelectorAll('[class*="animate-"]').forEach(el => {
            el.style.animationPlayState = 'paused';
            observer.observe(el);
        });
    },
    
    setupParallaxEffects() {
        let ticking = false;
        
        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    this.updateParallax();
                    ticking = false;
                });
                ticking = true;
            }
        });
    },
    
    updateParallax() {
        const scrolled = window.scrollY;
        
        // Hero background parallax
        const heroBackground = document.querySelector('.hero-background');
        if (heroBackground) {
            heroBackground.style.transform = `translateY(${scrolled * 0.5}px)`;
        }
        
        // Stats parallax
        const statCards = document.querySelectorAll('.stat-card');
        statCards.forEach((card, index) => {
            const speed = 0.1 + (index * 0.05);
            card.style.transform = `translateY(${scrolled * speed}px)`;
        });
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        Navigation.init();
        Animations.init();
    });
} else {
    Navigation.init();
    Animations.init();
}

window.Navigation = Navigation;
window.Animations = Animations;
