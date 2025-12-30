# Chat Web Desktop

[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Made with Love](https://img.shields.io/badge/Made%20with-❤️-red.svg)](https://github.com)

Desktop shell for running multiple web-based messengers or tools side-by-side, each with its own profile (URL, title, icon, and optional User-Agent). Built with Electron.

## Features

- **Multiple profiles/windows** at once (e.g., chat, mail, support)
- **Tray controls** to show/hide/reload individual profiles or all at once
- **Per-profile customization**: window title, icon, and optional custom User-Agent
- **Unread detection** with visual tray notifications (blinking icons)
- **Minimize to tray** - windows hide to tray instead of closing
- **Remember window position** - each profile remembers its window size and position
- **Portable configuration** stored in JSON format

## Quick Start

### Installation

```bash
npm install
```

### Run the Application

```bash
npm start
```

On first run, the app will automatically open a configuration window to set up your profiles.

## Usage

### Basic Usage

1. **Configure Profiles**: Use the "Configure" button or tray menu to set up your chat services
2. **Add Profiles**: Each profile needs at least a name and URL
3. **Tray Controls**: Right-click the tray icon to show/hide/reload profiles
4. **Window Management**: Windows minimize to tray instead of closing

### Configuration Options

Each profile supports:
- **Name**: Display name for the profile
- **Service URL**: The web application URL to load
- **User-Agent**: Optional custom User-Agent string
- **Window Title**: Custom window title (defaults to profile name)
- **Icon**: Custom icon path (PNG/ICO)
- **Notification Icon**: Icon for unread notifications

### Tray Features

- **Individual Controls**: Show/hide/reload specific profiles
- **Bulk Actions**: Show/hide all profiles at once
- **Unread Notifications**: Tray icon blinks when new messages detected
- **Profile Switching**: Quick access to other configured profiles

## Development

### Prerequisites

- Node.js (v18+ recommended)
- npm

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm start
```

### Project Structure

```
chat-web-desktop/
├── index.js              # Main Electron process
├── preload.js            # Renderer preload script
├── package.json          # Project configuration
├── assets/               # Application icons
│   ├── chat_idle.ico     # App/installer icon
│   ├── chat_idle.png     # Tray icon (normal)
│   └── chat_new.png      # Tray icon (new messages)
└── user_data/            # Runtime user data
```

## Configuration

Configuration is stored in `user_data/config.json`.

**Override location**: Set `CHAT_WEB_USER_DATA` environment variable to customize the data directory.

**Example config.json**:
```json
{
  "profiles": [
    {
      "id": "profile-1",
      "name": "Chat Service",
      "url": "https://web.chat.example.com",
      "userAgent": "Custom User Agent String",
      "title": "My Chat",
      "iconPath": "/path/to/icon.png"
    }
  ]
}
```

## Build & Distribution

### Build Windows Installer

```bash
npm run dist
```

Output: `dist/Chat Web Desktop Setup x.x.x.exe`

## Troubleshooting

### Common Issues

- **No profiles configured**: Use "Configure" from tray menu or splash screen
- **Icons not loading**: Ensure icon files exist and are in supported formats (PNG/ICO)
- **User-Agent not working**: Check that the User-Agent string is valid
- **Tray not appearing**: Check system tray settings

### Reset Configuration

Delete `user_data/config.json` or use "Clear All" in the configuration window.

## License

ISC License
