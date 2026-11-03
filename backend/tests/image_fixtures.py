import sys
from pathlib import Path

from PIL import Image, ImageDraw


def create_images(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    picture = Image.new("RGB", (2400, 1500), "#a3b3b5")
    draw = ImageDraw.Draw(picture)
    draw.ellipse((1770, 180, 2010, 420), fill="#e1ce9d")
    draw.polygon(
        [(0, 1100), (0, 800), (650, 280), (1100, 900), (1500, 390), (2400, 1100)], fill="#7a8c8b"
    )
    draw.polygon(
        [(0, 1500), (0, 1150), (700, 700), (1350, 1300), (2100, 650), (2400, 950), (2400, 1500)],
        fill="#526966",
    )
    draw.rectangle((0, 1300, 2400, 1500), fill="#a2b8b3")
    picture.save(directory / "mountains.jpg", quality=98)
    frames = [Image.new("RGB", (320, 180), color) for color in ("#d35c42", "#507bbd")]
    frames[0].save(
        directory / "animated.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[200, 350],
        loop=0,
    )


if __name__ == "__main__":
    create_images(Path(sys.argv[1]))
