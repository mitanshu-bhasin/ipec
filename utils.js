
class CustomModal {
    constructor() {
        this.init();
    }

    init() {
        if (!document.getElementById('custom-modal-overlay')) {
            const modalHTML = `
            <div id="custom-modal-overlay" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] hidden flex items-center justify-center p-4 transition-opacity duration-300 opacity-0">
                <div id="custom-modal-box" class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center transform scale-95 transition-transform duration-300">
                    <div id="custom-modal-icon" class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm"></div>
                    <h3 id="custom-modal-title" class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2"></h3>
                    <p id="custom-modal-message" class="text-sm text-slate-500 dark:text-slate-400 mb-6"></p>
                    
                    <div id="custom-modal-input-container" class="hidden mb-6">
                        <input type="text" id="custom-modal-input" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-slate-200" placeholder="Type here...">
                    </div>

                    <div id="custom-modal-actions" class="flex gap-3 justify-center">
                        <button id="custom-modal-cancel" class="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 py-2.5 rounded-xl text-sm font-bold transition hidden">Cancel</button>
                        <button id="custom-modal-confirm" class="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white py-2.5 rounded-xl text-sm font-bold transition shadow-lg shadow-blue-200 dark:shadow-none">OK</button>
                    </div>
                </div>
            </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        this.overlay = document.getElementById('custom-modal-overlay');
        this.box = document.getElementById('custom-modal-box');
        this.title = document.getElementById('custom-modal-title');
        this.message = document.getElementById('custom-modal-message');
        this.inputContainer = document.getElementById('custom-modal-input-container');
        this.input = document.getElementById('custom-modal-input');
        this.icon = document.getElementById('custom-modal-icon');
        this.cancelBtn = document.getElementById('custom-modal-cancel');
        this.confirmBtn = document.getElementById('custom-modal-confirm');
    }

    show(type, title, message, hasInput = false, confirmText = 'OK', cancelText = 'Cancel', iconClass = 'fa-info') {
        return new Promise((resolve) => {
            // Reset state
            this.inputContainer.classList.add('hidden');
            this.cancelBtn.classList.add('hidden');
            this.input.value = '';

            // Set Content
            this.title.textContent = title;
            this.message.textContent = message;
            this.confirmBtn.textContent = confirmText;
            this.cancelBtn.textContent = cancelText;

            // Icon Styling
            this.icon.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm ' +
                (type === 'error' ? 'bg-red-50 text-red-500' :
                    type === 'success' ? 'bg-green-50 text-green-500' :
                        type === 'warning' ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-500');

            this.icon.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

            // Input Logic
            if (hasInput) {
                this.inputContainer.classList.remove('hidden');
                setTimeout(() => this.input.focus(), 100);
            }

            // Buttons
            if (type === 'confirm' || type === 'prompt') {
                this.cancelBtn.classList.remove('hidden');
            }

            // Event Handlers
            const handleConfirm = () => {
                close();
                resolve(hasInput ? this.input.value : true);
            };

            const handleCancel = () => {
                close();
                resolve(hasInput ? null : false);
            };

            const close = () => {
                this.overlay.classList.remove('opacity-100');
                this.box.classList.remove('scale-100');
                this.box.classList.add('scale-95');
                setTimeout(() => {
                    this.overlay.classList.add('hidden');
                    this.confirmBtn.removeEventListener('click', handleConfirm);
                    this.cancelBtn.removeEventListener('click', handleCancel);
                    this.input.onkeydown = null;
                }, 300);
            };

            this.confirmBtn.onclick = handleConfirm;
            this.cancelBtn.onclick = handleCancel;

            if (hasInput) {
                this.input.onkeydown = (e) => {
                    if (e.key === 'Enter') handleConfirm();
                    if (e.key === 'Escape') handleCancel();
                };
            }

            // Show
            this.overlay.classList.remove('hidden');
            // Force reflow
            void this.overlay.offsetWidth;
            this.overlay.classList.add('opacity-100');
            this.box.classList.remove('scale-95');
            this.box.classList.add('scale-100');
        });
    }
}

const modalSystem = new CustomModal();

// Window overrides
window.alert = async (message) => {
    await modalSystem.show('alert', 'Notification', message, false, 'OK', '', 'fa-bell');
};

window.confirm = async (message) => {
    return await modalSystem.show('confirm', 'Confirmation', message, false, 'Yes, Proceed', 'Cancel', 'fa-question');
};

window.prompt = async (message, defaultValue = '') => {
    const result = await modalSystem.show('prompt', 'Input Required', message, true, 'Submit', 'Cancel', 'fa-keyboard');
    return result;
};

// Expose internal method for custom usages
window.customModal = modalSystem;
