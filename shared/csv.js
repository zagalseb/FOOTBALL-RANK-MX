// Minimal RFC4180 parser (handles quoted fields with embedded commas/quotes).
// No CDN dependency on purpose: these pages have no build step. Used by
// capture/import_stats.html (setup.html keeps its own inline copy).
export function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i]
    if (inQuotes) {
      if (c === '"') {
        if (norm[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''))
}
