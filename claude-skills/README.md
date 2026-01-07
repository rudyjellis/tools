# Claude Code Skills

Custom skills for [Claude Code](https://claude.com/claude-code) that work across all projects.

## Installation

Copy any skill folder to your personal skills directory:

```bash
cp -r generate-image ~/.claude/skills/
```

Then restart Claude Code to load the skill.

## Available Skills

### generate-image

Generate images using Google's Gemini API directly.

**Requirements:**
- `GEMINI_API_KEY` environment variable
- Python 3.8+

**Usage:**
```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "your prompt" --model pro
```

**Models:**
| Model | Flag | Quality |
|-------|------|---------|
| Pro (default) | `--model pro` | 4K, best quality |
| Standard | `--model standard` | Fast, good for drafts |

See [generate-image/SKILL.md](generate-image/SKILL.md) for full documentation.

## Environment Setup

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export GEMINI_API_KEY="your-api-key-here"
```
