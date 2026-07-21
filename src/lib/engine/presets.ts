export interface BoardParams {
  width: number
  height: number
  mines: number
}

export const BEGINNER: BoardParams = { width: 9, height: 9, mines: 10 }
export const INTERMEDIATE: BoardParams = { width: 16, height: 16, mines: 40 }
export const EXPERT: BoardParams = { width: 30, height: 16, mines: 99 }

// mines <= cells - 9 keeps room for the first-click exemption zone (clicked cell + 8 neighbors)
export function custom(width: number, height: number, mines: number): BoardParams {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(mines)) {
    throw new Error('Board parameters must be integers')
  }
  if (width < 1 || height < 1) throw new Error('Board must be at least 1x1')
  if (mines < 1 || mines > width * height - 9) {
    throw new Error(`Mines must be between 1 and ${width * height - 9}`)
  }
  return { width, height, mines }
}
