import Papa from 'papaparse';
import { InviteInput } from './schema';

export interface CsvError {
  line: number;
  message: string;
}

export interface ParsedClientCsv {
  rows: InviteInput[];
  errors: CsvError[];
}

const MAX_ROWS = 200;
const NAME_HEADERS = ['name', 'full name', 'full_name', 'client name'];
const EMAIL_HEADERS = ['email', 'e-mail', 'email address'];

function findColumn(header: string[], accepted: string[]): number {
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
  const nameCol = findColumn(headerRow.cells, NAME_HEADERS);

  const rows: InviteInput[] = [];
  const errors: CsvError[] = [];
  const seen = new Map<string, number>();

  for (const [i, { line, cells }] of dataRows.entries()) {
    if (i >= MAX_ROWS) {
      errors.push({ line, message: `Maximum ${MAX_ROWS} clients per upload.` });
      break;
    }
    const rawEmail = (cells[emailCol] ?? '').trim();
    const rawName = nameCol === -1 ? '' : (cells[nameCol] ?? '');
    const result = InviteInput.safeParse({ email: rawEmail, fullName: rawName });
    if (!result.success) {
      const emailBad = result.error.issues.some((issue) => issue.path[0] === 'email');
      errors.push({
        line,
        message: emailBad ? `Invalid email: ${rawEmail}` : `Invalid name on line ${line}: a name of 1 to 100 characters is required`,
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
