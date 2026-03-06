# IPEC Expense Manager

### Official Expense Tracking & Reimbursement Portal for the International Process Excellence Council (IPEC)

**Live Demo**: [https://ipecconsulting.netlify.app](https://ipecconsulting.netlify.app)

---

## 📌 Project Overview

The **IPEC Expense Manager** is a comprehensive, progressive web application (PWA) designed to streamline financial operations for IPEC. It facilitates seamless expense submission for employees and provides robust approval workflows for administrators.

**Key Features:**
*   **Role-Based Access Control**: Separate, secure portals for Employees and Administrators.
*   **Real-Time Sync**: Instant updates using Firebase Firestore.
*   **Offline Capability**: Fully functional offline mode with PWA caching.
*   **AI Integration**: Built-in AI assistant for policy queries.
*   **Direct Chat**: Integrated messaging system for internal communication.
*   **Comprehensive Reporting**: Generate PDF reports and visualize spending trends.

---

## 📂 Codebase Structure & File Descriptions

### **Core Application Pages**

*   **`index.html` (Landing Page)**
    *   **Purpose**: Public-facing landing page.
    *   **Features**: Displays mission statement, key features, and entry points to portals. Contains comprehensive SEO meta tags and Organization Schema.

*   **`emp.html` (Employee Portal)**
    *   **Purpose**: The workspace for general staff.
    *   **Features**:
        *   **Dashboard**: View total paid/pending claims at a glance.
        *   **Create Claim**: Modal form with receipt upload (ImageKit/Firebase), multi-currency support, and expense categorization.
        *   **History**: Searchable list of all submitted claims with status badges.
        *   **Profile**: manage personal details and download personal data.

*   **`admin.html` (Admin Command Center)**
    *   **Purpose**: Management console for Approvers/Finance team.
    *   **Features**:
        *   **Approval Workflow**: Review pending claims, view receipts, and Approve/Reject with comments.
        *   **Analytics**: Visual charts (Chart.js) showing spending by category/month.
        *   **User Management**: Add/Edit/Remove system users and assign roles.
        *   **Project Management**: Create and manage billing codes/projects.
        *   **Audit Logs**: detailed timeline of all system actions for compliance.

### **System & Utility Files**

*   **`mitanshu.html` (Author Profile)**
    *   **Purpose**: Professional portfolio for the lead developer/team member.
    *   **Features**: Detailed bio, skills, and contact information with schema markup.

*   **`chat.js` (Communication Module)**
    *   **Purpose**: Implements the internal messaging system.
    *   **Tech**: Uses `localStorage` event listeners to simulate real-time socket behavior across tabs/devices without a backend socket server.

*   **`sw.js` (Service Worker)**
    *   **Purpose**: Enables PWA functionality.
    *   **Features**: Caches critical assets (HTML, CSS, JS) for offline access. Implements a "Network-First, Fallback to Cache" strategy for reliability.

*   **`manifest.json`**
    *   **Purpose**: Web App Manifest.
    *   **Features**: Defines app name, icons, theme colors, and shortcuts for installation on Android/Windows.

*   **`offline.html`**
    *   **Purpose**: Custom error page.
    *   **Features**: Displayed automatically when the user loses internet connection, with auto-retry functionality.

*   **`404.html`**
    *   **Purpose**: Custom "Page Not Found".
    *   **Features**: User-friendly navigation back to safety.

*   **`theme.js`**
    *   **Purpose**: UI Logic.
    *   **Features**: Handles Dark/Light mode toggling and persistence.

*   **`utils.js` & `admin-helper.js`**
    *   **Purpose**: Shared Logic.
    *   **Features**: Formats currency, dates, handles file uploads, and specific admin calculations.

*   **`ai-support.js`**
    *   **Purpose**: AI Widget.
    *   **Features**: Logic for the floating AI help assistant.

---

## 🛠 Technology Stack

*   **Frontend**: HTML5, Vanilla JavaScript (ES6+), Tailwind CSS (via CDN)
*   **Backend / Database**: Firebase (Firestore, Auth, Storage)
*   **Media Storage**: ImageKit.io (integrated for receipts)
*   **Charts**: Chart.js
*   **PDF Generation**: html2pdf.js

---

## 🚀 Deployment

Hosted on **Netlify**: `https://ipecconsulting.netlify.app`

## 🔒 Security

*   **`security.txt`**: Standardized security policy located in `.well-known/`.
*   **Firebase Rules**: Firestore rules ensure users can only access their own data (unless Admin).

---
&copy; 2026 International Process Excellence Council. All Rights Reserved.
