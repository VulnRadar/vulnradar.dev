# VulnRadar Chrome Extension

Scan any website for security vulnerabilities directly from your browser.

## Features

- **Quick Scan**: Scan the current page with one click
- **API Key or Login**: Authenticate with your API key or VulnRadar account
- **Real-time Results**: View scan results directly in the extension
- **Right-click Scanning**: Scan any page or link via context menu
- **Usage Tracking**: See your daily scan usage
- **Notifications**: Get notified when scans complete

## Installation

### Development / Manual Install

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The VulnRadar icon should appear in your toolbar

### Icons

The extension requires icon files. Create PNG icons in the `icons/` folder:
- `icon16.png` (16x16)
- `icon32.png` (32x32)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

You can use the VulnRadar logo or create a simple shield icon.

## Usage

1. Click the VulnRadar icon in your toolbar
2. Enter your API key or login with your account
3. Navigate to any website you want to scan
4. Click "Scan This Page"
5. View results directly in the popup or click through to the full report

### Getting an API Key

1. Go to [vulnradar.dev/profile#developer](https://vulnradar.dev/profile#developer)
2. Click "Generate API Key"
3. Copy the key and paste it into the extension

## Settings

- **API Endpoint**: Switch between production and development servers
- **Auto-scan on popup**: Automatically scan when opening the extension
- **Show notifications**: Get browser notifications for scan results

## Permissions

- `activeTab`: Access the current tab's URL for scanning
- `storage`: Save your API key and settings locally
- `tabs`: Query tab information
- Host permissions for VulnRadar API

## Privacy

- Your API key is stored locally in Chrome's secure storage
- No data is sent to third parties
- All scans are processed through VulnRadar's servers

## Support

For issues or feature requests, visit [vulnradar.dev](https://vulnradar.dev)
