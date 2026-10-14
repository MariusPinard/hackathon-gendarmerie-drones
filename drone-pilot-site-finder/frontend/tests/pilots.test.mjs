import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { autoPlace, coverage, nearestFreeSite, operationTargets, siteAt } from '../src/pilots.ts'

const commune = JSON.parse(readFileSync(new URL('../public/occupancy/commune-09194.json', import.meta.url), 'utf-8'))
const occupancy = commune.occupancy
// Bastide de Mirepoix et faubourgs (zone d'opération d'essai).
const bourg = { type: 'Polygon', coordinates: [[[1.866, 43.083], [1.884, 43.083], [1.884, 43.092], [1.866, 43.092], [1.866, 43.083]]] }

test('site lookup reports the occupancy status under a point', () => {
  const cathedral = siteAt(occupancy, [1.8748, 43.0872])
  assert.equal(cathedral.verdict, 'impossible')
  assert.equal(siteAt(occupancy, [0, 0]).verdict, 'unknown')
})

test('a pilot on a building can be moved to the nearest free cell', () => {
  const site = nearestFreeSite(occupancy, [1.8748, 43.0872], 800)
  assert.ok(site && site.distance < 800)
  assert.notEqual(siteAt(occupancy, site.position).verdict, 'impossible')
})

test('automatic placement only uses free cells and covers the bourg', () => {
  const started = performance.now()
  const result = autoPlace(bourg, occupancy, [], 'TP1', 10)
  const elapsed = performance.now() - started
  assert.ok(result.placed.length >= 1 && result.placed.length <= 10)
  for (const pilot of result.placed) assert.ok(['free', 'free_unconfirmed'].includes(siteAt(occupancy, pilot.position).zone?.status))
  assert.ok(result.coverage >= 0.98, `coverage ${result.coverage}`)
  assert.equal(coverage(operationTargets(bourg), result.placed).toFixed(3), result.coverage.toFixed(3))
  console.log(`  ${result.placed.length} TP1, couverture ${(result.coverage * 100).toFixed(1)} %, ${result.candidates} candidats, ${elapsed.toFixed(0)} ms`)
  const tp2 = autoPlace(bourg, occupancy, [], 'TP2', 10)
  assert.ok(tp2.placed.length <= result.placed.length)
})
