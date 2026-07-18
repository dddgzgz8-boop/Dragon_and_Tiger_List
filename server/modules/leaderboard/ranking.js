const DESC_FIELDS = { total: 'score', profit: 'mom', success: 'score', point: 'points' }

export function rankRows(rows, board) {
  const field = DESC_FIELDS[board]
  if (!field) return [...rows]
  const sorted = [...rows].sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0))
  let previousValue, previousStatus, previousRank = 0
  return sorted.map((row, index) => {
    const value = Number(row[field] || 0)
    const status = null
    const rank = index > 0 && value === previousValue ? previousRank : index + 1
    previousValue = value; previousStatus = status; previousRank = rank
    return { ...row, rank }
  })
}

export function calculateBoards(people, inputs) {
  return {
    people,
    total: rankRows(inputs.total || [], 'total'),
    profit: rankRows(inputs.profit || [], 'profit'),
    newsku: [...(inputs.newsku || [])],
    success: rankRows(inputs.success || [], 'success'),
    point: rankRows(inputs.point || [], 'point'),
  }
}
