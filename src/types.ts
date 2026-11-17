export type PoolColumnMapping = {
  cotaCol: string;
  participantCol: string;
  valueCol: string;
  statusCol: string;
};

export interface BolaoPool {
  id: string;
  name: string;
  subtitle: string;
  equivalentLabel: string;
  fullPrice: number;
  halfPrice: number;
  totalCotas: number;
  active: boolean;
  sheetColumns: PoolColumnMapping;
}

export interface AppConfig {
  eventTitle: string;
  estimatedPrize: string;
  pixKey: string;
  pixHolderName: string;
  paymentDeadline: string;
  organizerWhatsapp: string;
  spreadsheetUrlOrId: string;
  sheetTabName: string;
  pools: BolaoPool[];
}

export type CotaKind = 'inteira' | 'meia';

export interface ReservationSlot {
  id: string;
  poolId: string;
  poolName: string;
  kind: CotaKind;
  sheetDisplayName: string;
  unitValue: number;
  syncedToSheet: boolean;
  sheetRow?: number;
  sheetRange?: string;
}

export type PaymentStatus = 'pending' | 'paid';

export interface Reservation {
  id: string;
  participantName: string;
  createdAt: string;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  slots: ReservationSlot[];
}

export interface CreateReservationPayload {
  participantName: string;
  selections: Array<{
    poolId: string;
    inteiras: number;
    meias: number;
  }>;
}

export interface SheetRowEntry {
  rowNumber: number;
  cotaLabel: string;
  participant: string;
  valueRaw: string;
  paid: boolean;
}

export interface ParsedReservasSheet {
  spreadsheetTitle: string;
  tabName: string;
  headerRow: number;
  dataStartRow: number;
  pool1Rows: SheetRowEntry[];
  pool2Rows: SheetRowEntry[];
  pool1NextRow: number;
  pool2NextRow: number;
}

export interface SyncCellPlanItem {
  slotId: string;
  reservationId: string;
  poolId: string;
  poolName: string;
  rowNumber: number;
  participantCell: string;
  valueCell: string;
  statusCell: string;
  participantText: string;
  valueAmount: number;
  paid: boolean;
}
