/**
 * SystemChat.js
 * A real-time chat widget using localStorage for synchronization across tabs/windows.
 * Supports Group Chat (General) and simulates Private Messaging.
 */

class SystemChat {
    constructor(currentUser) {
        this.currentUser = currentUser || { name: 'Guest', role: 'Viewer' };
        this.isOpen = false;
        this.activeChannel = 'General'; // 'General' or a User Name
        this.messages = [];
        this.users = JSON.parse(localStorage.getItem('system_chat_users')) || [
            { name: 'Admin', role: 'ADMIN', online: true },
            { name: 'Sangeet Malhotra', role: 'COO', online: true },
            { name: 'Mitanshu Bhasin', role: 'TECH', online: true }
        ];

        // Add current user if not exists
        if (!this.users.find(u => u.name === this.currentUser.name)) {
            this.users.push({ ...this.currentUser, online: true });
            localStorage.setItem('system_chat_users', JSON.stringify(this.users));
        }

        this.init();
    }

    init() {
        this.loadMessages();
        this.injectStyles();
        this.createWidget();
        this.attachListeners();

        // Listen for updates from other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === 'system_chat_messages') {
                this.loadMessages();
                this.renderMessages();
            }
        });

        // Poll for "online" simulation
        setInterval(() => this.updateOnlineStatus(), 30000);
    }

    loadMessages() {
        const stored = localStorage.getItem('system_chat_messages');
        this.messages = stored ? JSON.parse(stored) : [];
    }

    saveMessage(text) {
        const msg = {
            id: Date.now().toString(),
            sender: this.currentUser.name,
            role: this.currentUser.role,
            recipient: this.activeChannel,
            text: text,
            timestamp: new Date().toISOString()
        };

        this.messages.push(msg);
        localStorage.setItem('system_chat_messages', JSON.stringify(this.messages));
        this.renderMessages();
        this.scrollToBottom();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            #sys-chat-widget {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9999;
                font-family: 'Inter', sans-serif;
            }
            #sys-chat-btn {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4);
                transition: transform 0.2s;
            }
            #sys-chat-btn:hover { transform: scale(1.05); }
            
            #sys-chat-window {
                position: absolute;
                bottom: 80px;
                right: 0;
                width: 350px;
                height: 500px;
                background: white;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border: 1px solid #e2e8f0;
                transform-origin: bottom right;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                opacity: 0;
                transform: scale(0.9) translateY(20px);
                pointer-events: none;
            }
            #sys-chat-window.open {
                opacity: 1;
                transform: scale(1) translateY(0);
                pointer-events: all;
            }
            
            .dark #sys-chat-window {
                background: #1e293b;
                border-color: #334155;
            }
            
            .chat-header {
                padding: 16px;
                background: linear-gradient(to right, #2563eb, #1d4ed8);
                color: white;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .chat-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            
            .chat-sidebar {
                width: 80px;
                background: #f8fafc;
                border-right: 1px solid #e2e8f0;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding-top: 10px;
                gap: 10px;
                overflow-y: auto;
            }
            .dark .chat-sidebar { background: #0f172a; border-color: #334155; }
            
            .chat-main {
                flex: 1;
                display: flex;
                flex-direction: column;
                background: #fff;
            }
            .dark .chat-main { background: #1e293b; }
            
            .chat-messages {
                flex: 1;
                padding: 15px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .chat-input-area {
                padding: 12px;
                border-top: 1px solid #e2e8f0;
                display: flex;
                gap: 8px;
                background: #f8fafc;
            }
            .dark .chat-input-area { background: #0f172a; border-color: #334155; }
            
            .msg {
                max-width: 85%;
                padding: 8px 12px;
                border-radius: 12px;
                font-size: 13px;
                line-height: 1.4;
                position: relative;
            }
            .msg.sent {
                align-self: flex-end;
                background: #2563eb;
                color: white;
                border-bottom-right-radius: 2px;
            }
            .msg.received {
                align-self: flex-start;
                background: #f1f5f9;
                color: #334155;
                border-bottom-left-radius: 2px;
            }
            .dark .msg.received {
                background: #334155;
                color: #e2e8f0;
            }
            
            .msg-meta {
                font-size: 10px;
                opacity: 0.7;
                margin-top: 4px;
                display: flex;
                justify-content: space-between;
                gap: 8px;
            }
            
            .user-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 14px;
                cursor: pointer;
                border: 2px solid transparent;
                transition: all 0.2s;
                position: relative;
                color: #475569;
            }
            .user-avatar.active {
                border-color: #2563eb;
                background: #eff6ff;
            }
            .user-avatar:hover {
                transform: scale(1.1);
            }
            
            .active-indicator {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 10px;
                height: 10px;
                background: #22c55e;
                border: 2px solid white;
                border-radius: 50%;
            }
            
            .chat-input {
                flex: 1;
                border: 1px solid #cbd5e1;
                border-radius: 20px;
                padding: 8px 16px;
                font-size: 13px;
                outline: none;
                background: white;
                color: #334155;
            }
            .dark .chat-input {
                background: #1e293b;
                border-color: #475569;
                color: white;
            }
            
            .send-btn {
                background: #2563eb;
                color: white;
                border: none;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .send-btn:hover { background: #1d4ed8; }
            
            /* Channel Label */
            .channel-label {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                text-align: center;
                font-size: 10px;
                background: rgba(255,255,255,0.9);
                padding: 2px;
                color: #64748b;
                z-index: 10;
                backdrop-filter: blur(2px);
                border-bottom: 1px solid #f1f5f9;
            }
            .dark .channel-label {
                background: rgba(30, 41, 59, 0.9);
                color: #94a3b8;
                border-color: #334155;
            }
        `;
        document.head.appendChild(style);
    }

    createWidget() {
        const container = document.createElement('div');
        container.id = 'sys-chat-widget';
        container.innerHTML = `
            <div id="sys-chat-window">
                <div class="chat-header">
                    <div class="flex items-center gap-2">
                        <i class="fa-regular fa-comments"></i>
                        <span class="font-bold text-sm">Team Connect</span>
                    </div>
                    <button id="sys-chat-close" class="text-white/80 hover:text-white"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="chat-body">
                    <div class="chat-sidebar" id="sys-chat-users">
                        <!-- User list injected here -->
                    </div>
                    <div class="chat-main">
                        <div class="relative flex-1 flex flex-col min-h-0">
                            <div class="channel-label" id="channel-name"># General</div>
                            <div class="chat-messages" id="sys-chat-msgs">
                                <!-- Messages -->
                            </div>
                        </div>
                        <div class="chat-input-area">
                            <input type="text" class="chat-input" id="sys-chat-input" placeholder="Type a message...">
                            <button class="send-btn" id="sys-chat-send"><i class="fa-solid fa-paper-plane text-xs"></i></button>
                        </div>
                    </div>
                </div>
            </div>
            <div id="sys-chat-btn">
                <i class="fa-solid fa-comment-dots text-2xl"></i>
            </div>
        `;
        document.body.appendChild(container);
        this.renderUsers();
    }

    renderUsers() {
        const sidebar = document.getElementById('sys-chat-users');
        if (!sidebar) return;

        // General Channel
        let html = `
            <div class="user-avatar ${this.activeChannel === 'General' ? 'active' : ''}" title="General Channel" data-id="General">
                <i class="fa-solid fa-users"></i>
            </div>
            <div class="w-8 h-[1px] bg-slate-200 dark:bg-slate-700 my-1"></div>
        `;

        // Users
        this.users.forEach(u => {
            if (u.name === this.currentUser.name) return; // Don't show self

            const initials = u.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const isActive = this.activeChannel === u.name ? 'active' : '';

            html += `
                <div class="user-avatar ${isActive}" title="${u.name} (${u.role})" data-id="${u.name}">
                    ${initials}
                    <div class="active-indicator"></div>
                </div>
            `;
        });

        // Add Group Button (Mock)
        html += `
             <div class="w-8 h-[1px] bg-slate-200 dark:bg-slate-700 my-1"></div>
             <div class="user-avatar bg-dashed border-dashed border-2 border-slate-300 text-slate-400 hover:text-blue-500 hover:border-blue-400" title="Create Group" onclick="alert('Group creation coming soon!')">
                <i class="fa-solid fa-plus"></i>
            </div>
        `;

        sidebar.innerHTML = html;

        // Re-attach listeners
        sidebar.querySelectorAll('.user-avatar[data-id]').forEach(el => {
            el.addEventListener('click', () => {
                this.switchChannel(el.dataset.id);
            });
        });
    }

    switchChannel(channelId) {
        this.activeChannel = channelId;
        document.getElementById('channel-name').innerText = channelId === 'General' ? '# General' : `@ ${channelId}`;
        this.renderUsers();
        this.renderMessages();
    }

    renderMessages() {
        const container = document.getElementById('sys-chat-msgs');
        if (!container) return;

        container.innerHTML = '';

        // Filter messages for current channel
        const thread = this.messages.filter(m => {
            if (this.activeChannel === 'General') {
                return m.recipient === 'General';
            } else {
                // Private message logic:
                // Show if specific recipient matches current channel AND sender is me
                // OR sender matches current channel AND recipient is me
                return (m.recipient === this.activeChannel && m.sender === this.currentUser.name) ||
                    (m.sender === this.activeChannel && m.recipient === this.currentUser.name);
            }
        });

        if (thread.length === 0) {
            container.innerHTML = `<div class="text-center text-xs text-gray-400 mt-10">No messages yet. Say hi! 👋</div>`;
            return;
        }

        thread.forEach(m => {
            const isMe = m.sender === this.currentUser.name;
            const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const div = document.createElement('div');
            div.className = `msg ${isMe ? 'sent' : 'received'}`;

            div.innerHTML = `
                ${!isMe ? `<div class="text-[9px] font-bold mb-1 opacity-80">${m.sender} <span class="text-[8px] font-normal border border-slate-400/30 px-1 rounded ml-1">${m.role}</span></div>` : ''}
                ${m.text}
                <div class="msg-meta">
                    <span>${time}</span>
                    ${isMe ? '<span><i class="fa-solid fa-check-double"></i></span>' : ''}
                </div>
            `;
            container.appendChild(div);
        });

        this.scrollToBottom();
    }

    scrollToBottom() {
        const container = document.getElementById('sys-chat-msgs');
        if (container) container.scrollTop = container.scrollHeight;
    }

    attachListeners() {
        // Open/Close
        const btn = document.getElementById('sys-chat-btn');
        const win = document.getElementById('sys-chat-window');
        const close = document.getElementById('sys-chat-close');

        btn.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            win.classList.toggle('open', this.isOpen);
            if (this.isOpen) this.scrollToBottom();
        });

        close.addEventListener('click', () => {
            this.isOpen = false;
            win.classList.remove('open');
        });

        // Send Message
        const input = document.getElementById('sys-chat-input');
        const sendBtn = document.getElementById('sys-chat-send');

        const sendMessage = () => {
            const text = input.value.trim();
            if (!text) return;
            this.saveMessage(text);
            input.value = '';
        };

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    updateOnlineStatus() {
        // Mock update - in real app would ping server
        // This is just to ensure users array stays populated if cleared
        if (!localStorage.getItem('system_chat_users')) {
            localStorage.setItem('system_chat_users', JSON.stringify(this.users));
        }
    }
}

// Export for module usage
export default SystemChat;
