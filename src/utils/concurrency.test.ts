import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("keeps the order of the input and never exceeds the limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await mapWithConcurrency([30, 10, 20, 0, 5], 2, async (delay, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delay));
      inFlight--;
      return `${index}:${delay}`;
    });

    expect(results).toEqual(["0:30", "1:10", "2:20", "3:0", "4:5"]);
    expect(maxInFlight).toBe(2);
  });

  it("handles an empty list", async () => {
    const fn = jest.fn();
    expect(await mapWithConcurrency([], 3, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
