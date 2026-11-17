import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, Copy, Share2 } from 'lucide-react';
import type { AppConfig, ParsedReservasSheet, Reservation } from './types.ts';
import { copyTextToClipboard } from './lib/format.ts';
import { googleSignIn, initAuth, logout } from './lib/firebaseAuth.ts';
import { ReservationForm } from './components/ReservationForm.tsx';
import { ParticipantsList } from './components/ParticipantsList.tsx';
import { AdminSheetPanel } from './components/AdminSheetPanel.tsx';

type ActiveTab = 'reservar' | 'participantes' | 'admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reservar');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Firebase Auth & Google Sheets state
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [sheetData, setSheetData] = useState<ParsedReservasSheet | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<string | null>(null);
  const [headerPixCopied, setHeaderPixCopied] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((current) => (current === msg ? null : current));
    }, 3200);
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setAuthUser(user);
        setAccessToken(token);
      },
      (user) => {
        setAuthUser(user);
        setAccessToken(null);
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const [cfgRes, resRes] = await Promise.all([
          fetch('/api/config'),
          fetch('/api/reservations'),
        ]);
        if (!cfgRes.ok || !resRes.ok) {
          throw new Error('Erro ao carregar configurações do bolão.');
        }
        const cfgData = (await cfgRes.json()) as AppConfig;
        const resData = (await resRes.json()) as { reservations: Reservation[] };
        if (!cancelled) {
          setConfig(cfgData);
          setReservations(resData.reservations);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Erro ao iniciar aplicativo.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  const sheetOccupiedByPool = useMemo<Record<string, number>>(() => {
    if (!sheetData) return {} as Record<string, number>;
    return {
      'bolao-1': sheetData.pool1Rows.filter((r) => Boolean(r.participant)).length,
      'bolao-2': sheetData.pool2Rows.filter((r) => Boolean(r.participant)).length,
    };
  }, [sheetData]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setAuthUser(result.user);
        setAccessToken(result.accessToken);
        showToast('Conta Google conectada!');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Não foi possível entrar com Google.',
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setAuthUser(null);
    setAccessToken(null);
    showToast('Conta Google desconectada.');
  };

  const handleHeaderCopyPix = async () => {
    if (!config) return;
    const ok = await copyTextToClipboard(config.pixKey);
    if (ok) {
      setHeaderPixCopied(true);
      showToast(`Chave Pix ${config.pixKey} copiada!`);
      setTimeout(() => setHeaderPixCopied(false), 2500);
    }
  };

  const handleShareLink = async () => {
    const shareUrl = window.location.origin;
    const ok = await copyTextToClipboard(shareUrl);
    if (ok) {
      showToast('Link de reserva copiado para compartilhar!');
    }
  };

  return (
    <div className="min-h-screen bg-[#090D0C] text-zinc-100 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#090D0C]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('reservar')}
            className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {config?.eventTitle || 'Mega da Virada'}
          </button>

          {/* Zone 2: Concise single-line nav links */}
          <nav
            aria-label="Navegação principal"
            className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium overflow-x-auto"
          >
            <button
              type="button"
              onClick={() => setActiveTab('reservar')}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'reservar'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Reservar Cotas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('participantes')}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'participantes'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Participantes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'admin'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Planilha e Admin
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="hidden sm:flex items-center shrink-0">
            {activeTab === 'admin' ? (
              <button
                type="button"
                onClick={() => void handleShareLink()}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Copiar Link</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleHeaderCopyPix()}
                className="min-h-[38px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {headerPixCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Pix Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span className="font-mono tabular-nums">
                      Pix: {config?.pixKey || '61993816602'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {loading ? (
          <div className="space-y-4">
            <div className="h-8 w-64 rounded-lg bg-white/6 animate-pulse" />
            <div className="h-48 rounded-2xl bg-white/5 animate-pulse" />
          </div>
        ) : loadError || !config ? (
          <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-6 text-sm text-red-200">
            {loadError || 'Não foi possível carregar os dados do bolão.'}
          </div>
        ) : (
          <>
            {/* Editorial Page Header */}
            <div className="mb-8">
              <p className="text-xs sm:text-sm text-emerald-400 font-medium">
                Pagamento até {config.paymentDeadline} · Pix{' '}
                <span className="font-mono tabular-nums text-zinc-200">
                  {config.pixKey}
                </span>{' '}
                <span className="text-zinc-300">
                  ({config.pixHolderName || 'Allyson Leandro'})
                </span>
              </p>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-2 text-balance">
                {activeTab === 'reservar' && (
                  <>
                    {config.eventTitle}{' '}
                    <span className="text-amber-400">{config.estimatedPrize}</span>{' '}
                    - Reserve Suas cotas
                  </>
                )}
                {activeTab === 'participantes' &&
                  `Participantes e cotas disponíveis`}
                {activeTab === 'admin' &&
                  `Painel do Organizador e Planilha RESERVAS`}
              </h1>
              <p className="text-sm sm:text-base text-zinc-400 mt-2 max-w-2xl">
                {activeTab === 'reservar' &&
                  'Preencha seu nome completo, selecione a quantidade de cotas inteiras ou meias e confirme para copiar a chave Pix.'}
                {activeTab === 'participantes' &&
                  'Confira as cotas reservadas pelo link e o status de pagamento de cada participante.'}
                {activeTab === 'admin' &&
                  'Conecte sua planilha do Google Sheets para importar disponibilidades e registrar novos participantes na aba RESERVAS.'}
              </p>
            </div>

            {activeTab === 'reservar' && (
              <ReservationForm
                config={config}
                reservations={reservations}
                sheetOccupiedByPool={sheetOccupiedByPool}
                onCreated={(created) =>
                  setReservations((prev) => [created, ...prev])
                }
                onQuickCopyPix={() =>
                  showToast(`Chave Pix ${config.pixKey} copiada!`)
                }
              />
            )}

            {activeTab === 'participantes' && (
              <ParticipantsList
                config={config}
                reservations={reservations}
                sheetOccupiedByPool={sheetOccupiedByPool}
              />
            )}

            {activeTab === 'admin' && (
              <AdminSheetPanel
                config={config}
                reservations={reservations}
                authUser={authUser}
                accessToken={accessToken}
                isLoggingIn={isLoggingIn}
                onGoogleLogin={handleGoogleLogin}
                onGoogleLogout={handleGoogleLogout}
                onConfigSaved={setConfig}
                onReservationsUpdated={setReservations}
                sheetData={sheetData}
                onSheetDataLoaded={setSheetData}
                onNotify={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/8 py-6 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <span>
            {config?.eventTitle || 'Bolão Mega da Virada'} · Prazo Pix:{' '}
            {config?.paymentDeadline || '17/12/2026'}
          </span>
          <button
            type="button"
            onClick={() => void handleShareLink()}
            className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            Copiar link deste formulário
          </button>
        </div>
      </footer>

      {/* Floating Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-xl border border-emerald-500/40 bg-[#11211B] px-4 py-3 text-sm font-medium text-emerald-100 shadow-xl shadow-black/50 flex items-center gap-2.5"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
