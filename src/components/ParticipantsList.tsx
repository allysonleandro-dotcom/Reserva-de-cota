import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Search, Users } from 'lucide-react';
import type { AppConfig, Reservation } from '../types.ts';
import { formatBRL, formatDateTimeBR } from '../lib/format.ts';

interface ParticipantsListProps {
  config: AppConfig;
  reservations: Reservation[];
  sheetOccupiedByPool: Record<string, number>;
}

export const ParticipantsList: React.FC<ParticipantsListProps> = ({
  config,
  reservations,
  sheetOccupiedByPool,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');

  const poolStats = useMemo(() => {
    return config.pools
      .filter((p) => p.active)
      .map((pool) => {
        const appAll = reservations.reduce(
          (acc, r) => acc + r.slots.filter((s) => s.poolId === pool.id).length,
          0,
        );
        const appUnsynced = reservations.reduce(
          (acc, r) =>
            acc +
            r.slots.filter((s) => s.poolId === pool.id && !s.syncedToSheet).length,
          0,
        );
        const sheetOccupied = sheetOccupiedByPool[pool.id] ?? 0;
        const totalOccupied =
          sheetOccupied > 0 ? sheetOccupied + appUnsynced : appAll;
        const remaining = Math.max(0, pool.totalCotas - totalOccupied);

        return {
          pool,
          totalOccupied,
          remaining,
          appAll,
        };
      });
  }, [config.pools, reservations, sheetOccupiedByPool]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reservations.filter((r) => {
      if (statusFilter !== 'all' && r.paymentStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.participantName.toLowerCase().includes(q) ||
        r.slots.some((s) => s.poolName.toLowerCase().includes(q))
      );
    });
  }, [reservations, search, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Pool availability strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {poolStats.map(({ pool, totalOccupied, remaining }) => (
          <div
            key={pool.id}
            className="rounded-2xl border border-white/10 bg-[#101815] p-5 flex items-center justify-between gap-4"
          >
            <div>
              <h3 className="text-base font-bold text-white">{pool.name}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">{pool.subtitle}</p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <p className="text-xl font-bold text-emerald-400">
                {remaining} <span className="text-xs font-sans font-normal text-zinc-400">disponíveis</span>
              </p>
              <p className="text-xs text-zinc-400">
                {totalOccupied} reservadas de {pool.totalCotas}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter & Search bar */}
      <div className="rounded-2xl border border-white/10 bg-[#101815] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/8">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar participante pelo nome..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#090D0C] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#090D0C] border border-white/10 self-start sm:self-auto">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'pending', label: 'Pendentes' },
                { id: 'paid', label: 'Pagos' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-emerald-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table / List */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-300">
              {reservations.length === 0
                ? 'Nenhuma reserva feita pelo link ainda.'
                : 'Nenhum participante encontrado com esse filtro.'}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              As reservas feitas pelo formulário aparecem aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/8 mt-2">
            {filtered.map((res) => {
              const isPaid = res.paymentStatus === 'paid';
              return (
                <div
                  key={res.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {res.participantName}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {res.slots
                        .map(
                          (s) =>
                            `${s.poolName} (${s.kind === 'inteira' ? 'Inteira' : 'Meia'})`,
                        )
                        .join(' · ')}
                      {' · '}
                      <span className="tabular-nums">
                        {formatDateTimeBR(res.createdAt)}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <span className="font-mono tabular-nums text-sm font-semibold text-zinc-100">
                      {formatBRL(res.totalAmount)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        isPaid ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {isPaid ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      <span>{isPaid ? 'Pago' : 'Pendente'}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
