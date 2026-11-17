import React, { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppConfig,
  BolaoPool,
  ParsedReservasSheet,
  Reservation,
  SyncCellPlanItem,
} from '../types.ts';
import { copyTextToClipboard, formatBRL } from '../lib/format.ts';
import {
  buildSyncPlan,
  executeSyncPlan,
  extractSpreadsheetId,
  fetchSpreadsheetMetadata,
  readReservasSheet,
  updateSheetStatusCell,
} from '../lib/googleSheets.ts';

interface AdminSheetPanelProps {
  config: AppConfig;
  reservations: Reservation[];
  authUser: User | null;
  accessToken: string | null;
  isLoggingIn: boolean;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  onConfigSaved: (next: AppConfig) => void;
  onReservationsUpdated: (next: Reservation[]) => void;
  sheetData: ParsedReservasSheet | null;
  onSheetDataLoaded: (data: ParsedReservasSheet | null) => void;
  onNotify: (msg: string) => void;
}

export const AdminSheetPanel: React.FC<AdminSheetPanelProps> = ({
  config,
  reservations,
  authUser,
  accessToken,
  isLoggingIn,
  onGoogleLogin,
  onGoogleLogout,
  onConfigSaved,
  onReservationsUpdated,
  sheetData,
  onSheetDataLoaded,
  onNotify,
}) => {
  const [sheetUrlInput, setSheetUrlInput] = useState(config.spreadsheetUrlOrId);
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState(config.sheetTabName || 'RESERVAS');
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Sync confirmation modal state (mandatory confirmation before mutating Sheets)
  const [pendingPlan, setPendingPlan] = useState<SyncCellPlanItem[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Status checkbox mutation confirmation state
  const [pendingStatusToggle, setPendingStatusToggle] = useState<{
    poolLabel: string;
    participant: string;
    rowNumber: number;
    statusCol: string;
    nextPaid: boolean;
  } | null>(null);
  const [togglingSheetStatus, setTogglingSheetStatus] = useState(false);

  // Settings form state
  const [editConfig, setEditConfig] = useState<AppConfig>(config);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const pendingSlotsCount = useMemo(
    () =>
      reservations.reduce(
        (acc, r) => acc + r.slots.filter((s) => !s.syncedToSheet).length,
        0,
      ),
    [reservations],
  );

  const handleConnectSheet = async (tabOverride?: string) => {
    setSheetError(null);
    if (!accessToken) {
      setSheetError('Entre com sua conta Google primeiro para acessar sua planilha.');
      return;
    }

    const spreadsheetId = extractSpreadsheetId(sheetUrlInput);
    if (!spreadsheetId) {
      setSheetError(
        'Cole o link completo da planilha do Google Sheets (ex.: https://docs.google.com/spreadsheets/d/...).',
      );
      return;
    }

    setSheetLoading(true);
    try {
      const meta = await fetchSpreadsheetMetadata(spreadsheetId, accessToken);
      setAvailableTabs(meta.tabs);

      const targetTab =
        tabOverride ||
        (meta.tabs.includes(selectedTab)
          ? selectedTab
          : meta.tabs.find((t) => t.toUpperCase() === 'RESERVAS') ||
            meta.tabs[0] ||
            'RESERVAS');

      setSelectedTab(targetTab);

      const parsed = await readReservasSheet(
        spreadsheetId,
        targetTab,
        meta.title,
        accessToken,
      );
      onSheetDataLoaded(parsed);

      // Persist linked spreadsheet & tab to backend config
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          spreadsheetUrlOrId: sheetUrlInput.trim(),
          sheetTabName: targetTab,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as AppConfig;
        onConfigSaved(updated);
        setEditConfig(updated);
      }

      onNotify(`Planilha "${meta.title}" (${targetTab}) sincronizada!`);
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Erro ao conectar planilha.',
      );
    } finally {
      setSheetLoading(false);
    }
  };

  const handleOpenSyncConfirmation = async () => {
    setSheetError(null);
    if (!accessToken) {
      setSheetError('Faça login com sua conta Google antes de enviar para a planilha.');
      return;
    }
    const spreadsheetId = extractSpreadsheetId(sheetUrlInput || config.spreadsheetUrlOrId);
    if (!spreadsheetId) {
      setSheetError('Conecte uma planilha válida primeiro.');
      return;
    }

    setSheetLoading(true);
    try {
      // Refresh latest sheet state so we never overwrite a manually added row
      const freshSheet = await readReservasSheet(
        spreadsheetId,
        selectedTab,
        sheetData?.spreadsheetTitle || 'Planilha',
        accessToken,
      );
      onSheetDataLoaded(freshSheet);

      const plan = buildSyncPlan(reservations, config.pools, freshSheet);
      if (plan.length === 0) {
        onNotify('Todas as reservas já estão registradas na planilha.');
        return;
      }
      setPendingPlan(plan);
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Erro ao preparar envio para a planilha.',
      );
    } finally {
      setSheetLoading(false);
    }
  };

  const handleConfirmSyncWrite = async () => {
    if (!pendingPlan || !accessToken) return;
    const spreadsheetId = extractSpreadsheetId(sheetUrlInput || config.spreadsheetUrlOrId);
    if (!spreadsheetId) return;

    setSyncing(true);
    try {
      const syncedSlots = await executeSyncPlan(
        spreadsheetId,
        selectedTab,
        pendingPlan,
        accessToken,
      );

      const markRes = await fetch('/api/reservations/mark-synced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncedSlots }),
      });

      if (markRes.ok) {
        const data = (await markRes.json()) as { reservations: Reservation[] };
        onReservationsUpdated(data.reservations);
      }

      const freshSheet = await readReservasSheet(
        spreadsheetId,
        selectedTab,
        sheetData?.spreadsheetTitle || 'Planilha',
        accessToken,
      );
      onSheetDataLoaded(freshSheet);
      setPendingPlan(null);
      onNotify(`${syncedSlots.length} cota(s) registrada(s) na aba ${selectedTab}!`);
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Falha ao gravar na planilha.',
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmSheetStatusToggle = async () => {
    if (!pendingStatusToggle || !accessToken) return;
    const spreadsheetId = extractSpreadsheetId(sheetUrlInput || config.spreadsheetUrlOrId);
    if (!spreadsheetId) return;

    setTogglingSheetStatus(true);
    try {
      await updateSheetStatusCell(
        spreadsheetId,
        selectedTab,
        pendingStatusToggle.statusCol,
        pendingStatusToggle.rowNumber,
        pendingStatusToggle.nextPaid,
        accessToken,
      );

      const freshSheet = await readReservasSheet(
        spreadsheetId,
        selectedTab,
        sheetData?.spreadsheetTitle || 'Planilha',
        accessToken,
      );
      onSheetDataLoaded(freshSheet);
      setPendingStatusToggle(null);
      onNotify('Status atualizado na planilha!');
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Erro ao atualizar status na planilha.',
      );
    } finally {
      setTogglingSheetStatus(false);
    }
  };

  const handleToggleAppPayment = async (reservation: Reservation) => {
    const nextStatus = reservation.paymentStatus === 'paid' ? 'pending' : 'paid';
    const res = await fetch(`/api/reservations/${reservation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: nextStatus }),
    });
    if (res.ok) {
      const updated = (await res.json()) as Reservation;
      onReservationsUpdated(
        reservations.map((r) => (r.id === updated.id ? updated : r)),
      );
    }
  };

  const handleDeleteReservation = async (id: string) => {
    const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      onReservationsUpdated(reservations.filter((r) => r.id !== id));
      onNotify('Reserva removida da fila online.');
    }
  };

  const handleCopyReport = async () => {
    const totalExpected = reservations.reduce((acc, r) => acc + r.totalAmount, 0);
    const totalPaid = reservations
      .filter((r) => r.paymentStatus === 'paid')
      .reduce((acc, r) => acc + r.totalAmount, 0);

    const lines = [
      `RELATÓRIO — ${config.eventTitle.toUpperCase()}`,
      `Prazo de pagamento: ${config.paymentDeadline} | Pix: ${config.pixKey}`,
      `Reservas online: ${reservations.length} | Recebido: ${formatBRL(
        totalPaid,
      )} de ${formatBRL(totalExpected)}`,
      '',
      ...reservations.map((r) => {
        const cotasDesc = r.slots
          .map((s) => `${s.poolName} ${s.kind === 'inteira' ? 'Inteira' : 'Meia'}`)
          .join(', ');
        return `• ${r.participantName} — ${cotasDesc} — ${formatBRL(r.totalAmount)} [${
          r.paymentStatus === 'paid' ? 'PAGO' : 'PENDENTE'
        }]`;
      }),
    ];

    if (sheetData) {
      lines.push('');
      lines.push(`Planilha (${sheetData.tabName}):`);
      lines.push(
        `Bolão 1: ${sheetData.pool1Rows.filter((r) => r.participant).length} cotas preenchidas`,
      );
      lines.push(
        `Bolão 2: ${sheetData.pool2Rows.filter((r) => r.participant).length} cotas preenchidas`,
      );
    }

    const ok = await copyTextToClipboard(lines.join('\n'));
    if (ok) {
      onNotify('Relatório copiado para a área de transferência!');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editConfig),
      });
      if (res.ok) {
        const updated = (await res.json()) as AppConfig;
        onConfigSaved(updated);
        setEditConfig(updated);
        setShowSettings(false);
        onNotify('Configurações salvas com sucesso!');
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const updatePoolField = <K extends keyof BolaoPool>(
    poolId: string,
    field: K,
    value: BolaoPool[K],
  ) => {
    setEditConfig((prev) => ({
      ...prev,
      pools: prev.pools.map((p) => (p.id === poolId ? { ...p, [field]: value } : p)),
    }));
  };

  const handleAddPool = () => {
    const idx = editConfig.pools.length + 1;
    setEditConfig((prev) => ({
      ...prev,
      pools: [
        ...prev.pools,
        {
          id: `bolao-${idx}`,
          name: `Bolão ${idx}`,
          subtitle: 'Nova modalidade',
          equivalentLabel: '',
          fullPrice: 25,
          halfPrice: 12.5,
          totalCotas: 50,
          active: true,
          sheetColumns: {
            cotaCol: 'A',
            participantCol: 'B',
            valueCol: 'C',
            statusCol: 'D',
          },
        },
      ],
    }));
  };

  const activeSpreadsheetId = extractSpreadsheetId(
    sheetUrlInput || config.spreadsheetUrlOrId,
  );

  return (
    <div className="space-y-6">
      {/* 1. Google Sheets Connection Card */}
      <section className="rounded-2xl border border-white/10 bg-[#101815] p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-white/8">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              <span>Integração com Google Sheets (Aba RESERVAS)</span>
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Conecte sua conta Google e cole o link da planilha para ler as cotas e enviar os novos participantes diretamente para as colunas de cada bolão.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {accessToken && authUser ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-medium text-emerald-400">
                    Google conectado
                  </p>
                  <p className="text-xs text-zinc-300 truncate max-w-[180px]">
                    {authUser.email || authUser.displayName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onGoogleLogout}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Desconectar</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onGoogleLogin}
                disabled={isLoggingIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Conectando...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Spreadsheet URL + Tab Selector */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-end">
          <div className="lg:col-span-6">
            <label
              htmlFor="sheet-url-input"
              className="block text-xs font-medium text-zinc-300 mb-1.5"
            >
              Link ou ID da Planilha Google Sheets
            </label>
            <div className="relative">
              <Link2 className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="sheet-url-input"
                type="text"
                value={sheetUrlInput}
                onChange={(e) => setSheetUrlInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full min-h-[44px] pl-10 pr-3 py-2 rounded-xl bg-[#090D0C] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            <label
              htmlFor="sheet-tab-select"
              className="block text-xs font-medium text-zinc-300 mb-1.5"
            >
              Aba da Planilha
            </label>
            {availableTabs.length > 0 ? (
              <select
                id="sheet-tab-select"
                value={selectedTab}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedTab(next);
                  void handleConnectSheet(next);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#090D0C] border border-white/15 text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                {availableTabs.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="sheet-tab-select"
                type="text"
                value={selectedTab}
                onChange={(e) => setSelectedTab(e.target.value)}
                placeholder="RESERVAS"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#090D0C] border border-white/15 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>

          <div className="lg:col-span-3 flex gap-2">
            <button
              type="button"
              onClick={() => void handleConnectSheet()}
              disabled={sheetLoading || !accessToken}
              className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-45 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 ${sheetLoading ? 'animate-spin' : ''}`}
              />
              <span>{sheetData ? 'Atualizar' : 'Conectar'}</span>
            </button>

            {activeSpreadsheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${activeSpreadsheetId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir planilha no Google Sheets"
                className="min-h-[44px] min-w-[44px] rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-zinc-200 flex items-center justify-center transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {sheetError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-200"
          >
            {sheetError}
          </div>
        )}

        {/* Sync Action Strip */}
        <div className="mt-5 pt-5 border-t border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-sm">
            <span className="text-zinc-400">Cotas pendentes de envio para a planilha: </span>
            <span className="font-mono tabular-nums font-bold text-white">
              {pendingSlotsCount}
            </span>
            {sheetData && (
              <span className="text-xs text-zinc-400 block mt-0.5">
                Próximas linhas livres em {sheetData.tabName}: Bolão 1 (linha{' '}
                {sheetData.pool1NextRow}) · Bolão 2 (linha {sheetData.pool2NextRow})
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCopyReport}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <ClipboardList className="w-4 h-4 text-emerald-400" />
              <span>Gerar Relatório</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Settings className="w-4 h-4 text-zinc-300" />
              <span>Configurar Bolões</span>
            </button>

            <button
              type="button"
              onClick={() => void handleOpenSyncConfirmation()}
              disabled={pendingSlotsCount === 0 || !accessToken || sheetLoading}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Enviar para Planilha</span>
            </button>
          </div>
        </div>
      </section>

      {/* Optional Editable Settings Panel */}
      {showSettings && (
        <form
          onSubmit={handleSaveConfig}
          className="rounded-2xl border border-white/12 bg-[#101815] p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-white/8 pb-4">
            <h3 className="text-base font-bold text-white">
              Configurações Gerais e Valores dos Bolões
            </h3>
            <button
              type="button"
              onClick={handleAddPool}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar Bolão</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Chave Pix</label>
              <input
                type="text"
                value={editConfig.pixKey}
                onChange={(e) =>
                  setEditConfig((prev) => ({ ...prev, pixKey: e.target.value }))
                }
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D0C] border border-white/15 text-sm font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Data Limite de Pagamento
              </label>
              <input
                type="text"
                value={editConfig.paymentDeadline}
                onChange={(e) =>
                  setEditConfig((prev) => ({
                    ...prev,
                    paymentDeadline: e.target.value,
                  }))
                }
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D0C] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                Favorecido Pix (Opcional)
              </label>
              <input
                type="text"
                value={editConfig.pixHolderName}
                onChange={(e) =>
                  setEditConfig((prev) => ({
                    ...prev,
                    pixHolderName: e.target.value,
                  }))
                }
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D0C] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                WhatsApp Organizador (DDI+DDD+Núm)
              </label>
              <input
                type="text"
                value={editConfig.organizerWhatsapp}
                onChange={(e) =>
                  setEditConfig((prev) => ({
                    ...prev,
                    organizerWhatsapp: e.target.value,
                  }))
                }
                placeholder="5561993816602"
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#090D0C] border border-white/15 text-sm font-mono text-white"
              />
            </div>
          </div>

          <div className="space-y-3">
            {editConfig.pools.map((pool) => (
              <div
                key={pool.id}
                className="rounded-xl border border-white/10 bg-[#090D0C] p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
              >
                <div className="lg:col-span-2">
                  <label className="block text-xs text-zinc-400 mb-1">
                    Nome e Descrição
                  </label>
                  <input
                    type="text"
                    value={pool.name}
                    onChange={(e) => updatePoolField(pool.id, 'name', e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#101815] border border-white/12 text-sm text-white mb-2"
                  />
                  <input
                    type="text"
                    value={pool.subtitle}
                    onChange={(e) =>
                      updatePoolField(pool.id, 'subtitle', e.target.value)
                    }
                    className="w-full min-h-[38px] px-3 rounded-lg bg-[#101815] border border-white/12 text-xs text-zinc-300"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Inteira (R$)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={pool.fullPrice}
                    onChange={(e) =>
                      updatePoolField(pool.id, 'fullPrice', Number(e.target.value))
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#101815] border border-white/12 text-sm font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Meia (R$)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={pool.halfPrice}
                    onChange={(e) =>
                      updatePoolField(pool.id, 'halfPrice', Number(e.target.value))
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#101815] border border-white/12 text-sm font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Total Cotas
                  </label>
                  <input
                    type="number"
                    value={pool.totalCotas}
                    onChange={(e) =>
                      updatePoolField(pool.id, 'totalCotas', Number(e.target.value))
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#101815] border border-white/12 text-sm font-mono text-white"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pool.active}
                      onChange={(e) =>
                        updatePoolField(pool.id, 'active', e.target.checked)
                      }
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <span>Ativo</span>
                  </label>
                  <span className="text-[11px] font-mono text-zinc-500">
                    Cols {pool.sheetColumns.participantCol}:{pool.sheetColumns.statusCol}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setEditConfig(config);
                setShowSettings(false);
              }}
              className="min-h-[42px] px-4 rounded-xl border border-white/12 text-xs font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingConfig}
              className="min-h-[42px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{savingConfig ? 'Salvando...' : 'Salvar Configurações'}</span>
            </button>
          </div>
        </form>
      )}

      {/* 2. Online Reservations Queue */}
      <section className="rounded-2xl border border-white/10 bg-[#101815] p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/8">
          <div>
            <h3 className="text-base font-bold text-white">
              Reservas Recebidas pelo Link
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Confirme pagamentos recebidos no Pix e acompanhe o status de envio para a planilha.
            </p>
          </div>
          <span className="text-xs text-zinc-400 font-mono tabular-nums">
            {reservations.length} registro(s)
          </span>
        </div>

        {reservations.length === 0 ? (
          <div className="py-10 text-center text-sm text-zinc-400">
            Nenhuma reserva feita pelo link ainda. Compartilhe o link da aba{' '}
            <strong className="text-zinc-200">Reservar Cotas</strong> com os participantes.
          </div>
        ) : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-zinc-400">
                  <th className="py-3 pr-4 font-medium">Participante</th>
                  <th className="py-3 px-4 font-medium">Cotas (Planilha)</th>
                  <th className="py-3 px-4 font-medium text-right">Valor</th>
                  <th className="py-3 px-4 font-medium">Planilha</th>
                  <th className="py-3 px-4 font-medium">Pagamento</th>
                  <th className="py-3 pl-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {reservations.map((res) => {
                  const allSynced = res.slots.every((s) => s.syncedToSheet);
                  const isPaid = res.paymentStatus === 'paid';
                  return (
                    <tr key={res.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-medium text-white">
                        {res.participantName}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-300">
                        {res.slots.map((s) => (
                          <div key={s.id}>
                            {s.poolName}: {s.sheetDisplayName}
                          </div>
                        ))}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-zinc-100 whitespace-nowrap">
                        {formatBRL(res.totalAmount)}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {allSynced ? (
                          <span className="text-emerald-400 font-medium inline-flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>Sincronizado</span>
                          </span>
                        ) : (
                          <span className="text-zinc-400">Aguardando envio</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleToggleAppPayment(res)}
                          className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                            isPaid
                              ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                              : 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                          }`}
                        >
                          {isPaid ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          <span>{isPaid ? 'Pago' : 'Marcar Pago'}</span>
                        </button>
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <button
                          type="button"
                          onClick={() => void handleDeleteReservation(res.id)}
                          aria-label={`Remover reserva de ${res.participantName}`}
                          className="min-h-[36px] min-w-[36px] rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 inline-flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Live Google Sheet Mirror (RESERVAS) */}
      {sheetData && (
        <section className="rounded-2xl border border-white/10 bg-[#101815] p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-white/8">
            <div>
              <h3 className="text-base font-bold text-white">
                Espelho da Aba {sheetData.tabName} ({sheetData.spreadsheetTitle})
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Dados lidos diretamente da sua planilha. Clique no status para atualizar na planilha.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
            {/* Bolão 1 Mirror */}
            <div className="rounded-xl border border-white/10 bg-[#090D0C] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <span className="text-sm font-bold text-white">
                  BOLÃO 1 (Cols A–D)
                </span>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {sheetData.pool1Rows.filter((r) => r.participant).length} preenchidas
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="sticky top-0 bg-[#0D1412] border-b border-white/10 text-zinc-400">
                    <tr>
                      <th className="py-2 px-3">Cota</th>
                      <th className="py-2 px-3">Participante</th>
                      <th className="py-2 px-3 text-right">Valor</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {sheetData.pool1Rows
                      .filter((r) => r.participant)
                      .map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="py-2 px-3 font-mono tabular-nums text-zinc-400">
                            {row.cotaLabel}
                          </td>
                          <td className="py-2 px-3 text-zinc-100">{row.participant}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-zinc-300">
                            {row.valueRaw}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setPendingStatusToggle({
                                  poolLabel: 'Bolão 1',
                                  participant: row.participant,
                                  rowNumber: row.rowNumber,
                                  statusCol: 'D',
                                  nextPaid: !row.paid,
                                })
                              }
                              className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                                row.paid
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : 'text-amber-300 bg-amber-500/10'
                              }`}
                            >
                              {row.paid ? 'Pago' : 'Pendente'}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bolão 2 Mirror */}
            <div className="rounded-xl border border-white/10 bg-[#090D0C] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <span className="text-sm font-bold text-white">
                  BOLÃO 2 (Cols F–I)
                </span>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {sheetData.pool2Rows.filter((r) => r.participant).length} preenchidas
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="sticky top-0 bg-[#0D1412] border-b border-white/10 text-zinc-400">
                    <tr>
                      <th className="py-2 px-3">Cota</th>
                      <th className="py-2 px-3">Participante</th>
                      <th className="py-2 px-3 text-right">Valor</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {sheetData.pool2Rows
                      .filter((r) => r.participant)
                      .map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="py-2 px-3 font-mono tabular-nums text-zinc-400">
                            {row.cotaLabel}
                          </td>
                          <td className="py-2 px-3 text-zinc-100">{row.participant}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-zinc-300">
                            {row.valueRaw}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setPendingStatusToggle({
                                  poolLabel: 'Bolão 2',
                                  participant: row.participant,
                                  rowNumber: row.rowNumber,
                                  statusCol: 'I',
                                  nextPaid: !row.paid,
                                })
                              }
                              className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                                row.paid
                                  ? 'text-emerald-400 bg-emerald-500/10'
                                  : 'text-amber-300 bg-amber-500/10'
                              }`}
                            >
                              {row.paid ? 'Pago' : 'Pendente'}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MANDATORY Confirmation Modal before mutating Google Sheets (Sync Reservations) */}
      {pendingPlan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-confirm-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-[#101815] p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 id="sync-confirm-title" className="text-lg font-bold text-white">
                  Confirmar gravação na planilha Google Sheets?
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Serão inseridas <strong className="text-white">{pendingPlan.length}</strong>{' '}
                  cota(s) na aba <strong className="text-white">{selectedTab}</strong>. Revise as células abaixo antes de confirmar:
                </p>
              </div>
            </div>

            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#090D0C] divide-y divide-white/8">
              {pendingPlan.map((item) => (
                <div
                  key={item.slotId}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">
                      {item.participantText}
                    </p>
                    <p className="text-zinc-400 font-mono">
                      {item.poolName} · {selectedTab}!{item.participantCell}:
                      {item.valueCell}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-emerald-400 shrink-0">
                    {formatBRL(item.valueAmount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingPlan(null)}
                disabled={syncing}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-white/12 text-sm font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSyncWrite()}
                disabled={syncing}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white cursor-pointer"
              >
                {syncing ? 'Gravando...' : 'Confirmar Envio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANDATORY Confirmation Modal before mutating Google Sheets (Status Cell) */}
      {pendingStatusToggle && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-confirm-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#101815] p-6 shadow-2xl">
            <h3 id="status-confirm-title" className="text-lg font-bold text-white">
              Atualizar status na planilha?
            </h3>
            <p className="text-sm text-zinc-300 mt-2">
              Alterar a célula{' '}
              <span className="font-mono text-white">
                {selectedTab}!{pendingStatusToggle.statusCol}
                {pendingStatusToggle.rowNumber}
              </span>{' '}
              ({pendingStatusToggle.poolLabel} —{' '}
              <strong>{pendingStatusToggle.participant}</strong>) para{' '}
              <strong>{pendingStatusToggle.nextPaid ? 'PAGO (TRUE)' : 'PENDENTE (FALSE)'}</strong>?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingStatusToggle(null)}
                disabled={togglingSheetStatus}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-white/12 text-sm font-medium text-zinc-300 hover:bg-white/5 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSheetStatusToggle()}
                disabled={togglingSheetStatus}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white cursor-pointer"
              >
                {togglingSheetStatus ? 'Atualizando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
