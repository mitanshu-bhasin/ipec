// loader.js - Component injection utility

/**
 * Load an HTML component from a file and inject it into the specified element.
 * @param {string} elementId - The ID of the placeholder element
 * @param {string} componentPath - Path to the HTML component file
 * @returns {Promise<void>}
 */
async function loadComponent(elementId, componentPath) {
    const el = document.getElementById(elementId);
    if (!el) {
        console.warn(`[loader.js] Element #${elementId} not found, skipping component load.`);
        return;
    }
    try {
        const res = await fetch(componentPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        el.innerHTML = await res.text();
    } catch (err) {
        console.error(`[loader.js] Failed to load component "${componentPath}":`, err);
    }
}
