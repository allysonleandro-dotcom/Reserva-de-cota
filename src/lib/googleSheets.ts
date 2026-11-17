import type {
  BolaoPool,
  ParsedReservasSheet,
  Reservation,
  SheetRowEntry,
  SyncCellPlanItem,
} from '../types.ts';

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  tabs: string[];
}

export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string,
): Promise<SpreadsheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}?fields=spreadsheetId,properties.title,sheets.properties.title`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      errBody?.error?.message ||
      `Erro ao acessar planilha (${res.status}). Verifique o link e suas permissões.`;
    throw new Error(msg);
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };

  const tabs = (data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Planilha sem título',
    tabs,
  };
}

function escapeTabName(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

export async function readReservasSheet(
  spreadsheetId: string,
  tabName: string,
  spreadsheetTitle: string,
  accessToken: string,
): Promise<ParsedReservasSheet> {
  const range = `${escapeTabName(tabName)}!A1:J300`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Falha ao ler a aba ${tabName} (${res.status}).`,
    );
  }

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values || [];

  // Detect the header row dynamically (looks for "COTA" in Col A and "PARTICIPANTE" in Col B)
  let headerRowIdx = rows.findIndex(
    (row) =>
      String(row[0] || '').trim().toUpperCase() === 'COTA' &&
      String(row[1] || '').trim().toUpperCase().includes('PARTICIPANTE'),
  );

  if (headerRowIdx === -1) {
    // Fallback to row 5 (0-based index 4) matching the RESERVAS layout
    headerRowIdx = 4;
  }

  const dataStartIdx = headerRowIdx + 1;
  const pool1Rows: SheetRowEntry[] = [];
  const pool2Rows: SheetRowEntry[] = [];

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowNumber = i + 1;

    const cota1 = String(row[0] ?? '').trim();
    const part1 = String(row[1] ?? '').trim();
    const val1 = String(row[2] ?? '').trim();
    const status1 = String(row[3] ?? '').trim().toUpperCase() === 'TRUE';

    if (cota1 || part1 || val1) {
      pool1Rows.push({
        rowNumber,
        cotaLabel: cota1 || String(pool1Rows.length + 1),
        participant: part1,
        valueRaw: val1,
        paid: status1,
      });
    }

    const cota2 = String(row[5] ?? '').trim();
    const part2 = String(row[6] ?? '').trim();
    const val2 = String(row[7] ?? '').trim();
    const status2 = String(row[8] ?? '').trim().toUpperCase() === 'TRUE';

    if (cota2 || part2 || val2) {
      pool2Rows.push({
        rowNumber,
        cotaLabel: cota2 || String(pool2Rows.length + 1),
        participant: part2,
        valueRaw: val2,
        paid: status2,
      });
    }
  }

  const findNextEmptyRow = (entries: SheetRowEntry[], fallbackStart: number): number => {
    const firstBlank = entries.find((e) => !e.participant);
    if (firstBlank) return firstBlank.rowNumber;
    if (entries.length > 0) return entries[entries.length - 1].rowNumber + 1;
    return fallbackStart;
  };

  return {
    spreadsheetTitle,
    tabName,
    headerRow: headerRowIdx + 1,
    dataStartRow: dataStartIdx + 1,
    pool1Rows,
    pool2Rows,
    pool1NextRow: findNextEmptyRow(pool1Rows, dataStartIdx + 1),
    pool2NextRow: findNextEmptyRow(pool2Rows, dataStartIdx + 1),
  };
}

export function buildSyncPlan(
  reservations: Reservation[],
  pools: BolaoPool[],
  sheetState: ParsedReservasSheet,
): SyncCellPlanItem[] {
  const plan: SyncCellPlanItem[] = [];

  // Track next available empty row per pool using existing empty slots first, then appending
  const pool1EmptyRows = sheetState.pool1Rows
    .filter((r) => !r.participant)
    .map((r) => r.rowNumber);
  let pool1TailRow =
    sheetState.pool1Rows.length > 0
      ? sheetState.pool1Rows[sheetState.pool1Rows.length - 1].rowNumber + 1
      : sheetState.dataStartRow;

  const pool2EmptyRows = sheetState.pool2Rows
    .filter((r) => !r.participant)
    .map((r) => r.rowNumber);
  let pool2TailRow =
    sheetState.pool2Rows.length > 0
      ? sheetState.pool2Rows[sheetState.pool2Rows.length - 1].rowNumber + 1
      : sheetState.dataStartRow;

  const extraTailByPool = new Map<string, number>();

  const nextRowForPool = (poolId: string): number => {
    if (poolId === 'bolao-1') {
      const reused = pool1EmptyRows.shift();
      if (reused !== undefined) return reused;
      const r = pool1TailRow;
      pool1TailRow += 1;
      return r;
    }
    if (poolId === 'bolao-2') {
      const reused = pool2EmptyRows.shift();
      if (reused !== undefined) return reused;
      const r = pool2TailRow;
      pool2TailRow += 1;
      return r;
    }
    const current = extraTailByPool.get(poolId) ?? sheetState.dataStartRow;
    extraTailByPool.set(poolId, current + 1);
    return current;
  };

  // Oldest first so spreadsheet order matches reservation arrival order
  const chronological = [...reservations].reverse();

  for (const res of chronological) {
    for (const slot of res.slots) {
      if (slot.syncedToSheet) continue;
      const pool = pools.find((p) => p.id === slot.poolId);
      if (!pool) continue;

      const rowNumber = nextRowForPool(pool.id);
      const { participantCol, valueCol, statusCol } = pool.sheetColumns;

      plan.push({
        slotId: slot.id,
        reservationId: res.id,
        poolId: pool.id,
        poolName: pool.name,
        rowNumber,
        participantCell: `${participantCol}${rowNumber}`,
        valueCell: `${valueCol}${rowNumber}`,
        statusCell: `${statusCol}${rowNumber}`,
        participantText: slot.sheetDisplayName,
        valueAmount: slot.unitValue,
        paid: res.paymentStatus === 'paid',
      });
    }
  }

  return plan;
}

export async function executeSyncPlan(
  spreadsheetId: string,
  tabName: string,
  plan: SyncCellPlanItem[],
  accessToken: string,
): Promise<Array<{ slotId: string; rowNumber: number; sheetRange: string }>> {
  if (plan.length === 0) return [];

  const escapedTab = escapeTabName(tabName);
  const dataPayload: Array<{ range: string; values: unknown[][] }> = [];

  for (const item of plan) {
    // Write PARTICIPANTE and VALOR side by side (e.g. 'RESERVAS'!B26:C26)
    dataPayload.push({
      range: `${escapedTab}!${item.participantCell}:${item.valueCell}`,
      values: [[item.participantText, item.valueAmount]],
    });

    if (item.paid) {
      dataPayload.push({
        range: `${escapedTab}!${item.statusCell}`,
        values: [[true]],
      });
    }
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values:batchUpdate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: dataPayload,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Erro ao gravar dados na planilha (${res.status}).`,
    );
  }

  return plan.map((item) => ({
    slotId: item.slotId,
    rowNumber: item.rowNumber,
    sheetRange: `${tabName}!${item.participantCell}:${item.valueCell}`,
  }));
}

export async function updateSheetStatusCell(
  spreadsheetId: string,
  tabName: string,
  statusCol: string,
  rowNumber: number,
  paid: boolean,
  accessToken: string,
): Promise<void> {
  const range = `${escapeTabName(tabName)}!${statusCol}${rowNumber}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      values: [[paid]],
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody?.error?.message || `Erro ao atualizar status na linha ${rowNumber}.`,
    );
  }
}
