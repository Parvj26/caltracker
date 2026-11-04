import Papa from 'papaparse';
import { NAME_MAX_LENGTH, splitFullName } from '../names';
import { InviteInput } from './schema';

export interface CsvError {
  line: number;
  message: string;
}

export interface ParsedClientCsv {
  rows: InviteInput[];
  errors: CsvError[];
}

/** Most clients one CSV upload may hold. */
export const CLIENT_CSV_MAX_ROWS = 200;
/** Accepted header cells (case and surrounding spaces are ignored). The first entry is the preferred spelling. */
export const FIRST_NAME_HEADERS: readonly string[] = ['first name', 'first_name', 'given name'];
export const LAST_NAME_HEADERS: readonly string[] = ['last name', 'last_name', 'surname'];
/** A single name column (older files): split on the first space, unless a last name column is also present. */
export const NAME_HEADERS: readonly string[] = ['name', 'full name', 'full_name', 'client name'];
export const EMAIL_HEADERS: readonly string[] = ['email', 'e-mail', 'email address'];

const EXAMPLE_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['Sam', 'Lee', 'sam.lee@example.com'],
  ['Priya', 'Rao', 'priya.rao@example.com'],
];

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A small example upload: the preferred headers plus two example rows. */
export function clientCsvTemplate(): string {
  const header = [FIRST_NAME_HEADERS[0]!, LAST_NAME_HEADERS[0]!, EMAIL_HEADERS[0]!].map(capitalise).join(',');
  return [header, ...EXAMPLE_ROWS.map((row) => row.join(','))].join('\n') + '\n';
}

function findColumn(header: string[], accepted: readonly string[]): number {
  return header.findIndex((cell) => accepted.includes(cell.trim().toLowerCase()));
}

export function parseClientCsv(text: string): ParsedClientCsv {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Parse without skipping blank lines so a row's index is its physical line number.
  const parsed = Papa.parse<string[]>(source, { header: false, skipEmptyLines: false });

  const lines: { line: number; cells: string[] }[] = [];
  parsed.data.forEach((cells, index) => {
    if (cells.every((cell) => cell.trim() === '')) return;
    lines.push({ line: index + 1, cells });
  });

  const [headerRow, ...dataRows] = lines;
  const emailCol = headerRow ? findColumn(headerRow.cells, EMAIL_HEADERS) : -1;
  if (!headerRow || emailCol === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'Could not find an email column. Expected a header like "Email".' }],
    };
  }
  const firstCol = findColumn(headerRow.cells, FIRST_NAME_HEADERS);
  const lastCol = findColumn(headerRow.cells, LAST_NAME_HEADERS);
  const nameCol = findColumn(headerRow.cells, NAME_HEADERS);
  const cell = (cells: string[], col: number) => (col === -1 ? '' : (cells[col] ?? ''));
  const names = (cells: string[]) => {
    if (firstCol !== -1) return { firstName: cell(cells, firstCol), lastName: cell(cells, lastCol) };
    // "Name" next to a "Surname" column holds the first name; on its own it holds the whole name.
    if (lastCol !== -1) return { firstName: cell(cells, nameCol), lastName: cell(cells, lastCol) };
    return splitFullName(cell(cells, nameCol));
  };

  const rows: InviteInput[] = [];
  const errors: CsvError[] = [];
  const seen = new Map<string, number>();

  for (const [i, { line, cells }] of dataRows.entries()) {
    if (i >= CLIENT_CSV_MAX_ROWS) {
      errors.push({ line, message: `Maximum ${CLIENT_CSV_MAX_ROWS} clients per upload.` });
      break;
    }
    const rawEmail = (cells[emailCol] ?? '').trim();
    const result = InviteInput.safeParse({ email: rawEmail, ...names(cells) });
    if (!result.success) {
      const badField = (field: string) => result.error.issues.some((issue) => issue.path[0] === field);
      errors.push({
        line,
        message: badField('email')
          ? `Invalid email: ${rawEmail}`
          : badField('firstName')
            ? `Invalid name on line ${line}: a first name of 1 to ${NAME_MAX_LENGTH} characters is required`
            : `Invalid name on line ${line}: the last name can be at most ${NAME_MAX_LENGTH} characters`,
      });
      continue;
    }
    const firstLine = seen.get(result.data.email);
    if (firstLine !== undefined) {
      errors.push({ line, message: `Duplicate email: ${result.data.email} (also on line ${firstLine})` });
      continue;
    }
    seen.set(result.data.email, line);
    rows.push(result.data);
  }

  return { rows, errors };
}
