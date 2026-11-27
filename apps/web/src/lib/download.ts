/** Saves text as a file in the browser (CSV exports and templates). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  // A byte order mark lets Excel open UTF 8 names (Chídí, Adébáyọ̀) correctly.
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
