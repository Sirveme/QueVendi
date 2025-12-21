/**
 * BODEGA INTELIGENTE - Quiz Module
 * Diagnostic quiz for business assessment
 */

const Quiz = {
    questions: [
        {
            id: 1,
            question: '¿Cuántos clientes atienden tu bodega en promedio por día?',
            options: [
                { text: 'Menos de 20 clientes', value: 1 },
                { text: 'Entre 20 y 50 clientes', value: 2 },
                { text: 'Entre 50 y 100 clientes', value: 3 },
                { text: 'Más de 100 clientes', value: 4 }
            ]
        },
        {
            id: 2,
            question: '¿Cómo controlas tu inventario actualmente?',
            options: [
                { text: 'No llevo control', value: 1 },
                { text: 'En cuaderno o papel', value: 2 },
                { text: 'En Excel o similar', value: 3 },
                { text: 'Con un sistema POS', value: 4 }
            ]
        },
        {
            id: 3,
            question: '¿Tienes productos organizados por categorías visibles?',
            options: [
                { text: 'No, están mezclados', value: 1 },
                { text: 'Parcialmente organizados', value: 2 },
                { text: 'Sí, bien organizados', value: 3 },
                { text: 'Sí, con señalización clara', value: 4 }
            ]
        },
        {
            id: 4,
            question: '¿Qué porcentaje de tus clientes son recurrentes?',
            options: [
                { text: 'Menos del 30%', value: 1 },
                { text: 'Entre 30% y 50%', value: 2 },
                { text: 'Entre 50% y 70%', value: 3 },
                { text: 'Más del 70%', value: 4 }
            ]
        },
        {
            id: 5,
            question: '¿Sabes cuál es tu margen de ganancia promedio?',
            options: [
                { text: 'No lo sé', value: 1 },
                { text: 'Tengo una idea aproximada', value: 2 },
                { text: 'Sí, lo calculo mensualmente', value: 3 },
                { text: 'Sí, lo monitoreo diariamente', value: 4 }
            ]
        },
        {
            id: 6,
            question: '¿Ofreces opciones de pago digital (Yape, Plin, etc.)?',
            options: [
                { text: 'No, solo efectivo', value: 1 },
                { text: 'Estoy considerándolo', value: 2 },
                { text: 'Sí, pero pocos lo usan', value: 3 },
                { text: 'Sí, y es muy usado', value: 4 }
            ]
        },
        {
            id: 7,
            question: '¿Conoces cuáles son tus productos más rentables?',
            options: [
                { text: 'No lo sé con certeza', value: 1 },
                { text: 'Creo saber algunos', value: 2 },
                { text: 'Sí, conozco los principales', value: 3 },
                { text: 'Sí, tengo un análisis detallado', value: 4 }
            ]
        },
        {
            id: 8,
            question: '¿Haces promociones o ofertas regularmente?',
            options: [
                { text: 'Nunca o casi nunca', value: 1 },
                { text: 'Ocasionalmente', value: 2 },
                { text: 'Sí, semanalmente', value: 3 },
                { text: 'Sí, con estrategia planificada', value: 4 }
            ]
        }
    ],
    
    currentQuestion: 0,
    answers: [],
    
    init() {
        this.renderQuestion();
        this.setupEventListeners();
    },
    
    setupEventListeners() {
        const nextBtn = document.getElementById('quiz-next');
        const prevBtn = document.getElementById('quiz-prev');
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextQuestion());
        }
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.prevQuestion());
        }
    },
    
    renderQuestion() {
        const container = document.querySelector('.quiz-container');
        if (!container) return;
        
        const question = this.questions[this.currentQuestion];
        
        container.innerHTML = `
            <div class="quiz-question" data-question="${question.id}">
                <h3 class="quiz-question-title">${question.question}</h3>
                <div class="quiz-options">
                    ${question.options.map((option, index) => `
                        <label class="quiz-option ${this.answers[this.currentQuestion] === index ? 'selected' : ''}">
                            <input type="radio" 
                                   name="question-${question.id}" 
                                   value="${index}"
                                   ${this.answers[this.currentQuestion] === index ? 'checked' : ''}>
                            <span class="option-text">${option.text}</span>
                            <span class="option-check">✓</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Add styles for quiz options
        const style = document.createElement('style');
        style.textContent = `
            .quiz-question-title {
                font-size: var(--font-size-xl);
                font-weight: 600;
                color: var(--text-primary);
                margin-bottom: var(--spacing-xl);
                text-align: center;
            }
            
            .quiz-options {
                display: flex;
                flex-direction: column;
                gap: var(--spacing-md);
            }
            
            .quiz-option {
                position: relative;
                display: flex;
                align-items: center;
                padding: var(--spacing-lg);
                background: var(--bg-card);
                border: 2px solid var(--border-subtle);
                border-radius: var(--radius-lg);
                cursor: pointer;
                transition: all var(--transition-fast);
            }
            
            .quiz-option:hover {
                background: var(--bg-tertiary);
                border-color: rgba(59, 130, 246, 0.5);
            }
            
            .quiz-option.selected {
                background: rgba(59, 130, 246, 0.1);
                border-color: var(--accent-primary);
            }
            
            .quiz-option input[type="radio"] {
                position: absolute;
                opacity: 0;
                cursor: pointer;
            }
            
            .option-text {
                flex: 1;
                font-size: var(--font-size-base);
                color: var(--text-secondary);
                padding-left: var(--spacing-xl);
            }
            
            .quiz-option.selected .option-text {
                color: var(--text-primary);
                font-weight: 500;
            }
            
            .option-check {
                position: absolute;
                left: var(--spacing-lg);
                width: 24px;
                height: 24px;
                border: 2px solid var(--border-medium);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: transparent;
                font-size: var(--font-size-sm);
                transition: all var(--transition-fast);
            }
            
            .quiz-option.selected .option-check {
                background: var(--accent-primary);
                border-color: var(--accent-primary);
                color: white;
            }
        `;
        
        if (!document.getElementById('quiz-styles')) {
            style.id = 'quiz-styles';
            document.head.appendChild(style);
        }
        
        // Add event listeners to options
        const options = container.querySelectorAll('.quiz-option');
        options.forEach((option, index) => {
            option.addEventListener('click', () => {
                this.selectOption(index);
            });
        });
        
        // Update navigation buttons
        this.updateNavigation();
        
        // Update progress
        this.updateProgress();
    },
    
    selectOption(index) {
        this.answers[this.currentQuestion] = index;
        
        const options = document.querySelectorAll('.quiz-option');
        options.forEach((opt, i) => {
            if (i === index) {
                opt.classList.add('selected');
            } else {
                opt.classList.remove('selected');
            }
        });
        
        // Enable next button
        const nextBtn = document.getElementById('quiz-next');
        if (nextBtn) {
            nextBtn.disabled = false;
        }
    },
    
    nextQuestion() {
        if (this.answers[this.currentQuestion] === undefined) {
            return;
        }
        
        if (this.currentQuestion < this.questions.length - 1) {
            this.currentQuestion++;
            this.renderQuestion();
        } else {
            this.showResult();
        }
    },
    
    prevQuestion() {
        if (this.currentQuestion > 0) {
            this.currentQuestion--;
            this.renderQuestion();
        }
    },
    
    updateNavigation() {
        const nextBtn = document.getElementById('quiz-next');
        const prevBtn = document.getElementById('quiz-prev');
        
        if (prevBtn) {
            prevBtn.disabled = this.currentQuestion === 0;
        }
        
        if (nextBtn) {
            nextBtn.disabled = this.answers[this.currentQuestion] === undefined;
            
            if (this.currentQuestion === this.questions.length - 1) {
                nextBtn.textContent = 'Ver Resultado';
            } else {
                nextBtn.textContent = 'Siguiente';
            }
        }
    },
    
    updateProgress() {
        const progressFill = document.querySelector('.quiz-progress-fill');
        const currentQuestionEl = document.getElementById('current-question');
        
        const progress = ((this.currentQuestion + 1) / this.questions.length) * 100;
        
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
        
        if (currentQuestionEl) {
            currentQuestionEl.textContent = this.currentQuestion + 1;
        }
    },
    
    calculateScore() {
        let total = 0;
        this.answers.forEach((answerIndex, questionIndex) => {
            const question = this.questions[questionIndex];
            total += question.options[answerIndex].value;
        });
        return total;
    },
    
    showResult() {
        const score = this.calculateScore();
        const maxScore = this.questions.length * 4;
        const percentage = (score / maxScore) * 100;
        
        let level, title, description, recommendations, color;
        
        if (percentage < 40) {
            level = 'Inicial';
            title = 'Tu bodega tiene mucho potencial de crecimiento';
            description = 'Estás en la etapa inicial, pero eso significa que tienes muchas oportunidades de mejora rápida. Con pequeños cambios, puedes ver resultados importantes.';
            recommendations = [
                'Comienza implementando las 5 acciones mínimas',
                'Organiza tus productos por categorías',
                'Inicia un control básico de inventario',
                'Enfócate en la limpieza y orden visual'
            ];
            color = '#ef4444';
        } else if (percentage < 60) {
            level = 'En Desarrollo';
            title = 'Vas por buen camino, ¡sigue adelante!';
            description = 'Tienes una base sólida. Con algunas mejoras estratégicas, puedes duplicar tus resultados actuales.';
            recommendations = [
                'Implementa un sistema de control de inventario',
                'Analiza tus productos más rentables',
                'Crea promociones estratégicas',
                'Considera opciones de pago digital'
            ];
            color = '#f59e0b';
        } else if (percentage < 80) {
            level = 'Avanzado';
            title = 'Tu bodega está bien gestionada';
            description = 'Estás haciendo muchas cosas bien. Ahora es momento de optimizar y profesionalizar aún más tu negocio.';
            recommendations = [
                'Implementa un sistema POS completo',
                'Desarrolla programas de fidelización',
                'Optimiza tu layout y exhibición',
                'Analiza datos para decisiones estratégicas'
            ];
            color = '#3b82f6';
        } else {
            level = 'Experto';
            title = '¡Excelente! Tu bodega es un modelo a seguir';
            description = 'Tienes una gestión profesional. Sigue innovando y considera expandir tu negocio o ayudar a otros bodegueros.';
            recommendations = [
                'Comparte tu experiencia con otros',
                'Explora nuevas categorías de productos',
                'Considera abrir una segunda ubicación',
                'Implementa análisis predictivo de ventas'
            ];
            color = '#10b981';
        }
        
        const container = document.querySelector('.quiz-container');
        const navigation = document.querySelector('.quiz-navigation');
        const result = document.getElementById('quiz-result');
        
        if (container) container.style.display = 'none';
        if (navigation) navigation.style.display = 'none';
        
        if (result) {
            result.style.display = 'block';
            result.innerHTML = `
                <div class="result-card">
                    <div class="result-score" style="background: linear-gradient(135deg, ${color}, ${color}dd);">
                        <div class="score-circle">
                            <svg width="120" height="120" viewBox="0 0 120 120">
                                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="8"/>
                                <circle cx="60" cy="60" r="54" fill="none" stroke="white" stroke-width="8"
                                        stroke-dasharray="${percentage * 3.39} 339.3"
                                        stroke-linecap="round"
                                        transform="rotate(-90 60 60)"
                                        style="transition: stroke-dasharray 1s ease"/>
                            </svg>
                            <div class="score-text">
                                <div class="score-number">${Math.round(percentage)}%</div>
                                <div class="score-label">${level}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="result-content">
                        <h3 class="result-title">${title}</h3>
                        <p class="result-description">${description}</p>
                        
                        <div class="result-recommendations">
                            <h4>Recomendaciones para ti:</h4>
                            <ul>
                                ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
                            </ul>
                        </div>
                        
                        <div class="result-actions">
                            <a href="#minimo-hoy" class="btn btn-primary btn-large">
                                Comenzar Mejoras
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"/>
                                </svg>
                            </a>
                            <button class="btn btn-secondary btn-large" onclick="location.reload()">
                                Repetir Diagnóstico
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // Add result styles
            const style = document.createElement('style');
            style.textContent = `
                .result-card {
                    background: var(--bg-card);
                    border: var(--border-subtle);
                    border-radius: var(--radius-xl);
                    overflow: hidden;
                }
                
                .result-score {
                    padding: var(--spacing-3xl);
                    text-align: center;
                }
                
                .score-circle {
                    position: relative;
                    display: inline-block;
                }
                
                .score-text {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                }
                
                .score-number {
                    font-size: 2.5rem;
                    font-weight: 800;
                    color: white;
                    line-height: 1;
                }
                
                .score-label {
                    font-size: var(--font-size-sm);
                    color: rgba(255, 255, 255, 0.9);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-top: var(--spacing-xs);
                }
                
                .result-content {
                    padding: var(--spacing-2xl);
                }
                
                .result-title {
                    font-size: var(--font-size-2xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: var(--spacing-md);
                    text-align: center;
                }
                
                .result-description {
                    font-size: var(--font-size-lg);
                    color: var(--text-secondary);
                    text-align: center;
                    margin-bottom: var(--spacing-2xl);
                    line-height: var(--line-height-relaxed);
                }
                
                .result-recommendations {
                    padding: var(--spacing-xl);
                    background: var(--bg-tertiary);
                    border-radius: var(--radius-lg);
                    margin-bottom: var(--spacing-xl);
                }
                
                .result-recommendations h4 {
                    font-size: var(--font-size-lg);
                    font-weight: 600;
                    color: var(--accent-primary);
                    margin-bottom: var(--spacing-md);
                }
                
                .result-recommendations ul {
                    list-style: none;
                }
                
                .result-recommendations li {
                    position: relative;
                    padding-left: var(--spacing-xl);
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                }
                
                .result-recommendations li::before {
                    content: '→';
                    position: absolute;
                    left: 0;
                    color: var(--accent-primary);
                    font-weight: bold;
                }
                
                .result-actions {
                    display: flex;
                    gap: var(--spacing-md);
                    flex-wrap: wrap;
                }
                
                .result-actions .btn {
                    flex: 1;
                    min-width: 200px;
                }
            `;
            
            if (!document.getElementById('result-styles')) {
                style.id = 'result-styles';
                document.head.appendChild(style);
            }
        }
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Quiz.init());
} else {
    Quiz.init();
}

window.Quiz = Quiz;
