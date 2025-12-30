# Chat Web Desktop

Desktop shell for running multiple web-based messengers or tools side-by-side, each with its own profile (URL, title, icon, and optional User-Agent). Built with Electron.

## Features

- **Multiple profiles/windows** at once (e.g., chat, mail, support)
- **Tray controls** to show/hide/reload individual profiles or all at once
- **Per-profile customization**: window title, icon, and optional custom User-Agent
- **Unread detection** with visual tray notifications
- **Portable configuration** stored in `user_data/config.json`
- **Multi-profile support** with independent settings

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
- **Icon**: Custom icon path (PNG/ICO/ICNS)
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

# Run unit tests
npm test

# Run end-to-end tests
npm run test:e2e
```

### Project Structure

```
chat-web-desktop/
├── index.js              # Main Electron process
├── preload.js            # Renderer preload script
├── package.json          # Project configuration
├── README.md             # This file
├── ARCHITECTURE.md       # System architecture documentation
├── AI_DEV_GUIDE.md       # AI developer guide
├── NOTICE.md             # Legal notices
├── icons/                # Application icons
├── tests/                # Test files
└── user_data/            # Runtime user data
```

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Comprehensive system architecture specification
- **[AI_DEV_GUIDE.md](AI_DEV_GUIDE.md)** - Development guide specifically for AI agents
- **[NOTICE.md](NOTICE.md)** - Legal notices and disclaimers

## Configuration

Configuration is stored in `user_data/config.json` next to the executable.

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

## Testing

### Unit Tests

Test configuration helpers and pure functions:

```bash
npm test
```

### End-to-End Tests

Test full application flow with Playwright:

```bash
npm run test:e2e
```

## Build & Distribution

### Windows MSI Build

```bash
npm run dist:msi
```

Output: `dist/Chat Web Desktop Setup x.x.x.msi`

### Build Configuration

Build settings are defined in `package.json` under the `build` section, including:
- Application metadata
- Icon paths
- File inclusion/exclusion
- Platform-specific settings

## Troubleshooting

### Common Issues

- **No profiles configured**: Use "Configure" from tray menu or splash screen
- **Icons not loading**: Ensure icon files exist and are in supported formats (PNG/ICO/ICNS)
- **User-Agent not working**: Check that the User-Agent string is valid
- **Tray not appearing**: Check system tray settings and antivirus software

### Debug Mode

Enable verbose logging:

```bash
DEBUG=electron* npm start
```

### Reset Configuration

Delete `user_data/config.json` or use "Clear All" in the configuration window.

## License

ISC License - See [NOTICE.md](NOTICE.md) for additional legal information.
