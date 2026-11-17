const fraction = (value: number) => value - Math.floor(value);
const seed = (index: number, salt: number) =>
  fraction(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453);
const wrap = (value: number, size: number) => ((value % size) + size) % size;

function visible(rect: DOMRect, x: number, y: number, margin = 6) {
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}

export function drawSnow(
  context: CanvasRenderingContext2D,
  rect: DOMRect,
  seconds: number,
  ink: string,
) {
  const width = innerWidth + 20;
  const height = innerHeight + 20;
  const count = Math.ceil((width * height) / 12000);
  context.fillStyle = ink;
  context.strokeStyle = ink;
  context.lineWidth = 0.8;
  for (let index = 0; index < count; index += 1) {
    const speed = 9 + seed(index, 1) * 15;
    const sway = Math.sin(seconds * 0.3 + seed(index, 2) * Math.PI * 2) * 12;
    const x = wrap(seed(index, 3) * width + seconds * 2 + sway, width) - 10;
    const y = wrap(seed(index, 4) * height + seconds * speed, height) - 10;
    if (!visible(rect, x, y)) continue;
    const radius = 0.9 + seed(index, 5) * 1.8;
    const localX = x - rect.left;
    const localY = y - rect.top;
    context.globalAlpha = 0.2 + seed(index, 6) * 0.3;
    context.beginPath();
    if (index % 7 === 0) {
      context.moveTo(localX - radius, localY);
      context.lineTo(localX + radius, localY);
      context.moveTo(localX, localY - radius);
      context.lineTo(localX, localY + radius);
      context.stroke();
    } else {
      context.arc(localX, localY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

export function drawStars(
  context: CanvasRenderingContext2D,
  rect: DOMRect,
  seconds: number,
  accent: string,
  ink: string,
) {
  const count = Math.ceil((innerWidth * innerHeight) / 10000);
  for (let index = 0; index < count; index += 1) {
    const x = seed(index, 11) * innerWidth;
    const y = seed(index, 12) * innerHeight;
    if (!visible(rect, x, y)) continue;
    const phase = seed(index, 13) * Math.PI * 2;
    const twinkle =
      (Math.sin(seconds * (0.35 + seed(index, 14) * 0.3) + phase) + 1) / 2;
    const localX = x - rect.left;
    const localY = y - rect.top;
    const featured = index % 9 === 0;
    context.globalAlpha = 0.15 + twinkle * 0.4;
    context.fillStyle = featured ? accent : ink;
    context.beginPath();
    if (featured) {
      const radius = 2.8 + twinkle;
      context.moveTo(localX, localY - radius);
      context.lineTo(localX + radius * 0.24, localY - radius * 0.24);
      context.lineTo(localX + radius, localY);
      context.lineTo(localX + radius * 0.24, localY + radius * 0.24);
      context.lineTo(localX, localY + radius);
      context.lineTo(localX - radius * 0.24, localY + radius * 0.24);
      context.lineTo(localX - radius, localY);
      context.lineTo(localX - radius * 0.24, localY - radius * 0.24);
      context.closePath();
    } else
      context.arc(localX, localY, 0.55 + seed(index, 15) * 0.8, 0, Math.PI * 2);
    context.fill();
  }
}
