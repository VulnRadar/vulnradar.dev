// VulnRadar Chrome Extension - Background Service Worker

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'showNotification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: message.title,
      message: message.message
    });
  }
  return true;
});

// Context menu for right-click scanning
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'scanPage',
    title: 'Scan with VulnRadar',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'scanLink',
    title: 'Scan link with VulnRadar',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'scanLink' ? info.linkUrl : info.pageUrl;
  
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'VulnRadar',
      message: 'Cannot scan this URL'
    });
    return;
  }
  
  // Get stored credentials
  const { apiKey, sessionToken, apiUrl } = await chrome.storage.local.get(['apiKey', 'sessionToken', 'apiUrl']);
  
  if (!apiKey && !sessionToken) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'VulnRadar',
      message: 'Please connect your API key or login first'
    });
    return;
  }
  
  // Show scanning notification
  chrome.notifications.create('scanning', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'VulnRadar',
    message: `Scanning ${new URL(url).hostname}...`
  });
  
  try {
    const baseUrl = apiUrl || 'https://vulnradar.dev';
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    } else if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    
    const response = await fetch(`${baseUrl}/api/v2/scan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url })
    });
    
    if (response.ok) {
      const result = await response.json();
      const issueCount = result.findings?.length || 0;
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Scan Complete',
        message: issueCount > 0 
          ? `Found ${issueCount} issue${issueCount === 1 ? '' : 's'} on ${new URL(url).hostname}`
          : `No security issues found on ${new URL(url).hostname}`
      });
    } else {
      const error = await response.json();
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Scan Failed',
        message: error.error || 'Failed to scan URL'
      });
    }
  } catch (error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Scan Failed',
      message: 'Network error. Please try again.'
    });
  }
});

// Badge update based on last scan
async function updateBadge(issueCount) {
  if (issueCount > 0) {
    chrome.action.setBadgeText({ text: String(issueCount) });
    chrome.action.setBadgeBackgroundColor({ color: issueCount > 5 ? '#ef4444' : '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}
