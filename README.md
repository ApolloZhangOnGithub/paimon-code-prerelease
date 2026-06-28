# pi-coding-master

Living AI agent extension for [pi-coding-agent](https://github.com/nicepkg/pi-coding-agent).

## Install

```bash
# 1. Install pi (pinned version)
npm i -g @earendil-works/pi-coding-agent@0.79.10

# 2. Install pi-coding-master
npm i -g pi-coding-master

# Done. Run: pi <person-name>
```

## Update

```bash
npm i -g pi-coding-master@latest
```

## Manual Install

```bash
# Download release, then:
bash deploy/install.sh
```

## Requirements

- Node.js >= 18
- macOS or Linux
- tmux (for subconscious/hippocampus)
- bun (for TypeScript extension loading)

## What it does

pi-coding-master turns pi into a persistent, living agent with:

- **Heartbeat** - continuous mode with next()/wait/hibernate state machine
- **Memory** - 5-layer memory system (DNA/Context/WorkMemory/Cortex/DeepCortex)
- **Subconscious** - parallel observer process that reflects on main consciousness
- **Hippocampus** - memory encoding subprocess
- **Sleep** - memory consolidation (work_memory -> cortex)
- **Senses** - ears (speech-to-text), mouth (TTS), phone (browser/apps)

## License

MIT
