import { describe, it, expect } from "vitest";
import { distanceToPolyline, edgePoints, H_PADDING, LANE_WIDTH } from "./GraphCanvas";

const laneX = (lane: number) => H_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;

describe("edge hit testing", () => {
  it("measures the distance to a vertical line", () => {
    const points = edgePoints({ fromRow: 0, fromLane: 1, toRow: 4, toLane: 1, color: "", curve: "end" }, 30);
    expect(distanceToPolyline(points, laneX(1) + 3, 60)).toBeCloseTo(3);
    expect(distanceToPolyline(points, laneX(1) + 20, 60)).toBeCloseTo(20);
  });

  it("follows a curve to the other lane", () => {
    const points = edgePoints({ fromRow: 0, fromLane: 0, toRow: 3, toLane: 2, color: "", curve: "start" }, 30);
    expect(points[0]).toEqual([laneX(0), 15]);
    expect(points[points.length - 1]).toEqual([laneX(2), 105]);
    // Au milieu de la dernière portion verticale, dans la colonne du parent.
    expect(distanceToPolyline(points, laneX(2), 90)).toBeLessThan(1);
  });
});
