// VulnRadar Chrome Extension

const DEFAULT_API_URL = 'https://vulnradar.dev';

// State
let state = {
  apiKey: null,
  sessionToken: null,
  user: null,
  apiUrl: DEFAULT_API_URL,
  settings: {
    autoScan: false,
    showNotifications: true
  }
};

// DOM Elements
const elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  await loadState();
  setupEventListeners();
  await initializeView();
});

function cacheElements() {
  // Views
  elements.authView = document.getElementById('authView');
  elements.mainView = document.getElementById('mainView');
  elements.scanningView = document.getElementById('scanningView');
  elements.resultsView = document.getElementById('resultsView');
  elements.settingsView = document.getElementById('settingsView');
  
  // Auth elements
  elements.authTabs = document.querySelectorAll('.auth-tab');
  elements.apikeyTab = document.getElementById('apikeyTab');
  elements.loginTab = document.getElementById('loginTab');
  elements.apiKeyInput = document.getElementById('apiKeyInput');
  elements.toggleApiKey = document.getElementById('toggleApiKey');
  elements.saveApiKey = document.getElementById('saveApiKey');
  elements.emailInput = document.getElementById('emailInput');
  elements.passwordInput = document.getElementById('passwordInput');
  elements.loginBtn = document.getElementById('loginBtn');
  
  // Main view elements
  elements.userName = document.getElementById('userName');
  elements.userPlan = document.getElementById('userPlan');
  elements.usageText = document.getElementById('usageText');
  elements.currentUrl = document.getElementById('currentUrl');
  elements.scanBtn = document.getElementById('scanBtn');
  elements.historyBtn = document.getElementById('historyBtn');
  elements.dashboardBtn = document.getElementById('dashboardBtn');
  elements.logoutBtn = document.getElementById('logoutBtn');
  
  // Scanning view
  elements.scanningUrl = document.getElementById('scanningUrl');
  elements.scanningStatus = document.getElementById('scanningStatus');
  
  // Results view
  elements.backBtn = document.getElementById('backBtn');
  elements.shareBtn = document.getElementById('shareBtn');
  elements.safetyCard = document.getElementById('safetyCard');
  elements.safetyScore = document.getElementById('safetyScore');
  elements.safetyLabel = document.getElementById('safetyLabel');
  elements.safetyDesc = document.getElementById('safetyDesc');
  elements.criticalCount = document.getElementById('criticalCount');
  elements.highCount = document.getElementById('highCount');
  elements.mediumCount = document.getElementById('mediumCount');
  elements.lowCount = document.getElementById('lowCount');
  elements.infoCount = document.getElementById('infoCount');
  elements.issuesList = document.getElementById('issuesList');
  elements.fullReportLink = document.getElementById('fullReportLink');
  
  // Settings
  elements.settingsBtn = document.getElementById('settingsBtn');
  elements.settingsBackBtn = document.getElementById('settingsBackBtn');
  elements.apiEndpoint = document.getElementById('apiEndpoint');
  elements.autoScan = document.getElementById('autoScan');
  elements.showNotifications = document.getElementById('showNotifications');
  elements.clearDataBtn = document.getElementById('clearDataBtn');
  
  // Toast
  elements.toast = document.getElementById('toast');
  elements.toastMessage = document.getElementById('toastMessage');
}

async function loadState() {
  const stored = await chrome.storage.local.get(['apiKey', 'sessionToken', 'user', 'apiUrl', 'settings']);
  if (stored.apiKey) state.apiKey = stored.apiKey;
  if (stored.sessionToken) state.sessionToken = stored.sessionToken;
  if (stored.user) state.user = stored.user;
  if (stored.apiUrl) state.apiUrl = stored.apiUrl;
  if (stored.settings) state.settings = { ...state.settings, ...stored.settings };
}

async function saveState() {
  await chrome.storage.local.set({
    apiKey: state.apiKey,
    sessionToken: state.sessionToken,
    user: state.user,
    apiUrl: state.apiUrl,
    settings: state.settings
  });
}

function setupEventListeners() {
  // Auth tabs
  elements.authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.authTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      elements.apikeyTab.classList.toggle('active', tabName === 'apikey');
      elements.loginTab.classList.toggle('active', tabName === 'login');
    });
  });
  
  // Toggle API key visibility
  elements.toggleApiKey.addEventListener('click', () => {
    const input = elements.apiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  
  // Save API key
  elements.saveApiKey.addEventListener('click', handleApiKeyConnect);
  elements.apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleApiKeyConnect();
  });
  
  // Login
  elements.loginBtn.addEventListener('click', handleLogin);
  elements.passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  
  // Main actions
  elements.scanBtn.addEventListener('click', handleScan);
  elements.historyBtn.addEventListener('click', () => openUrl('/history'));
  elements.dashboardBtn.addEventListener('click', () => openUrl('/dashboard'));
  elements.logoutBtn.addEventListener('click', handleLogout);
  
  // Results
  elements.backBtn.addEventListener('click', () => showView('mainView'));
  elements.shareBtn.addEventListener('click', handleShare);
  
  // Settings
  elements.settingsBtn.addEventListener('click', () => {
    elements.apiEndpoint.value = state.apiUrl;
    elements.autoScan.checked = state.settings.autoScan;
    elements.showNotifications.checked = state.settings.showNotifications;
    showView('settingsView');
  });
  elements.settingsBackBtn.addEventListener('click', () => {
    state.apiUrl = elements.apiEndpoint.value;
    state.settings.autoScan = elements.autoScan.checked;
    state.settings.showNotifications = elements.showNotifications.checked;
    saveState();
    showView(state.apiKey || state.sessionToken ? 'mainView' : 'authView');
  });
  elements.clearDataBtn.addEventListener('click', handleClearData);
}

async function initializeView() {
  if (state.apiKey || state.sessionToken) {
    // Validate credentials and show main view
    const valid = await validateCredentials();
    if (valid) {
      await updateUserInfo();
      await updateCurrentUrl();
      showView('mainView');
      
      if (state.settings.autoScan) {
        handleScan();
      }
    } else {
      showView('authView');
    }
  } else {
    showView('authView');
  }
}

function showView(viewName) {
  ['authView', 'mainView', 'scanningView', 'resultsView', 'settingsView'].forEach(name => {
    elements[name].classList.toggle('hidden', name !== viewName);
  });
}

async function validateCredentials() {
  try {
    const response = await apiRequest('/api/v2/user');
    if (response.ok) {
      const data = await response.json();
      state.user = data;
      await saveState();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function handleApiKeyConnect() {
  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) {
    showToast('Please enter an API key', 'error');
    return;
  }
  
  elements.saveApiKey.disabled = true;
  elements.saveApiKey.textContent = 'Connecting...';
  
  try {
    state.apiKey = apiKey;
    const valid = await validateCredentials();
    
    if (valid) {
      await saveState();
      await updateUserInfo();
      await updateCurrentUrl();
      showView('mainView');
      showToast('Connected successfully!', 'success');
    } else {
      state.apiKey = null;
      showToast('Invalid API key', 'error');
    }
  } catch (error) {
    state.apiKey = null;
    showToast('Connection failed', 'error');
  } finally {
    elements.saveApiKey.disabled = false;
    elements.saveApiKey.textContent = 'Connect';
  }
}

async function handleLogin() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  
  if (!email || !password) {
    showToast('Please enter email and password', 'error');
    return;
  }
  
  elements.loginBtn.disabled = true;
  elements.loginBtn.textContent = 'Logging in...';
  
  try {
    const response = await fetch(`${state.apiUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.requires2FA) {
        showToast('2FA required. Please login on website.', 'error');
        openUrl('/login');
        return;
      }
      
      state.sessionToken = data.token;
      state.user = data.user;
      await saveState();
      await updateUserInfo();
      await updateCurrentUrl();
      showView('mainView');
      showToast('Logged in successfully!', 'success');
    } else {
      const error = await response.json();
      showToast(error.error || 'Login failed', 'error');
    }
  } catch (error) {
    showToast('Login failed', 'error');
  } finally {
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = 'Login';
  }
}

async function handleLogout() {
  state.apiKey = null;
  state.sessionToken = null;
  state.user = null;
  await saveState();
  elements.apiKeyInput.value = '';
  elements.emailInput.value = '';
  elements.passwordInput.value = '';
  showView('authView');
  showToast('Logged out', 'success');
}

async function updateUserInfo() {
  if (state.user) {
    elements.userName.textContent = state.user.name || state.user.email || 'User';
    elements.userPlan.textContent = formatPlan(state.user.plan || 'free');
    
    // Get usage
    try {
      const response = await apiRequest('/api/v2/billing');
      if (response.ok) {
        const data = await response.json();
        const usage = data.usage;
        if (usage.unlimited) {
          elements.usageText.textContent = 'Unlimited';
        } else {
          elements.usageText.textContent = `${usage.used}/${usage.limit} scans`;
        }
      }
    } catch {}
  }
}

async function updateCurrentUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      elements.currentUrl.textContent = url.hostname + url.pathname;
      elements.currentUrl.title = tab.url;
    } else {
      elements.currentUrl.textContent = 'No URL available';
    }
  } catch {
    elements.currentUrl.textContent = 'Unable to get URL';
  }
}

async function handleScan() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showToast('No URL to scan', 'error');
      return;
    }
    
    const url = tab.url;
    
    // Check if URL is scannable
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      showToast('Cannot scan this page', 'error');
      return;
    }
    
    // Show scanning view
    elements.scanningUrl.textContent = new URL(url).hostname;
    elements.scanningStatus.textContent = 'Initializing scan...';
    showView('scanningView');
    
    // Run scan
    const statuses = [
      'Checking security headers...',
      'Analyzing SSL/TLS...',
      'Scanning for vulnerabilities...',
      'Running security checks...',
      'Generating report...'
    ];
    
    let statusIndex = 0;
    const statusInterval = setInterval(() => {
      statusIndex = (statusIndex + 1) % statuses.length;
      elements.scanningStatus.textContent = statuses[statusIndex];
    }, 2000);
    
    try {
      const response = await apiRequest('/api/v2/scan', {
        method: 'POST',
        body: JSON.stringify({ url })
      });
      
      clearInterval(statusInterval);
      
      if (response.ok) {
        const result = await response.json();
        displayResults(result, url);
        showView('resultsView');
        
        if (state.settings.showNotifications) {
          const issueCount = result.findings?.length || 0;
          chrome.runtime.sendMessage({
            type: 'showNotification',
            title: 'Scan Complete',
            message: issueCount > 0 
              ? `Found ${issueCount} issue${issueCount === 1 ? '' : 's'}`
              : 'No security issues found'
          });
        }
      } else {
        const error = await response.json();
        showToast(error.error || 'Scan failed', 'error');
        showView('mainView');
      }
    } catch (error) {
      clearInterval(statusInterval);
      showToast('Scan failed: ' + error.message, 'error');
      showView('mainView');
    }
  } catch (error) {
    showToast('Failed to get current tab', 'error');
    showView('mainView');
  }
}

function displayResults(result, url) {
  const findings = result.findings || [];
  
  // Count by severity
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach(f => {
    if (counts.hasOwnProperty(f.severity)) {
      counts[f.severity]++;
    }
  });
  
  elements.criticalCount.textContent = counts.critical;
  elements.highCount.textContent = counts.high;
  elements.mediumCount.textContent = counts.medium;
  elements.lowCount.textContent = counts.low;
  elements.infoCount.textContent = counts.info;
  
  // Calculate safety score
  const { grade, label, desc, className } = calculateSafetyScore(counts);
  elements.safetyScore.textContent = grade;
  elements.safetyLabel.textContent = label;
  elements.safetyDesc.textContent = desc;
  elements.safetyCard.className = 'safety-card ' + className;
  
  // Display issues
  if (findings.length === 0) {
    elements.issuesList.innerHTML = `
      <div class="no-issues">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div>No security issues found!</div>
      </div>
    `;
  } else {
    elements.issuesList.innerHTML = findings.slice(0, 10).map(f => `
      <div class="issue-item">
        <div class="issue-severity ${f.severity}"></div>
        <div class="issue-content">
          <div class="issue-title">${escapeHtml(f.title)}</div>
          <div class="issue-desc">${escapeHtml(f.description)}</div>
        </div>
      </div>
    `).join('');
    
    if (findings.length > 10) {
      elements.issuesList.innerHTML += `
        <div style="text-align: center; padding: 8px; color: var(--muted-foreground); font-size: 12px;">
          +${findings.length - 10} more issues
        </div>
      `;
    }
  }
  
  // Set full report link
  if (result.scanId) {
    elements.fullReportLink.href = `${state.apiUrl}/history?scan=${result.scanId}`;
  } else {
    elements.fullReportLink.href = `${state.apiUrl}/history`;
  }
}

function calculateSafetyScore(counts) {
  const { critical, high, medium, low } = counts;
  
  if (critical > 0) {
    return { grade: 'F', label: 'Critical', desc: `${critical} critical issue${critical === 1 ? '' : 's'} found`, className: 'critical' };
  }
  if (high > 2) {
    return { grade: 'D', label: 'Poor', desc: `${high} high severity issues found`, className: 'poor' };
  }
  if (high > 0) {
    return { grade: 'C', label: 'Moderate', desc: `${high} high severity issue${high === 1 ? '' : 's'} found`, className: 'moderate' };
  }
  if (medium > 3) {
    return { grade: 'B', label: 'Good', desc: `${medium} medium severity issues found`, className: 'good' };
  }
  if (medium > 0 || low > 0) {
    return { grade: 'A-', label: 'Good', desc: 'Minor issues found', className: 'good' };
  }
  return { grade: 'A+', label: 'Excellent', desc: 'No significant issues found', className: 'excellent' };
}

async function handleShare() {
  showToast('Opening share options...', 'success');
  openUrl('/history');
}

async function handleClearData() {
  if (confirm('Are you sure you want to clear all extension data?')) {
    await chrome.storage.local.clear();
    state = {
      apiKey: null,
      sessionToken: null,
      user: null,
      apiUrl: DEFAULT_API_URL,
      settings: { autoScan: false, showNotifications: true }
    };
    showView('authView');
    showToast('Data cleared', 'success');
  }
}

// API Helper
async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (state.apiKey) {
    headers['x-api-key'] = state.apiKey;
  } else if (state.sessionToken) {
    headers['Authorization'] = `Bearer ${state.sessionToken}`;
  }
  
  return fetch(`${state.apiUrl}${endpoint}`, {
    ...options,
    headers
  });
}

// Helpers
function openUrl(path) {
  chrome.tabs.create({ url: `${state.apiUrl}${path}` });
}

function formatPlan(plan) {
  const plans = {
    free: 'Free',
    core_supporter: 'Core',
    pro_supporter: 'Pro',
    elite_supporter: 'Elite'
  };
  return plans[plan] || plan;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast ${type}`;
  
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3000);
}
