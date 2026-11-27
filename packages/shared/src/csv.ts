/**
 * Small, dependency free CSV reader and writer (RFC 4180 style), plus the
 * student import format. Spreadsheet apps export CSV with quotes, commas in
 * values, Windows line endings and sometimes a byte order mark; all handled.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function quote(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formula injection from user entered text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

/**
 * Reads a date typed in a spreadsheet. Accepts DD/MM/YYYY (the Nigerian
 * convention), D/M/YYYY, DD.MM.YYYY and ISO YYYY MM DD. Returns an ISO date or null.
 */
export function parseFlexibleDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})\D(\d{1,2})\D(\d{1,2})$/.exec(v);
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Shows an ISO date the way Nigerian schools write it: DD/MM/YYYY. */
export function formatDmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split(/\D/);
  return y && m && d ? `${d}/${m}/${y}` : '';
}

export interface ImportColumn {
  key: string;
  header: string;
  required?: boolean;
  /** Other headers people commonly use for the same column. */
  aliases: string[];
  example: string;
}

export const STUDENT_IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'first_name', header: 'First name', required: true, aliases: ['firstname', 'first', 'given name'], example: 'Chidi' },
  { key: 'middle_name', header: 'Middle name', aliases: ['middlename', 'other names', 'other name'], example: 'Emeka' },
  { key: 'last_name', header: 'Last name', required: true, aliases: ['lastname', 'surname', 'family name'], example: 'Okeke' },
  { key: 'gender', header: 'Gender', aliases: ['sex'], example: 'Male' },
  { key: 'date_of_birth', header: 'Date of birth', aliases: ['dob', 'birth date', 'birthday'], example: '14/03/2014' },
  { key: 'admission_number', header: 'Admission number', aliases: ['admission no', 'reg number', 'registration number', 'student number'], example: '' },
  { key: 'admission_date', header: 'Admission date', aliases: ['date admitted', 'admitted'], example: '07/09/2026' },
  { key: 'class', header: 'Class', aliases: ['class name', 'arm', 'level'], example: 'JSS 1A' },
  { key: 'previous_school', header: 'Previous school', aliases: ['last school'], example: '' },
  { key: 'guardian_first_name', header: 'Guardian first name', aliases: ['parent first name'], example: 'Ngozi' },
  { key: 'guardian_last_name', header: 'Guardian last name', aliases: ['parent last name', 'guardian surname'], example: 'Okeke' },
  { key: 'guardian_email', header: 'Guardian email', aliases: ['parent email'], example: 'ngozi@example.com' },
  { key: 'guardian_phone', header: 'Guardian phone', aliases: ['parent phone', 'guardian phone number'], example: '+234 803 000 0000' },
  { key: 'guardian_relationship', header: 'Relationship', aliases: ['guardian relationship', 'relation'], example: 'Mother' },
];

const normalise = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

export interface ImportRow {
  line: number;
  values: Record<string, string>;
  errors: string[];
}

/** Matches headers to columns and checks each row. Dates come back as ISO. */
export function readStudentImport(table: string[][]): { rows: ImportRow[]; missingColumns: string[]; unknownHeaders: string[] } {
  const [header = [], ...body] = table;
  const index = new Map<string, number>();
  const unknownHeaders: string[] = [];
  header.forEach((h, i) => {
    const n = normalise(h);
    const column = STUDENT_IMPORT_COLUMNS.find((c) => normalise(c.header) === n || c.aliases.some((a) => normalise(a) === n));
    if (column && !index.has(column.key)) index.set(column.key, i);
    else if (h.trim()) unknownHeaders.push(h.trim());
  });
  const missingColumns = STUDENT_IMPORT_COLUMNS.filter((c) => c.required && !index.has(c.key)).map((c) => c.header);

  const rows = body.map((cells, i) => {
    const values: Record<string, string> = {};
    const errors: string[] = [];
    for (const column of STUDENT_IMPORT_COLUMNS) {
      const at = index.get(column.key);
      values[column.key] = at === undefined ? '' : (cells[at] ?? '').trim();
    }
    if (!values.first_name) errors.push('First name is missing.');
    if (!values.last_name) errors.push('Last name is missing.');
    for (const key of ['date_of_birth', 'admission_date'] as const) {
      if (values[key]) {
        const iso = parseFlexibleDate(values[key]!);
        if (iso) values[key] = iso;
        else errors.push(`${key === 'date_of_birth' ? 'Date of birth' : 'Admission date'} should look like 14/03/2014.`);
      }
    }
    if (values.gender) {
      const g = values.gender.toLowerCase();
      if (['f', 'female', 'girl'].includes(g)) values.gender = 'female';
      else if (['m', 'male', 'boy'].includes(g)) values.gender = 'male';
      else errors.push('Gender should be Male or Female.');
    }
    if (values.guardian_relationship) {
      const r = values.guardian_relationship.toLowerCase().replace(/\s+/g, '_');
      const known = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'aunt_uncle', 'sponsor', 'other'];
      values.guardian_relationship = known.includes(r) ? r : r === 'aunt' || r === 'uncle' ? 'aunt_uncle' : 'other';
    }
    if (values.guardian_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.guardian_email)) errors.push('Guardian email is not valid.');
    if ((values.guardian_first_name || values.guardian_email) && !values.guardian_last_name && !values.guardian_email) {
      errors.push('Add the guardian\'s last name or email.');
    }
    return { line: i + 2, values, errors };
  });
  return { rows, missingColumns, unknownHeaders };
}

export function studentImportTemplate(): string {
  return toCsv([STUDENT_IMPORT_COLUMNS.map((c) => c.header), STUDENT_IMPORT_COLUMNS.map((c) => c.example)]);
}
