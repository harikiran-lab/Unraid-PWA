// Locally ordered reads avoid comparing the browser clock with the NAS clock.
let generation = 0;
export function dockerReadGeneration(): number { return generation; }
export function invalidateDockerReads(): void { generation += 1; }
