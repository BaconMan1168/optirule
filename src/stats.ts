export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function bootstrapCI(
  values: number[],
  iterations = 1000,
  alpha = 0.05,
): [number, number] {
  if (values.length === 0) return [0, 0];
  const random = seededRandom(20260721);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      sum += values[Math.floor(random() * values.length)]!;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const low = means[Math.floor((alpha / 2) * iterations)]!;
  const high = means[Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations))]!;
  return [low, high];
}
