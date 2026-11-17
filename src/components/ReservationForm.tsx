import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  MessageCircle,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Ticket,
  User,
} from 'lucide-react';
import type { AppConfig, BolaoPool, Reservation } from '../types.ts';
import { copyTextToClipboard, formatBRL } from '../lib/format.ts';

interface ReservationFormProps {
  config: AppConfig;
  reservations: Reservation[];
  sheetOccupiedByPool: Record<string, number>;
  onCreated: (reservation: Reservation) => void;
  onQuickCopyPix: () => void;
}

interface PoolSelection {
  inteiras: number;
  meias: number;
}

export const ReservationForm: React.FC<ReservationFormProps> = ({
  config,
  reservations,
  sheetOccupiedByPool,
  onCreated,
  onQuickCopyPix,
}) => {
  const [participantName, setParticipantName] = useState('');
  const [selections, setSelections] = useState<Record<string, PoolSelection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedReservation, setConfirmedReservation] = useState<Reservation | null>(null);
  const [pixCopiedAuto, setPixCopiedAuto] = useState<boolean | null>(null);
  const [manualCopied, setManualCopied] = useState(false);

  const activePools = useMemo(
    () => config.pools.filter((p) => p.active),
    [config.pools],
  );

  const getPoolAvailability = (pool: BolaoPool) => {
    const appUnsyncedCount = reservations.reduce((acc, r) => {
      return (
        acc +
        r.slots.filter((s) => s.poolId === pool.id && !s.syncedToSheet).length
      );
    }, 0);

    const appTotalCount = reservations.reduce((acc, r) => {
      return acc + r.slots.filter((s) => s.poolId === pool.id).length;
    }, 0);

    const sheetCount = sheetOccupiedByPool[pool.id] ?? 0;
    const occupied = sheetCount > 0 ? sheetCount + appUnsyncedCount : appTotalCount;
    const remaining = Math.max(0, pool.totalCotas - occupied);

    return { occupied, remaining };
  };

  const updateCount = (
    pool: BolaoPool,
    kind: 'inteiras' | 'meias',
    delta: number,
  ) => {
    setError(null);
    setSelections((prev) => {
      const current = prev[pool.id] || { inteiras: 0, meias: 0 };
      const nextVal = Math.max(0, Math.min(20, current[kind] + delta));
      const otherVal = kind === 'inteiras' ? current.meias : current.inteiras;
      const { remaining } = getPoolAvailability(pool);

      if (delta > 0 && nextVal + otherVal > remaining) {
        setError(`${pool.name} tem apenas ${remaining} cota(s) disponível(is).`);
        return prev;
      }

      return {
        ...prev,
        [pool.id]: {
          ...current,
          [kind]: nextVal,
        },
      };
    });
  };

  const summaryItems = useMemo(() => {
    const items: Array<{
      poolId: string;
      poolName: string;
      inteiras: number;
      meias: number;
      subtotal: number;
    }> = [];

    for (const pool of activePools) {
      const sel = selections[pool.id];
      if (!sel) continue;
      if (sel.inteiras === 0 && sel.meias === 0) continue;
      const subtotal = sel.inteiras * pool.fullPrice + sel.meias * pool.halfPrice;
      items.push({
        poolId: pool.id,
        poolName: pool.name,
        inteiras: sel.inteiras,
        meias: sel.meias,
        subtotal,
      });
    }
    return items;
  }, [activePools, selections]);

  const totalAmount = useMemo(
    () => summaryItems.reduce((acc, item) => acc + item.subtotal, 0),
    [summaryItems],
  );

  const totalSlots = useMemo(
    () => summaryItems.reduce((acc, item) => acc + item.inteiras + item.meias, 0),
    [summaryItems],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = participantName.trim().replace(/\s+/g, ' ');
    if (cleanName.length < 3) {
      setError('Digite seu nome completo para identificar sua cota na planilha.');
      return;
    }

    if (totalSlots === 0) {
      setError('Escolha pelo menos 1 cota inteira ou meia antes de confirmar.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        participantName: cleanName,
        selections: summaryItems.map((item) => ({
          poolId: item.poolId,
          inteiras: item.inteiras,
          meias: item.meias,
        })),
      };

      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível registrar sua reserva.');
      }

      const created = data as Reservation;
      onCreated(created);
      setConfirmedReservation(created);

      const copied = await copyTextToClipboard(config.pixKey);
      setPixCopiedAuto(copied);
      if (copied) {
        onQuickCopyPix();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao confirmar reserva.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualCopyPix = async () => {
    const ok = await copyTextToClipboard(config.pixKey);
    if (ok) {
      setManualCopied(true);
      onQuickCopyPix();
      setTimeout(() => setManualCopied(false), 2500);
    }
  };

  const handleResetForm = () => {
    setConfirmedReservation(null);
    setParticipantName('');
    setSelections({});
    setError(null);
    setPixCopiedAuto(null);
    setManualCopied(false);
  };

  if (confirmedReservation) {
    const whatsappMessage = encodeURIComponent(
      `Olá! Acabei de reservar minhas cotas no ${config.eventTitle}:\n` +
        `Nome: ${confirmedReservation.participantName}\n` +
        confirmedReservation.slots
          .map(
            (s) =>
              `• ${s.poolName} (${s.kind === 'inteira' ? 'Inteira' : 'Meia'}) - ${formatBRL(
                s.unitValue,
              )}`,
          )
          .join('\n') +
        `\nTotal a pagar: ${formatBRL(confirmedReservation.totalAmount)}\n` +
        `Chave Pix: ${config.pixKey}${
          config.pixHolderName ? ` (${config.pixHolderName})` : ''
        }\n` +
        `Prazo: até ${config.paymentDeadline}`,
    );

    const whatsappHref = config.organizerWhatsapp
      ? `https://wa.me/${config.organizerWhatsapp}?text=${whatsappMessage}`
      : `https://wa.me/?text=${whatsappMessage}`;

    return (
      <section className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-emerald-500/30 bg-[#101815] p-6 sm:p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-medium text-emerald-400">
                  Reserva registrada com sucesso
                </p>
                <h2 className="text-2xl font-bold text-white tracking-tight mt-0.5">
                  {confirmedReservation.participantName}
                </h2>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-zinc-400">Valor total a pagar</p>
              <p className="text-2xl sm:text-3xl font-bold text-emerald-400 font-mono tabular-nums">
                {formatBRL(confirmedReservation.totalAmount)}
              </p>
            </div>
          </div>

          {/* Payment Deadline Banner */}
          <div className="mt-6 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 flex items-start gap-3">
            <CalendarClock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-200">
                Atenção ao prazo de pagamento: até {config.paymentDeadline}
              </p>
              <p className="text-xs sm:text-sm text-amber-100/80 mt-1">
                Realize o pagamento via Pix até o dia{' '}
                <strong className="font-semibold text-amber-200">
                  {config.paymentDeadline}
                </strong>{' '}
                para garantir suas cotas no bolão.
              </p>
            </div>
          </div>

          {/* Pix Copy Box */}
          <div className="mt-5 rounded-xl border border-white/10 bg-[#0A100E] p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs text-zinc-400">
                  Chave Pix (Celular)
                  {pixCopiedAuto && (
                    <span className="text-emerald-400 font-medium">
                      {' · '}Copiada automaticamente!
                    </span>
                  )}
                </p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white tracking-wide mt-1">
                  {config.pixKey}
                </p>
                <p className="text-sm text-zinc-200 mt-1">
                  Organizador / Favorecido:{' '}
                  <strong className="font-semibold text-white">
                    {config.pixHolderName || 'Allyson Leandro'}
                  </strong>
                </p>
              </div>

              <button
                type="button"
                onClick={handleManualCopyPix}
                className="min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {manualCopied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Chave Pix Copiada</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar Chave Pix</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Slots breakdown matching spreadsheet */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>Cotas reservadas para a aba RESERVAS</span>
              </h3>
              <span className="text-xs text-zinc-400 tabular-nums">
                {confirmedReservation.slots.length} cota(s)
              </span>
            </div>

            <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0A100E] overflow-hidden">
              {confirmedReservation.slots.map((slot) => (
                <div
                  key={slot.id}
                  className="px-4 py-3 flex items-center justify-between gap-4 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100 truncate">
                      {slot.sheetDisplayName}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {slot.poolName} · {slot.kind === 'inteira' ? 'Inteira' : 'Meia cota'}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-emerald-400 shrink-0">
                    {formatBRL(slot.unitValue)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-3">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-h-[46px] px-5 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span>Enviar Resumo no WhatsApp</span>
            </a>

            <button
              type="button"
              onClick={handleResetForm}
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-transparent hover:bg-white/6 border border-white/12 text-zinc-300 text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Nova Reserva</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
      {/* Left column: Name + Bolão selection */}
      <div className="lg:col-span-7 space-y-6">
        {/* Participant Name Field */}
        <section className="rounded-2xl border border-white/10 bg-[#101815] p-5 sm:p-6">
          <label
            htmlFor="participant-name"
            className="block text-base font-semibold text-white"
          >
            Seu Nome Completo
          </label>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Informe nome e sobrenome exatamente como deve constar na planilha do bolão.
          </p>

          <div className="relative mt-3.5">
            <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="participant-name"
              type="text"
              value={participantName}
              onChange={(e) => {
                setParticipantName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Ex.: Maria Aparecida Silva"
              autoComplete="name"
              maxLength={100}
              className="w-full min-h-[48px] pl-10 pr-4 py-3 rounded-xl bg-[#090D0C] border border-white/15 text-white placeholder:text-zinc-500 text-base focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-colors"
            />
          </div>
        </section>

        {/* Bolão Selection Cards */}
        <div className="space-y-4">
          {activePools.map((pool) => {
            const sel = selections[pool.id] || { inteiras: 0, meias: 0 };
            const { remaining } = getPoolAvailability(pool);
            const selectedInPool = sel.inteiras + sel.meias;

            return (
              <section
                key={pool.id}
                className={`rounded-2xl border transition-colors p-5 sm:p-6 ${
                  selectedInPool > 0
                    ? 'border-emerald-500/45 bg-[#111D18]'
                    : 'border-white/10 bg-[#101815]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-4 border-b border-white/8">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
                      <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                        {pool.name}
                      </h2>
                    </div>
                    <p className="text-sm text-zinc-300 mt-1.5">
                      {pool.subtitle}
                      {pool.equivalentLabel && (
                        <span className="text-zinc-400">
                          {' '}· {pool.equivalentLabel}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="sm:text-right shrink-0">
                    <p className="text-lg font-bold text-emerald-400 font-mono tabular-nums">
                      {formatBRL(pool.fullPrice)}
                      <span className="text-xs font-sans font-normal text-zinc-400">
                        {' '}/ cota
                      </span>
                    </p>
                    <p className="text-xs text-zinc-400 tabular-nums mt-0.5">
                      {remaining > 0
                        ? `${remaining} cota(s) disponível(is)`
                        : 'Cotas esgotadas'}
                    </p>
                  </div>
                </div>

                {/* Quota Steppers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
                  {/* Inteira */}
                  <div className="rounded-xl border border-white/10 bg-[#090D0C] p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Inteira</p>
                      <p className="text-xs text-zinc-400 font-mono tabular-nums">
                        {formatBRL(pool.fullPrice)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Remover cota inteira de ${pool.name}`}
                        onClick={() => updateCount(pool, 'inteiras', -1)}
                        disabled={sel.inteiras === 0}
                        className="w-11 h-11 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center text-base font-bold font-mono tabular-nums text-white">
                        {sel.inteiras}
                      </span>
                      <button
                        type="button"
                        aria-label={`Adicionar cota inteira de ${pool.name}`}
                        onClick={() => updateCount(pool, 'inteiras', 1)}
                        disabled={remaining === 0 || selectedInPool >= remaining}
                        className="w-11 h-11 rounded-lg border border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center text-emerald-300 transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Meia */}
                  <div className="rounded-xl border border-white/10 bg-[#090D0C] p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Meia</p>
                      <p className="text-xs text-zinc-400 font-mono tabular-nums">
                        {formatBRL(pool.halfPrice)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Remover meia cota de ${pool.name}`}
                        onClick={() => updateCount(pool, 'meias', -1)}
                        disabled={sel.meias === 0}
                        className="w-11 h-11 rounded-lg border border-white/12 bg-white/5 hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center text-base font-bold font-mono tabular-nums text-white">
                        {sel.meias}
                      </span>
                      <button
                        type="button"
                        aria-label={`Adicionar meia cota de ${pool.name}`}
                        onClick={() => updateCount(pool, 'meias', 1)}
                        disabled={remaining === 0 || selectedInPool >= remaining}
                        className="w-11 h-11 rounded-lg border border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center text-emerald-300 transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Right column: Sticky Checkout Summary */}
      <aside className="lg:col-span-5 lg:sticky lg:top-20">
        <div className="rounded-2xl border border-white/12 bg-[#101815] p-5 sm:p-6">
          <h2 className="text-lg font-bold text-white tracking-tight">
            Resumo da Reserva
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Ao confirmar, a chave Pix é copiada automaticamente para o pagamento.
          </p>

          <div className="mt-5 pt-4 border-t border-white/8 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">Participante</span>
              <span className="font-medium text-white truncate max-w-[220px]">
                {participantName.trim() || 'Não informado'}
              </span>
            </div>

            {summaryItems.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">
                Nenhuma cota selecionada ainda. Use os botões + ao lado para escolher.
              </p>
            ) : (
              <div className="space-y-2 pt-1">
                {summaryItems.map((item) => (
                  <div
                    key={item.poolId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-zinc-300">
                      {item.poolName}{' '}
                      <span className="text-zinc-400 text-xs">
                        (
                        {[
                          item.inteiras > 0 ? `${item.inteiras} int.` : '',
                          item.meias > 0 ? `${item.meias} meia` : '',
                        ]
                          .filter(Boolean)
                          .join(' + ')}
                        )
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-zinc-100 font-medium">
                      {formatBRL(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-white/10 flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-zinc-300">
              Valor Total a Pagar
            </span>
            <span className="text-3xl font-bold font-mono tabular-nums text-emerald-400">
              {formatBRL(totalAmount)}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-white/8 bg-[#090D0C] p-3.5 text-xs text-zinc-300 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Chave Pix:</span>
              <span className="font-mono tabular-nums text-white font-medium">
                {config.pixKey}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Organizador:</span>
              <span className="text-white font-medium">
                {config.pixHolderName || 'Allyson Leandro'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Pagar até:</span>
              <span className="font-semibold text-amber-300 tabular-nums">
                {config.paymentDeadline}
              </span>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full min-h-[50px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base transition-all flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer shadow-lg shadow-emerald-950/60"
          >
            {submitting ? 'Confirmando reserva...' : 'Confirmar e Reservar Cotas'}
          </button>
        </div>
      </aside>
    </form>
  );
};
