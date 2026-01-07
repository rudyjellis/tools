---
name: generate-image
description: Generate images using Google Gemini API. Use when the user asks to create, generate, or make images, artwork, visuals, illustrations, OG images, banners, or graphics.
allowed-tools: Bash, Read, Write
---

# Image Generation Skill

Generate images using Google's Gemini API directly (gemini-2.5-flash-image or gemini-3-pro-image-preview).

## Requirements

- `GEMINI_API_KEY` environment variable must be set
- Python 3.8+ (dependencies auto-install on first run)

## Usage

Run the generation script:

```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "YOUR PROMPT HERE"
```

### Options

| Flag | Description |
|------|-------------|
| `--model`, `-m` | `standard` (fast) or `pro` (4K quality, default) |
| `--output`, `-o` | Custom output path (default: ./generated_imgs/gemini-TIMESTAMP.png) |
| `--api-key`, `-k` | Override API key (default: uses GEMINI_API_KEY env var) |

## Examples

### Basic generation
```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "A serene mountain landscape at golden hour"
```

### OG image for social sharing
```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "Professional OG image with dark green background, white text 'Company Name', coral and mint accents, 1200x630 for social media" --output ./og-image.png
```

### Fast generation (standard model)
```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "Quick sketch of a robot" --model standard
```

### Specific output location
```bash
python3 ~/.claude/skills/generate-image/scripts/generate.py "Product hero image" --output ./assets/hero.png
```

## Models

| Model | ID | Best For |
|-------|-----|----------|
| **Pro** (default) | gemini-3-pro-image-preview | High quality, 4K resolution, detailed work |
| **Standard** | gemini-2.5-flash-image | Fast iteration, drafts, lower cost |

## Output

- Images save to `./generated_imgs/` by default (created automatically)
- Use `--output` to specify exact path and filename
- Format: PNG

## Prompting Tips

- Be specific about style, colors, composition
- Mention dimensions if important (e.g., "1200x630 for social media")
- Include context (e.g., "for a tech startup website")
- Reference design elements (e.g., "minimalist", "gradient background")
