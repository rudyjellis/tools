#!/usr/bin/env python3
"""
Direct Google Gemini Image Generation
Uses gemini-2.5-flash-image (standard) or gemini-3-pro-image-preview (pro)
"""

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def ensure_dependencies():
    """Install required packages if missing."""
    try:
        from google import genai
        from google.genai import types
        return genai, types
    except ImportError:
        print("Installing google-genai and pillow...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "google-genai", "pillow", "-q"])
        from google import genai
        from google.genai import types
        return genai, types


def generate_image(prompt: str, model: str = "pro", output_path: str = None, api_key: str = None):
    """
    Generate an image using Google's Gemini API.

    Args:
        prompt: Text description of the image to generate
        model: "standard" (gemini-2.5-flash-image) or "pro" (gemini-3-pro-image-preview)
        output_path: Optional output file path
        api_key: Gemini API key

    Returns:
        Path to the saved image
    """
    genai, types = ensure_dependencies()

    if not api_key:
        import os
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set")

    # Model selection
    models = {
        "standard": "gemini-2.5-flash-image",  # Nano Banana
        "pro": "gemini-3-pro-image-preview",   # Nano Banana Pro (4K)
    }
    model_id = models.get(model, models["pro"])

    print(f"Model: {model_id}")
    print(f"Prompt: {prompt[:80]}{'...' if len(prompt) > 80 else ''}")

    client = genai.Client(api_key=api_key)

    response = client.models.generate_content(
        model=model_id,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_modalities=["Text", "Image"]
        ),
    )

    # Determine output path
    if output_path:
        save_path = Path(output_path)
    else:
        output_dir = Path.cwd() / "generated_imgs"
        output_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        save_path = output_dir / f"gemini-{timestamp}.png"

    # Ensure parent directory exists
    save_path.parent.mkdir(parents=True, exist_ok=True)

    # Extract and save image
    for part in response.parts:
        if part.text is not None:
            print(f"AI response: {part.text}")
        elif part.inline_data is not None:
            image = part.as_image()
            image.save(str(save_path))
            print(f"Saved: {save_path}")
            return str(save_path)

    raise Exception("No image returned in response")


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Google Gemini API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate.py "A mountain landscape at sunset"
  python generate.py "Logo design" --model standard
  python generate.py "OG image for website" --output ./og-image.png
  python generate.py "Banner" --model pro --output ./banner.png
        """
    )
    parser.add_argument("prompt", help="Image description/prompt")
    parser.add_argument(
        "--model", "-m",
        choices=["standard", "pro"],
        default="pro",
        help="Model: 'standard' (fast) or 'pro' (4K quality, default)"
    )
    parser.add_argument(
        "--output", "-o",
        help="Output file path (default: ./generated_imgs/gemini-TIMESTAMP.png)"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (default: uses GEMINI_API_KEY env var)"
    )

    args = parser.parse_args()

    try:
        path = generate_image(
            prompt=args.prompt,
            model=args.model,
            output_path=args.output,
            api_key=args.api_key
        )
        print(f"\nSuccess! Image saved to: {path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
