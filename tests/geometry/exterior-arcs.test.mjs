import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outsideCoverageArc, project, pointInPolygon } from '../../src/engines/geometry/index.ts';
const operation = { type: 'Polygon', coordinates: [[[-.003,-.003],[.003,-.003],[.003,.003],[-.003,.003],[-.003,-.003]]] };

test('exterior dashed arcs stay within the work angle, including a sector crossing north', () => {
  for (const [headingDegrees, workingAngleDegrees] of [[0,60],[350,45],[120,180],[90,5]]) {
    const coverage = { center: [0,0], radiusMeters: 1000, headingDegrees, workingAngleDegrees };
    const arcs = outsideCoverageArc(coverage, operation);
    assert.ok(arcs.length > 0);
    for (const arc of arcs) for (const point of arc) {
      const [x,y] = project(point, coverage.center), bearing = (Math.atan2(x,y)*180/Math.PI+360)%360;
      const difference = Math.abs(((bearing-headingDegrees+540)%360)-180);
      assert.ok(difference <= workingAngleDegrees/2+1e-7);
      assert.ok(Math.hypot(x,y) > 990, 'radial sides must not appear');
    }
    for (const arc of arcs) for (let i=1;i<arc.length;i++) {
      const a=arc[i-1],b=arc[i];
      assert.equal(pointInPolygon([(a[0]+b[0])/2,(a[1]+b[1])/2],operation),false);
    }
  }
});

test('a work arc fully inside operation has no dashed exterior, while 360 degrees remains supported', () => {
  const coverage = { center:[0,0],radiusMeters:100,headingDegrees:0,workingAngleDegrees:90 };
  assert.deepEqual(outsideCoverageArc(coverage,operation),[]);
  const full = outsideCoverageArc({...coverage,radiusMeters:1000,workingAngleDegrees:360},operation);
  assert.equal(full.length,1); assert.equal(full[0].length,73);
});
