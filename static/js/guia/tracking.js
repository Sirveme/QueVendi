/**
 * BODEGA INTELIGENTE - Tracking Module
 * User analytics and engagement tracking
 */

const Tracking = {
    events: [],
    sessionStart: Date.now(),
    
    init() {
        this.trackPageView();
        this.setupEventTracking();
        this.trackEngagement();
    },
    
    trackPageView() {
        this.logEvent('page_view', {
            path: window.location.pathname,
            title: document.title,
            timestamp: new Date().toISOString()
        });
    },
    
    setupEventTracking() {
        // Track section views
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const section = entry.target.getAttribute('data-section');
                    this.logEvent('section_view', {
                        section,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        }, { threshold: 0.5 });
        
        document.querySelectorAll('[data-section]').forEach(section => {
            observer.observe(section);
        });
        
        // Track button clicks
        document.addEventListener('click', (e) => {
            const button = e.target.closest('button, a.btn');
            if (button) {
                this.logEvent('button_click', {
                    text: button.textContent.trim(),
                    type: button.tagName,
                    timestamp: new Date().toISOString()
                });
            }
        });
    },
    
    trackEngagement() {
        // Track time on page
        window.addEventListener('beforeunload', () => {
            const sessionDuration = Date.now() - this.sessionStart;
            this.logEvent('session_end', {
                duration: sessionDuration,
                timestamp: new Date().toISOString()
            });
            
            // Save events before leaving
            this.saveEvents();
        });
        
        // Track scroll depth
        let maxScroll = 0;
        window.addEventListener('scroll', () => {
            const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
            if (scrollPercent > maxScroll) {
                maxScroll = scrollPercent;
                
                if (maxScroll >= 25 && maxScroll < 50) {
                    this.logEvent('scroll_depth', { depth: '25%' });
                } else if (maxScroll >= 50 && maxScroll < 75) {
                    this.logEvent('scroll_depth', { depth: '50%' });
                } else if (maxScroll >= 75 && maxScroll < 100) {
                    this.logEvent('scroll_depth', { depth: '75%' });
                } else if (maxScroll >= 100) {
                    this.logEvent('scroll_depth', { depth: '100%' });
                }
            }
        });
    },
    
    logEvent(eventName, data = {}) {
        const event = {
            name: eventName,
            data,
            timestamp: Date.now()
        };
        
        this.events.push(event);
        console.log('Event tracked:', event);
        
        // Periodically save events
        if (this.events.length >= 10) {
            this.saveEvents();
        }
    },
    
    saveEvents() {
        try {
            const savedEvents = localStorage.getItem('bodegaInteligente_tracking') || '[]';
            const allEvents = JSON.parse(savedEvents).concat(this.events);
            
            // Keep only last 100 events
            const recentEvents = allEvents.slice(-100);
            localStorage.setItem('bodegaInteligente_tracking', JSON.stringify(recentEvents));
            
            this.events = [];
        } catch (e) {
            console.error('Error saving events:', e);
        }
    },
    
    getAnalytics() {
        try {
            const events = JSON.parse(localStorage.getItem('bodegaInteligente_tracking') || '[]');
            
            return {
                totalEvents: events.length,
                eventTypes: this.groupBy(events, 'name'),
                recentEvents: events.slice(-10)
            };
        } catch (e) {
            console.error('Error getting analytics:', e);
            return null;
        }
    },
    
    groupBy(array, key) {
        return array.reduce((result, item) => {
            const group = item[key];
            result[group] = result[group] || [];
            result[group].push(item);
            return result;
        }, {});
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Tracking.init());
} else {
    Tracking.init();
}

window.Tracking = Tracking;
