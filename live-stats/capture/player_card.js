// Draws a "Player Card" stat graphic onto a 2D canvas context. Pure —
// takes already-loaded image objects (or null) and plain data, no DOM/
// network access, so it works identically in the browser (Reports tab) and
// in a Node + node-canvas script used only to preview layouts during
// development. No canvas-API feature is used beyond what both environments
// support (manual rounded-rect path instead of ctx.roundRect, for safety
// on older browsers).

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y,     x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x,     y + h, r)
  ctx.arcTo(x,     y + h, x,     y,     r)
  ctx.arcTo(x,     y,     x + w, y,     r)
  ctx.closePath()
}

// CSS object-fit:cover equivalent — fills the target rect, cropping
// whichever axis overflows, instead of stretching or letterboxing.
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height
  const boxRatio = w / h
  let sx, sy, sw, sh
  if (imgRatio > boxRatio) {
    sh = img.height
    sw = sh * boxRatio
    sx = (img.width - sw) / 2
    sy = 0
  } else {
    sw = img.width
    sh = sw / boxRatio
    sx = 0
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// Site logo (bottom-right) and photo credit (bottom-left), overlaid directly
// on the player photo — which can be light or dark at that exact spot, so
// neither element can rely on a fixed text/image color for legibility. Same
// problem as the site wordmark's -webkit-text-stroke/text-shadow treatment,
// solved here with a dark semi-transparent pill behind each element instead
// (works uniformly for both an arbitrary photo image AND a raster logo,
// where a CSS-style stroke isn't applicable).
function drawPhotoOverlays(ctx, photoX, photoY, photoW, photoH, siteLogoImg, photoCredit, badgeH, FAMILY) {
  const margin = Math.min(photoW, photoH) * 0.025

  if (siteLogoImg) {
    const logoH = badgeH
    const logoW = logoH * (siteLogoImg.width / siteLogoImg.height)
    const padX = logoH * 0.35, padY = logoH * 0.25
    const boxW = logoW + padX * 2, boxH = logoH + padY * 2
    const boxX = photoX + photoW - margin - boxW
    const boxY = photoY + photoH - margin - boxH
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    roundRectPath(ctx, boxX, boxY, boxW, boxH, boxH * 0.2)
    ctx.fill()
    ctx.drawImage(siteLogoImg, boxX + padX, boxY + padY, logoW, logoH)
  }

  if (photoCredit && photoCredit.trim()) {
    const fontPx = badgeH * 0.32
    ctx.font = `600 ${fontPx}px ${FAMILY}`
    const textW = ctx.measureText(photoCredit).width
    const padX = fontPx * 0.55, padY = fontPx * 0.5
    const boxW = textW + padX * 2, boxH = fontPx + padY * 2
    const boxX = photoX + margin
    const boxY = photoY + photoH - margin - boxH
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    roundRectPath(ctx, boxX, boxY, boxW, boxH, boxH * 0.25)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(photoCredit, boxX + padX, boxY + boxH / 2)
  }
}

function drawPlaceholderPhoto(ctx, x, y, w, h, teamColor, teamTextColor, number) {
  ctx.fillStyle = shade(teamColor, -0.35)
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = teamTextColor
  ctx.globalAlpha = 0.35
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(h * 0.5)}px 'IBM Plex Mono', monospace`
  ctx.fillText(`#${number ?? '?'}`, x + w / 2, y + h / 2)
  ctx.globalAlpha = 1
}

// Darkens/lightens a hex color by `amt` (-1..1) — used only for the
// placeholder-photo fallback shade, not for any team-color source of truth.
function shade(hex, amt) {
  const c = (hex || '#333333').replace('#', '')
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16)
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff
  const f = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  r = Math.round(r + (f - r) * p)
  g = Math.round(g + (f - g) * p)
  b = Math.round(b + (f - b) * p)
  return `rgb(${r},${g},${b})`
}

// Picks black or white text for readability against an arbitrary team
// color, ONLY as a fallback when color_texto is missing — teams.color_texto
// is otherwise always the source of truth.
function readableTextColor(bgHex) {
  const c = (bgHex || '#333333').replace('#', '')
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16)
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#111318' : '#ffffff'
}

function _hexToRgb(hex) {
  const c = (hex || '#333333').replace('#', '')
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c
  const num = parseInt(full, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

// WCAG relative luminance + contrast ratio against a pure-white background —
// used to decide whether a team's own color_principal is dark enough to read
// on the white bars, since ONEFA teams range from near-black navys to pale
// golds/yellows/whites.
function _relLuminance({ r, g, b }) {
  const lin = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function _contrastOnWhite(hex) {
  const L = _relLuminance(_hexToRgb(hex))
  return 1.05 / (L + 0.05)
}

// Text color for the white bars (name/stats): prefers the team's
// color_principal (keeps the card's own identity), falls back to
// color_texto if principal is too pale to read on white (e.g. a pale
// gold/yellow/near-white principal), and finally to a dark neutral if even
// color_texto doesn't clear the bar — never assumes any of the 14 ONEFA
// teams' colors are safe by default.
const MIN_CONTRAST_ON_WHITE = 2.6
function pickBarTextColor(principal, texto) {
  if (principal && _contrastOnWhite(principal) >= MIN_CONTRAST_ON_WHITE) return principal
  if (texto && _contrastOnWhite(texto) >= MIN_CONTRAST_ON_WHITE) return texto
  return '#111318'
}

function fitFontSize(ctx, text, maxWidth, startPx, weight, family) {
  let px = startPx
  while (px > 12) {
    ctx.font = `${weight} ${px}px ${family}`
    if (ctx.measureText(text).width <= maxWidth) break
    px -= 2
  }
  return px
}

// opts: {
//   orientation: 'vertical' | 'horizontal',
//   teamColor, teamText,        // hex strings (teams.color_principal/color_texto)
//   teamLogoImg,                // loaded image or null
//   photoImg,                   // loaded image or null
//   siteLogoImg,                // loaded image or null — "cover 0 stats logo.png", bottom-right of the photo
//   photoCredit,                // free text or null/'' — bottom-left of the photo, omitted entirely when blank
//   playerName, playerNumber, playerPosition,
//   teamName,                   // abbreviation shown in the subtitle line
//   stats: [{ label, value }],  // already formatted, in display order
// }
export function drawPlayerCard(ctx, W, H, opts) {
  const {
    orientation, teamColor, teamText, teamLogoImg, photoImg,
    siteLogoImg, photoCredit,
    playerName, playerNumber, playerPosition, teamName, stats,
  } = opts
  const textColor = teamText || readableTextColor(teamColor)
  // Name bar and stats bar are near-white with team-colored text (photo
  // placeholder and logo are unaffected — textColor above still drives
  // those). barTextColor prefers color_principal but falls back to
  // color_texto (or a dark neutral) when principal is too pale to read on
  // a white background — see pickBarTextColor.
  const barBg = '#f7f7f4'
  const barTextColor = pickBarTextColor(teamColor, teamText)
  const FAMILY = "'IBM Plex Mono', monospace"

  ctx.fillStyle = '#0d0f12'
  ctx.fillRect(0, 0, W, H)

  if (orientation === 'vertical') {
    const nameBarH = H * 0.10
    const subBarH  = H * 0.05
    const statsBarH = H * 0.16
    const photoY = nameBarH + subBarH
    const photoH = H - photoY - statsBarH

    // Name bar — the name is centered within the zone to the right of the
    // logo, not across the full width, so a long name can never overlap it
    // (a fixed-position logo + full-width-centered text collided in testing).
    ctx.fillStyle = barBg
    ctx.fillRect(0, 0, W, nameBarH)

    let logoW = 0
    const logoH = nameBarH * 0.6
    if (teamLogoImg) logoW = logoH * (teamLogoImg.width / teamLogoImg.height)
    const logoZoneW = teamLogoImg ? logoW + W * 0.08 : 0
    const nameZoneX = logoZoneW
    const nameZoneW = W - logoZoneW - W * 0.04

    ctx.fillStyle = barTextColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const nameSize = fitFontSize(ctx, playerName.toUpperCase(), nameZoneW * 0.95, nameBarH * 0.5, 800, FAMILY)
    ctx.font = `800 ${nameSize}px ${FAMILY}`
    ctx.fillText(playerName.toUpperCase(), nameZoneX + nameZoneW / 2, nameBarH / 2)

    if (teamLogoImg) {
      ctx.drawImage(teamLogoImg, W * 0.04, (nameBarH - logoH) / 2, logoW, logoH)
    }

    // Subtitle bar — unchanged, still dark/neutral per explicit instruction.
    ctx.fillStyle = '#e8eaed'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${subBarH * 0.42}px ${FAMILY}`
    const subtitle = `#${playerNumber} · ${teamName} · ${playerPosition || '—'}`
    ctx.fillText(subtitle, W / 2, nameBarH + subBarH / 2)

    // Photo — unchanged (placeholder still uses teamColor/textColor, not the bar palette).
    if (photoImg) drawImageCover(ctx, photoImg, 0, photoY, W, photoH)
    else drawPlaceholderPhoto(ctx, 0, photoY, W, photoH, teamColor, textColor, playerNumber)

    drawPhotoOverlays(ctx, 0, photoY, W, photoH, siteLogoImg, photoCredit, nameBarH * 0.5, FAMILY)

    // Stats bar — single row, N equal columns
    const statsY = H - statsBarH
    ctx.fillStyle = barBg
    ctx.fillRect(0, statsY, W, statsBarH)
    drawStatsRow(ctx, 0, statsY, W, statsBarH, stats, barTextColor, FAMILY)

  } else {
    // horizontal
    const photoW = W * 0.42
    const rightX = photoW
    const rightW = W - photoW
    const nameBarH = H * 0.20
    const subBarH  = H * 0.10

    // Photo (left column, full height)
    if (photoImg) drawImageCover(ctx, photoImg, 0, 0, photoW, H)
    else drawPlaceholderPhoto(ctx, 0, 0, photoW, H, teamColor, textColor, playerNumber)

    drawPhotoOverlays(ctx, 0, 0, photoW, H, siteLogoImg, photoCredit, nameBarH * 0.45, FAMILY)

    // Name bar (right column, top) — same logo-avoidance layout as vertical.
    ctx.fillStyle = barBg
    ctx.fillRect(rightX, 0, rightW, nameBarH)

    let hLogoW = 0
    const hLogoH = nameBarH * 0.55
    if (teamLogoImg) hLogoW = hLogoH * (teamLogoImg.width / teamLogoImg.height)
    const hLogoZoneW = teamLogoImg ? hLogoW + rightW * 0.08 : 0
    const hNameZoneX = rightX + hLogoZoneW
    const hNameZoneW = rightW - hLogoZoneW - rightW * 0.05

    ctx.fillStyle = barTextColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const nameSize = fitFontSize(ctx, playerName.toUpperCase(), hNameZoneW * 0.95, nameBarH * 0.42, 800, FAMILY)
    ctx.font = `800 ${nameSize}px ${FAMILY}`
    ctx.fillText(playerName.toUpperCase(), hNameZoneX + hNameZoneW / 2, nameBarH / 2)

    if (teamLogoImg) {
      ctx.drawImage(teamLogoImg, rightX + rightW * 0.05, (nameBarH - hLogoH) / 2, hLogoW, hLogoH)
    }

    // Subtitle — unchanged, still dark/neutral per explicit instruction.
    ctx.fillStyle = '#e8eaed'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${subBarH * 0.32}px ${FAMILY}`
    const subtitle = `#${playerNumber} · ${teamName} · ${playerPosition || '—'}`
    ctx.fillText(subtitle, rightX + rightW / 2, nameBarH + subBarH / 2)

    // Stats grid (right column, remaining space) — 2 columns, as many rows as needed
    const gridY = nameBarH + subBarH
    const gridH = H - gridY
    ctx.fillStyle = barBg
    ctx.fillRect(rightX, gridY, rightW, gridH)
    drawStatsGrid(ctx, rightX, gridY, rightW, gridH, stats, barTextColor, FAMILY, 2)
  }
}

// Finds the largest font size (<= startPx) at which EVERY string in `items`
// fits within maxW — used so all labels share one size and all values share
// another, instead of each cell shrinking independently (which made "44"
// and "17.8" render at very different, visually inconsistent sizes when
// tested per-cell).
function fitFontSizeForAll(ctx, items, maxW, startPx, weight, family) {
  let px = startPx
  while (px > 10) {
    ctx.font = `${weight} ${px}px ${family}`
    if (items.every(t => ctx.measureText(t).width <= maxW)) break
    px -= 2
  }
  return px
}

// Label and value sizes are each computed once across ALL stats (not per
// cell) so every column reads at the same visual weight — sized against the
// narrowest column, since that's the one most likely to clip.
function drawStatsRow(ctx, x, y, w, h, stats, textColor, FAMILY) {
  if (!stats.length) return
  const colW = w / stats.length
  const maxW = colW - colW * 0.16
  const labelPx = fitFontSizeForAll(ctx, stats.map(s => s.label), maxW, h * 0.22, 600, FAMILY)
  const valuePx = fitFontSizeForAll(ctx, stats.map(s => String(s.value)), maxW, h * 0.4, 800, FAMILY)

  stats.forEach((s, i) => {
    const cx = x + colW * i + colW / 2
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.75
    ctx.textBaseline = 'top'
    ctx.font = `600 ${labelPx}px ${FAMILY}`
    ctx.fillText(s.label, cx, y + h * 0.16)
    ctx.globalAlpha = 1
    ctx.textBaseline = 'bottom'
    ctx.font = `800 ${valuePx}px ${FAMILY}`
    ctx.fillText(String(s.value), cx, y + h * 0.9)
  })
}

// Exact same badge treatment as viewer.html's <TeamLogo> (the header logo
// next to each team's name, live ticker included) — a white circle, a thin
// neutral border + soft shadow (var(--border)/var(--shadow-sm), NOT a
// team-colored ring), and the logo inside fit with object-fit:contain
// (whole image visible, aspect preserved, never cropped) within a padded
// inner box (padding = 8% of the diameter on every side, same ratio as
// viewer.html's `padding: size * 0.08`). Two logos of very different native
// aspect ratios (a square crest vs. a wide wordmark-style logo) still land
// at the same circle size — "contain" just leaves more white margin around
// the narrower one instead of cropping the wider one.
function _drawCircleLogo(ctx, img, cx, cy, r) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.12)'
  ctx.shadowBlur = r * 0.12
  ctx.shadowOffsetY = r * 0.03
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = Math.max(1, r * 0.02)
  ctx.stroke()

  if (img) {
    const pad = r * 2 * 0.08
    const innerSize = r * 2 - pad * 2
    const boxX = cx - r + pad
    const boxY = cy - r + pad
    const imgRatio = img.width / img.height
    let dw, dh
    if (imgRatio > 1) { dw = innerSize; dh = innerSize / imgRatio }
    else { dh = innerSize; dw = innerSize * imgRatio }
    ctx.drawImage(img, boxX + (innerSize - dw) / 2, boxY + (innerSize - dh) / 2, dw, dh)
  }
}

// ── Box Score card ────────────────────────────────────────────────────────────
// opts: {
//   orientation: 'vertical' | 'horizontal',
//   away: { abbr, color, text, logoImg }, home: { abbr, color, text, logoImg },
//         // color/text = teams.color_principal/color_texto, logoImg = loaded image or null
//   siteLogoImg,                // loaded image or null — drawn prominently, centered
//                                // between the two team logos (not a corner watermark
//                                // like the Player Card, which has a photo competing
//                                // for space — Box Score doesn't).
//   scoreLabel,                  // e.g. "17 - 10", already formatted, or null
//   statusLabel,                 // e.g. "3rd Q · 8:42" or "FINAL", or null
//   rows: [{ label, awayVal, homeVal }],  // already formatted, in display order
// }
export function drawBoxScore(ctx, W, H, opts) {
  const { orientation, away, home, siteLogoImg, scoreLabel, statusLabel, rows } = opts
  const FAMILY = "'IBM Plex Mono', monospace"
  const barBg = '#f7f7f4'
  // Same white-bg / dynamic-team-text-color language as the Player Card bars —
  // each side of the table gets its own team's color (falling back to
  // color_texto, then a dark neutral) via the same pickBarTextColor contrast
  // check, since the away/home principal colors are independent and either
  // one could be too pale to read on white.
  const awayColor = pickBarTextColor(away.color, away.text)
  const homeColor = pickBarTextColor(home.color, home.text)

  ctx.fillStyle = barBg
  ctx.fillRect(0, 0, W, H)

  // Taller than before (was single-row logos+VS) — now two rows: team
  // circles + site logo, then score/status underneath.
  const headerH = orientation === 'vertical' ? H * 0.17 : H * 0.30
  _drawBoxScoreHeader(ctx, 0, 0, W, headerH, away, home, awayColor, homeColor, siteLogoImg, scoreLabel, statusLabel, FAMILY)

  // Vertical always stacks rows in one column (plenty of vertical room even
  // at 17 rows). Horizontal is much shorter, so a long checklist splits into
  // 2 columns instead of shrinking every row until text clips.
  const useTwoCols = orientation === 'horizontal' && rows.length > 8
  _drawBoxScoreRows(ctx, 0, headerH, W, H - headerH, rows, awayColor, homeColor, FAMILY, useTwoCols ? 2 : 1)
}

function _drawBoxScoreHeader(ctx, x, y, w, h, away, home, awayColor, homeColor, siteLogoImg, scoreLabel, statusLabel, FAMILY) {
  const topH    = h * 0.64
  const bottomH = h - topH
  const zoneW   = w * 0.38   // outer team zones — leaves a clear middle band for the site logo

  const circleD = topH * 0.66
  _drawBoxScoreTeamHalf(ctx, x, y, zoneW, topH, away, awayColor, circleD, FAMILY)
  _drawBoxScoreTeamHalf(ctx, x + w - zoneW, y, zoneW, topH, home, homeColor, circleD, FAMILY)

  // Cover Cero logo — "presentado por" placement, centered between the two
  // teams. Deliberately bigger/plainer than the Player Card's corner
  // watermark treatment (no photo here competing for attention).
  if (siteLogoImg) {
    const logoH = topH * 0.5
    const logoW = logoH * (siteLogoImg.width / siteLogoImg.height)
    ctx.drawImage(siteLogoImg, x + w / 2 - logoW / 2, y + (topH - logoH) / 2, logoW, logoH)
  }

  // Score + status, centered under everything.
  ctx.textAlign = 'center'
  if (scoreLabel) {
    const scoreSize = bottomH * 0.46
    ctx.font = `800 ${scoreSize}px ${FAMILY}`
    ctx.fillStyle = '#111318'
    ctx.textBaseline = statusLabel ? 'alphabetic' : 'middle'
    ctx.fillText(scoreLabel, x + w / 2, y + topH + bottomH * (statusLabel ? 0.58 : 0.62))
  }
  if (statusLabel) {
    const statusSize = bottomH * 0.24
    ctx.font = `600 ${statusSize}px ${FAMILY}`
    ctx.fillStyle = '#5a6472'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(statusLabel, x + w / 2, y + topH + bottomH * 0.88)
  }
}

function _drawBoxScoreTeamHalf(ctx, x, y, w, h, team, textColor, circleD, FAMILY) {
  const gap = circleD * 0.16
  const abbrSize = h * 0.20
  ctx.font = `800 ${abbrSize}px ${FAMILY}`
  const abbrW = ctx.measureText(team.abbr).width
  const totalW = circleD + gap + abbrW
  const startX = x + (w - totalW) / 2
  const cy = y + h / 2

  _drawCircleLogo(ctx, team.logoImg, startX + circleD / 2, cy, circleD / 2)

  ctx.fillStyle = textColor
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(team.abbr, startX + circleD + gap, cy)
}

// Value and label sizes are each computed once across the WHOLE table (all
// rows, both columns when split) so every row reads at the same visual
// weight — same rationale as fitFontSizeForAll in the stats bar/grid above.
function _drawBoxScoreRows(ctx, x, y, w, h, rows, awayColor, homeColor, FAMILY, cols) {
  if (!rows.length) {
    ctx.fillStyle = '#8a94a3'
    ctx.font = `600 28px ${FAMILY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Selecciona stats para mostrar', x + w / 2, y + h / 2)
    return
  }

  const rowsPerCol = Math.ceil(rows.length / cols)
  const colW = w / cols
  const rowH = h / rowsPerCol
  const valueZoneW = colW * 0.26
  const labelZoneW = colW * 0.42

  const allValues = rows.flatMap(r => [String(r.awayVal), String(r.homeVal)])
  const allLabels = rows.map(r => r.label)
  const valuePx = fitFontSizeForAll(ctx, allValues, valueZoneW * 0.85, rowH * 0.44, 800, FAMILY)
  const labelPx = fitFontSizeForAll(ctx, allLabels, labelZoneW * 0.9, rowH * 0.26, 600, FAMILY)

  rows.forEach((r, i) => {
    const col = Math.floor(i / rowsPerCol)
    const rowInCol = i % rowsPerCol
    const rx = x + colW * col
    const ry = y + rowH * rowInCol

    if (rowInCol % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.035)'
      ctx.fillRect(rx, ry, colW, rowH)
    }

    ctx.textBaseline = 'middle'
    ctx.font = `800 ${valuePx}px ${FAMILY}`
    ctx.fillStyle = awayColor
    ctx.textAlign = 'left'
    ctx.fillText(String(r.awayVal), rx + colW * 0.05, ry + rowH / 2)

    ctx.fillStyle = homeColor
    ctx.textAlign = 'right'
    ctx.fillText(String(r.homeVal), rx + colW * 0.95, ry + rowH / 2)

    ctx.fillStyle = '#4a5568'
    ctx.textAlign = 'center'
    ctx.font = `600 ${labelPx}px ${FAMILY}`
    ctx.fillText(r.label, rx + colW / 2, ry + rowH / 2)

    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(rx + colW * 0.04, ry + rowH)
    ctx.lineTo(rx + colW * 0.96, ry + rowH)
    ctx.stroke()
  })
}

function drawStatsGrid(ctx, x, y, w, h, stats, textColor, FAMILY, cols) {
  if (!stats.length) return
  const rows = Math.ceil(stats.length / cols)
  const cellW = w / cols
  const cellH = h / rows
  const maxW = cellW - cellW * 0.16
  const labelPx = fitFontSizeForAll(ctx, stats.map(s => s.label), maxW, cellH * 0.2, 600, FAMILY)
  const valuePx = fitFontSizeForAll(ctx, stats.map(s => String(s.value)), maxW, cellH * 0.36, 800, FAMILY)

  stats.forEach((s, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = x + cellW * col + cellW / 2
    const cy = y + cellH * row
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.75
    ctx.textBaseline = 'top'
    ctx.font = `600 ${labelPx}px ${FAMILY}`
    ctx.fillText(s.label, cx, cy + cellH * 0.12)
    ctx.globalAlpha = 1
    ctx.textBaseline = 'bottom'
    ctx.font = `800 ${valuePx}px ${FAMILY}`
    ctx.fillText(String(s.value), cx, cy + cellH * 0.88)
  })
}
