/* ═══════════════════════════════════════════
   내벨업챌린지 — Scoped JavaScript (.cl)
   ═══════════════════════════════════════════ */

function initChallengeSection() {
    initCLScrollAnimations();
    initCLCarousel();
}

/* ─── Scroll Fade-In Animations ─── */
function initCLScrollAnimations() {
    const elements = document.querySelectorAll('.cl .cl-fade-in');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const siblings = entry.target.parentElement.querySelectorAll('.cl-fade-in');
                let delay = 0;
                siblings.forEach((sib, i) => {
                    if (sib === entry.target) {
                        delay = i * 80;
                    }
                });

                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, Math.min(delay, 400));

                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px'
    });

    elements.forEach(el => observer.observe(el));
}

/* ─── Reviews Carousel ─── */
function initCLCarousel() {
    const track = document.getElementById('clReviewsTrack');
    const prevBtn = document.getElementById('clCarouselPrev');
    const nextBtn = document.getElementById('clCarouselNext');

    if (!track || !prevBtn || !nextBtn) return;

    let currentIndex = 0;
    const cards = track.querySelectorAll('.review-card');
    const totalCards = cards.length;

    let isDragging = false;
    let startX = 0;
    let currentX = 0;
    let dragOffset = 0;

    function getVisibleCards() {
        return window.innerWidth <= 768 ? 1 : 2;
    }

    function getMaxIndex() {
        return Math.max(0, totalCards - getVisibleCards());
    }

    function updateCarousel(animate) {
        if (animate === undefined) animate = true;
        const visibleCards = getVisibleCards();
        const gap = 16;
        const trackWidth = track.parentElement.offsetWidth;
        const cardWidth = (trackWidth - (visibleCards - 1) * gap) / visibleCards;

        cards.forEach(function(card) {
            card.style.flex = '0 0 ' + cardWidth + 'px';
        });

        const offset = -currentIndex * (cardWidth + gap);

        track.style.transition = animate
            ? 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)'
            : 'none';

        track.style.transform = 'translateX(' + (offset + dragOffset) + 'px)';

        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex >= getMaxIndex();
    }

    prevBtn.addEventListener('click', function() {
        if (currentIndex > 0) { currentIndex--; updateCarousel(); }
    });

    nextBtn.addEventListener('click', function() {
        if (currentIndex < getMaxIndex()) { currentIndex++; updateCarousel(); }
    });

    // Touch events
    track.addEventListener('touchstart', function(e) {
        isDragging = true;
        startX = e.touches[0].clientX;
        track.style.transition = 'none';
    }, { passive: true });

    track.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        dragOffset = currentX - startX;
        updateCarousel(false);
    }, { passive: true });

    track.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        if (Math.abs(dragOffset) > 60) {
            if (dragOffset < 0 && currentIndex < getMaxIndex()) currentIndex++;
            else if (dragOffset > 0 && currentIndex > 0) currentIndex--;
        }
        dragOffset = 0;
        updateCarousel(true);
    });

    // Mouse drag
    track.addEventListener('mousedown', function(e) {
        isDragging = true;
        startX = e.clientX;
        track.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        currentX = e.clientX;
        dragOffset = currentX - startX;
        updateCarousel(false);
    });

    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        isDragging = false;
        if (Math.abs(dragOffset) > 60) {
            if (dragOffset < 0 && currentIndex < getMaxIndex()) currentIndex++;
            else if (dragOffset > 0 && currentIndex > 0) currentIndex--;
        }
        dragOffset = 0;
        updateCarousel(true);
    });

    // Resize
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            currentIndex = Math.min(currentIndex, getMaxIndex());
            updateCarousel(false);
        }, 100);
    });

    updateCarousel(false);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChallengeSection);
} else {
    initChallengeSection();
}
