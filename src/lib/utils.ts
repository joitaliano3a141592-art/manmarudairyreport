import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 作業時間を小数点2位まで表示し、末尾の0を省略した文字列に変換
 * @param hours 時間（数値）
 * @returns フォーマットされた時間文字列（例: "8", "8.5", "8.25"）
 */
export function formatWorkHours(hours: number): string {
  // 小数点2位までに四捨五入
  const rounded = Math.round(hours * 100) / 100
  // 末尾の0を省略してフォーマット
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
