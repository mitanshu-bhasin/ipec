/**
 * IPEC AI Support Module using Google Gemini API
 * Provides a chat interface for users to get support and insights.
 */

const GEMINI_API_KEY = window.ENV?.FIREBASE_API_KEY || '';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

export class AISupport {
    constructor(userContext = {}, containerId = null) {
        this.userContext = userContext || {};
        this.containerId = containerId;
        this.chatHistory = [];
        this.isOpen = false;
        this.init();
    }

    init() {
        this.createStyles();
        this.createChatWidget();
        if (this.containerId) {
            this.embedInContainer();
        } else {
            this.addToBody();
        }
    }

    createStyles() {
        if (document.getElementById('ai-support-styles')) return;
        const style = document.createElement('style');
        style.id = 'ai-support-styles';
        style.textContent = `
            .ai-widget-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 60px;
                height: 60px;
                background: linear-gradient(135deg, #34d399, #1E8E3E);
                border-radius: 50%;
                box-shadow: 0 10px 25px rgba(30, 142, 62, 0.4);
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: transform 0.3s, box-shadow 0.3s;
                z-index: 9999;
                font-size: 24px;
            }
            .ai-widget-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 15px 35px rgba(30, 142, 62, 0.5);
            }
            .ai-chat-window {
                position: fixed;
                bottom: 90px;
                left: auto;
                right: 20px;
                width: 380px;
                height: 600px;
                max-height: 80vh;
                background: white;
                border-radius: 16px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.15);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                z-index: 99999;
                transform-origin: bottom right;
                transition: transform 0.3s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s;
                opacity: 0;
                transform: scale(0.9) translateY(20px);
                pointer-events: none;
                border: 1px solid rgba(0,0,0,0.05);
            }
            .ai-chat-window.open {
                opacity: 1;
                transform: scale(1) translateY(0);
                pointer-events: all;
            }
            .ai-header {
                background: linear-gradient(135deg, #34d399, #1E8E3E);
                padding: 16px;
                color: white;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .ai-messages {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                background: #f8fafc;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .ai-message {
                max-width: 80%;
                padding: 10px 14px;
                border-radius: 12px;
                font-size: 14px;
                line-height: 1.5;
                position: relative;
                word-wrap: break-word;
            }
            .ai-message.user {
                align-self: flex-end;
                background: #1E8E3E;
                color: white;
                border-bottom-right-radius: 2px;
            }
            .ai-message.ai {
                align-self: flex-start;
                background: white;
                color: #334155;
                border: 1px solid #e2e8f0;
                border-bottom-left-radius: 2px;
            }
            .ai-input-area {
                padding: 12px;
                background: white;
                border-top: 1px solid #e2e8f0;
                display: flex;
                gap: 8px;
            }
            .ai-input {
                flex: 1;
                border: 1px solid #cbd5e1;
                border-radius: 20px;
                padding: 8px 16px;
                font-size: 14px;
                outline: none;
                transition: border-color 0.2s;
            }
            .ai-input:focus {
                border-color: #1E8E3E;
            }
            .ai-send-btn {
                background: #1E8E3E;
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
            .ai-send-btn:hover {
                background: #15803d;
            }
            .ai-send-btn:disabled {
                background: #94a3b8;
                cursor: not-allowed;
            }
            .typing-indicator {
                display: flex;
                gap: 4px;
                padding: 4px 8px;
                background: #f1f5f9;
                border-radius: 12px;
                align-self: flex-start;
                margin-bottom: 8px;
                display: none;
            }
            .typing-dot {
                width: 6px;
                height: 6px;
                background: #cbd5e1;
                border-radius: 50%;
                animation: typing 1.4s infinite ease-in-out both;
            }
            .typing-dot:nth-child(1) { animation-delay: -0.32s; }
            .typing-dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes typing {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1); }
            }
            /* Markdown styles roughly */
            .ai-message.ai strong { font-weight: 600; color: #1e293b; }
            .ai-message.ai ul { margin-left: 20px; list-style-type: disc; }
            .ai-message.ai p { margin-bottom: 8px; }
            .ai-message.ai p:last-child { margin-bottom: 0; }

            @media (max-width: 480px) {
                .ai-chat-window {
                    width: 100% !important;
                    height: 100% !important;
                    max-height: 100% !important;
                    bottom: 0 !important;
                    right: 0 !important;
                    border-radius: 0 !important;
                    transform-origin: bottom center;
                }
                .ai-widget-btn {
                    bottom: 20px;
                    right: 20px;
                }
            } 
        `;
        document.head.appendChild(style);
    }

    createChatWidget() {
        // Chat Button
        this.widgetBtn = document.createElement('div');
        this.widgetBtn.className = 'ai-widget-btn';
        this.widgetBtn.innerHTML = '<i class="fa-solid fa-robot"></i>';
        this.widgetBtn.onclick = () => this.toggleChat();
        this.widgetBtn.id = 'ai-widget-trigger';

        // Chat Window
        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'ai-chat-window';
        this.chatWindow.innerHTML = `
            <div class="ai-header">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-sparkles"></i>
                    <span class="font-bold">IPEC AI Assistant</span>
                </div>
                <button class="text-white hover:text-gray-200" onclick="document.getElementById('ai-widget-trigger').click()">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="ai-messages" id="ai-messages">
                <div class="ai-message ai">
                    Hello <strong>${this.userContext.name || 'User'}</strong>! I'm your IPEC AI Assistant powered by IPEC. 
                    I can help you with expense policies, company info, navigating the portal, or analyzing your data.
                </div>
            </div>
            <div class="typing-indicator" id="ai-typing">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
            <div class="p-2 flex gap-2 overflow-x-auto bg-gray-50 border-t border-gray-100">
                <button class="text-xs bg-white border border-green-200 text-green-600 px-3 py-1 rounded-full hover:bg-green-50 whitespace-nowrap transition" onclick="window.triggerAIAction('policy')">Expense Policy?</button>
                <button class="text-xs bg-white border border-green-200 text-green-600 px-3 py-1 rounded-full hover:bg-green-50 whitespace-nowrap transition" onclick="window.triggerAIAction('about')">About IPEC?</button>
                <button class="text-xs bg-white border border-green-200 text-green-600 px-3 py-1 rounded-full hover:bg-green-50 whitespace-nowrap transition" onclick="window.triggerAIAction('analyze')">Analyze Spending</button>
            </div>
            <div class="ai-input-area">
                <input type="text" class="ai-input" placeholder="Ask me anything..." id="ai-input">
                <button class="ai-send-btn" id="ai-send-btn">
                    <i class="fa-solid fa-paper-plane text-sm"></i>
                </button>
            </div>
        `;

        // Bind events
        setTimeout(() => {
            const input = this.chatWindow.querySelector('#ai-input');
            const sendBtn = this.chatWindow.querySelector('#ai-send-btn');

            const sendMessage = () => {
                const text = input.value.trim();
                if (!text) return;
                this.addMessage(text, 'user');
                input.value = '';
                this.processQuery(text);
            };

            sendBtn.onclick = sendMessage;
            input.onkeypress = (e) => {
                if (e.key === 'Enter') sendMessage();
            };
        }, 0);

        // Global trigger handler
        window.triggerAIAction = (action) => {
            if (action === 'policy') this.processQuery("What is the expense policy for IPEC?");
            if (action === 'about') this.processQuery("Tell me about IPEC and its founders.");
            if (action === 'analyze') this.processQuery("Analyze my current dashboard data and give me insights.");
        };
    }

    addToBody() {
        document.body.appendChild(this.widgetBtn);
        document.body.appendChild(this.chatWindow);
    }

    embedInContainer() {
        const container = document.getElementById(this.containerId);
        if (container) {
            // Modify styles for embedded view
            this.widgetBtn.style.display = 'none';
            this.chatWindow.style.position = 'relative';
            this.chatWindow.style.bottom = 'auto';
            this.chatWindow.style.right = 'auto';
            this.chatWindow.style.width = '100%';
            this.chatWindow.style.height = '500px';
            this.chatWindow.style.boxShadow = 'none';
            this.chatWindow.style.transform = 'none';
            this.chatWindow.style.opacity = '1';
            this.chatWindow.style.pointerEvents = 'all';
            this.chatWindow.classList.add('open');
            container.appendChild(this.chatWindow);
        }
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.chatWindow.classList.add('open');
            this.widgetBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
        } else {
            this.chatWindow.classList.remove('open');
            this.widgetBtn.innerHTML = '<i class="fa-solid fa-robot"></i>';
        }
    }

    addMessage(text, sender) {
        const msgs = this.chatWindow.querySelector('#ai-messages');
        const div = document.createElement('div');
        div.className = `ai-message ${sender}`;
        // Simple markdown parsing for bold and list
        let formatted = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        div.innerHTML = formatted;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    async processQuery(query) {
        const typing = this.chatWindow.querySelector('#ai-typing');
        const messagesEl = this.chatWindow.querySelector('#ai-messages');

        // RATE LIMIT CHECK (3 messages per minute)
        const RATE_LIMIT = 3;
        const TIME_FRAME = 60000; // 60 seconds
        const now = Date.now();

        let timestamps = [];
        try {
            timestamps = JSON.parse(localStorage.getItem('ipec_ai_timestamps') || '[]');
        } catch (e) { timestamps = []; }

        // Filter out timestamps older than 1 minute
        timestamps = timestamps.filter(t => now - t < TIME_FRAME);

        if (timestamps.length >= RATE_LIMIT) {
            const oldest = timestamps[0];
            const waitSecs = Math.ceil((oldest + TIME_FRAME - now) / 1000);
            this.addMessage(`⚠️ Rate limit exceeded. Please wait ${waitSecs} seconds before sending another message.`, 'ai');
            return;
        }

        // Add current timestamp
        timestamps.push(now);
        localStorage.setItem('ipec_ai_timestamps', JSON.stringify(timestamps));

        typing.style.display = 'flex';
        messagesEl.scrollTop = messagesEl.scrollHeight;

        try {
            // Prepare context prompt
            const context = `
                Company: IPEC Consulting (International Process Excellence Council)
                FOUNDER: Raj Kalra
                COO: Sangeet Malhotra.
                Mission: Educational excellence, CSR, and Process Excellence.
                Current User Context:
                - Name: ${this.userContext.name || 'Visitor'}
                - Role: ${this.userContext.role || 'Guest'}
                - Email: ${this.userContext.email || 'N/A'}
                - Department: ${this.userContext.department || 'General'}
                
                You are devloped and trained By Mitanshu Bhasin.
                You have access to their dashboard context if they ask.
                If they ask to "analyze spending", assume I am feeding you the summary:
                ${JSON.stringify(this.userContext.dashboardData || {})}
                
                Be helpful, professional, and concise. Use **bold** for key terms.
                
                **EXPENSE CREATION CAPABILITY**:
                If the user wants to "create" or "add" an expense, you must collect:
                1. Project Code (Look for this in the user's message or context)
                2. Category (e.g., Travel, Food, Supplies, etc.)
                3. Amount (A number)
                4. Description (What it was for)
                
                If any details are missing, ask for them politely.
                Once you have all 4 details, you MUST conclude your response with a special command tag:
                [COMMAND:CREATE_EXPENSE:{"projectCode":"...", "category":"...", "amount":..., "description":"..."}]
                
                Do not ask for "Report Title" as it is auto-generated.
                Assume 'INR' as the default currency unless specified otherwise.
            `;

            // Prepare Raw Contents
            let rawContents = [];

            // 1. Add History
            if (this.chatHistory.length > 0) {
                rawContents = this.chatHistory.map(msg => ({
                    role: msg.role,
                    parts: [{ text: msg.content }]
                }));
            }

            // 2. Prepare Current Message
            // Inject context if history is empty
            let currentText = query;
            if (rawContents.length === 0) {
                currentText = `System Context: ${context}\n\nUser Question: ${query}`;
            }

            const currentUserMsg = {
                role: "user",
                parts: [{ text: currentText }]
            };

            rawContents.push(currentUserMsg);

            // 3. Strict Validation & Sanitization
            // Gemini requires: Start with 'user', Alternating roles
            const validContents = [];
            let expectedRole = 'user';

            for (const item of rawContents) {
                // Ensure text is not empty
                if (!item.parts || !item.parts[0] || !item.parts[0].text.trim()) continue;

                if (item.role === expectedRole) {
                    validContents.push(item);
                    expectedRole = expectedRole === 'user' ? 'model' : 'user';
                } else {
                    // Mismatch detected - Recovery
                    if (item.role === 'user' && expectedRole === 'model') {
                        // Two users in a row? Drop previous user, use new one.
                        validContents.pop();
                        validContents.push(item);
                        expectedRole = 'model';
                    } else {
                        console.warn("Skipping invalid role sequence item:", item);
                    }
                }
            }

            // Final check: Must end with 'user'
            if (validContents.length === 0 || validContents[validContents.length - 1].role !== 'user') {
                validContents.length = 0;
                validContents.push({
                    role: "user",
                    parts: [{ text: `System Context: ${context}\n\nUser Question: ${query}` }]
                });
            }

            const requestBody = { contents: validContents };

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error("Gemini API Error:", errData);
                const errMsg = errData.error ? errData.error.message : response.statusText;
                throw new Error(`${response.status}: ${errMsg}`);
            }

            const data = await response.json();
            typing.style.display = 'none';

            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                const reply = data.candidates[0].content.parts[0].text;

                // Handle Commands
                if (reply.includes('[COMMAND:')) {
                    const match = reply.match(/\[COMMAND:([A-Z_]+):(.*?)\]/);
                    if (match) {
                        const cmd = match[1];
                        const payloadStr = match[2];
                        try {
                            const payload = JSON.parse(payloadStr);
                            this.handleCommand(cmd, payload);
                        } catch (e) { console.error("Command parse error", e); }
                    }
                }

                // Clean up reply for display (remove command tags)
                const displayReply = reply.replace(/\[COMMAND:.*?\]/g, '').trim();
                if (displayReply) {
                    this.addMessage(displayReply, 'ai');
                }

                this.chatHistory.push({ role: "user", content: currentText });
                this.chatHistory.push({ role: "model", content: reply });

                if (this.chatHistory.length > 20) this.chatHistory = this.chatHistory.slice(-20);

            } else {
                this.addMessage("I'm sorry, I couldn't process that request right now.", 'ai');
            }

        } catch (error) {
            console.error(error);
            typing.style.display = 'none';
            let msg = "Connection Error";
            if (error.message.includes('400')) msg = "Error (400): Bad Request (Check inputs)";
            else if (error.message.includes('403')) msg = "Error (403): Invalid API Key or Location";
            else if (error.message.includes('429')) msg = "Error (429): Quota Exceeded";
            else if (error.message.includes('500')) msg = "Error (500): Server Error";
            else msg = `Error: ${error.message}`;

            this.addMessage(`⚠️ ${msg}. Please try again later.`, 'ai');
        }
    }

    updateContext(newContext) {
        this.userContext = { ...this.userContext, ...newContext };
    }

    handleCommand(command, payload) {
        console.log("AI Command Received:", command, payload);
        if (command === 'CREATE_EXPENSE') {
            // Trigger a custom event that emp.html can listen for
            const event = new CustomEvent('ai-expense-action', { detail: payload });
            window.dispatchEvent(event);
        }
    }
}
