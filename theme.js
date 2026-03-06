
window.toggleTheme = function () {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    updateThemeIcons();
}

window.updateThemeIcons = function () {
    const theme = localStorage.getItem('theme') || 'light';
    const isDark = document.documentElement.classList.contains('dark');

    // Select all elements that are designated as theme icons
    const icons = document.querySelectorAll('.theme-toggle-icon');
    icons.forEach(icon => {
        // If it's an <i> tag
        if (icon.tagName === 'I') {
            if (isDark) {
                icon.classList.remove('fa-moon');
                icon.classList.add('fa-sun');
            } else {
                icon.classList.remove('fa-sun');
                icon.classList.add('fa-moon');
            }
        }
    });

    // Also update any text triggers if needed, though icons are standard
}

    // Initialize theme on load
    (function () {
        const savedTheme = localStorage.getItem('theme') || 'light'; // Default to light
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', updateThemeIcons);
        } else {
            updateThemeIcons();
        }
    })();
