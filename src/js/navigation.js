/**
 * navigation.js — Mode panel switching with animated segment toggle
 * Sell tab uses theme-blue instead of red
 */
const Navigation = (() => {
    const modes = ['sell', 'barcode', 'stocks'];
    const colors = {
        sell: '#2c4284',
        barcode: '#3498db',
        stocks: '#27ae60'
    };
    let activeMode = 'sell';

    function init() {
        const btns = document.querySelectorAll('.segment-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => switchMode(btn.dataset.mode));
        });
        activeMode = document.querySelector('.segment-btn.active')?.dataset.mode || 'sell';
        document.documentElement.style.setProperty('--accent-active', colors[activeMode]);
        updateSlider(activeMode);
    }

    function switchMode(mode) {
        if (!modes.includes(mode) || mode === activeMode) return;

        activeMode = mode;

        document.querySelectorAll('.segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        document.querySelectorAll('.mode-panel').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.mode === mode);
        });

        document.documentElement.style.setProperty('--accent-active', colors[mode]);
        updateSlider(mode);
    }

    function updateSlider(mode) {
        const slider = document.querySelector('.segment-slider');
        const activeBtn = document.querySelector(`.segment-btn[data-mode="${mode}"]`);
        if (!slider || !activeBtn) return;

        const parent = activeBtn.parentElement;
        const parentRect = parent.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();

        slider.style.width = btnRect.width + 'px';
        slider.style.transform = `translate3d(${btnRect.left - parentRect.left - 3}px, 0, 0)`;
        slider.style.background = colors[mode];
    }

    return { init, switchMode };
})();
