const INDONESIAN_TIMEZONES: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
}

export function displayTimezone(timezone: string): string {
  return INDONESIAN_TIMEZONES[timezone] ?? timezone
}
