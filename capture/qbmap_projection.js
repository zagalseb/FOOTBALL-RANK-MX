// qbmap_projection.js — ground-plane perspective for the QB Map viewer
// (qbmap_view.html). Pure math, no DOM. Depth comes from qbmap_geometry.js
// (relFromAbs = dir * (abs - losAbs)); this module only turns
// (lateral, normalized depth) into screen coordinates.
//
// One continuous formula for x and y, no special case behind the LOS:
//   u(d) = D / (D + d)
//   x    = cx + Sx * (lat - 26.5) * u(d)
//   y    = yTop + B * (u(d) - u(D_MAX))
// d = yards past the LOS (negative = behind it), lat = 0..53 (QB's left to right).

import { FIELD_WIDTH } from './qbmap_geometry.js'

export const CFG = {
  VIEW_W: 1000,
  VIEW_H: 600,
  D: 180,                // perspective distance: larger = flatter, less convergence
  Sx: 15,                // horizontal scale, px per yard at u = 1
  B: 1810,               // vertical scale, px per unit of u
  cx: 500,               // horizontal center (lateral 26.5)
  yTop: 60,              // screen y of d = D_MAX
  D_MIN: -10,            // nearest depth drawn (dropback edge); deeper launches pin here
  D_MAX: 50,             // farthest depth drawn; deeper targets pin here
  LIFT_PER_YD: 1.8,      // px of arc height per yard of pass depth (aesthetic only)
  LIFT_MAX: 60,
}

// Perspective scale at depth d. u(0) = 1 at the LOS.
export const u = d => CFG.D / (CFG.D + d)

// -> { x, y, clamped }; `clamped` = depth was outside [D_MIN, D_MAX] and pinned.
export function project(lat, depth) {
  const d = Math.min(CFG.D_MAX, Math.max(CFG.D_MIN, depth))
  const k = u(d)
  return {
    x: CFG.cx + CFG.Sx * (lat - FIELD_WIDTH / 2) * k,
    y: CFG.yTop + CFG.B * (k - u(CFG.D_MAX)),
    clamped: d !== depth,
  }
}

// Marker radii at depth d. `size` is the Visualización multiplier (1 = default).
export function markerRadii(d, size = 1) {
  const rx = 0.85 * CFG.Sx * u(d) * size
  return { rx, ry: 0.58 * rx }
}

// Quadratic arc between two projected points. The control point sits above the
// midpoint by an amount proportional to the pass's depth change, so deep passes
// read as higher. Aesthetic only, not a measured height.
export function arcPath(a, b, depthSpan) {
  const lift = Math.min(CFG.LIFT_MAX, Math.abs(depthSpan) * CFG.LIFT_PER_YD)
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 - 2 * lift   // quadratic apex is half the control offset
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}
