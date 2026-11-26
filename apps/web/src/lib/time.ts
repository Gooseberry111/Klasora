/** "Good morning" / "Good afternoon" / "Good evening" in the school's time zone. */
export function greetingFor(date: Date, timeZone?: string): string {
  let hour = date.getHours();
  if (timeZone) {
    try {
      hour = Number(
        new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date),
      );
    } catch {
      /* unknown zone — fall back to the device clock */
    }
  }
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}
