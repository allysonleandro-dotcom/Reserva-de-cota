import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import type { AppConfig, CreateReservationPayload, Reservation, ReservationSlot } from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bolao-store.json');

interface StoreData {
  config: AppConfig;
  reservations: Reservation[];
}

const DEFAULT_CONFIG: AppConfig = {
  eventTitle: 'Mega da Virada',
  estimatedPrize: 'Estimada em 1 Bilhão',
  pixKey: '61993816602',
  pixHolderName: 'Allyson Leandro',
  paymentDeadline: '17/12/2026',
  organizerWhatsapp: '',
  spreadsheetUrlOrId: '',
  sheetTabName: 'RESERVAS',
  pools: [
    {
      id: 'bolao-1',
      name: 'Bolão 1',
      subtitle: '1 Aposta de 12 dezenas',
      equivalentLabel: 'Equivale a 924 apostas simples',
      fullPrice: 60,
      halfPrice: 30,
      totalCotas: 100,
      active: true,
      sheetColumns: {
        cotaCol: 'A',
        participantCol: 'B',
        valueCol: 'C',
        statusCol: 'D',
      },
    },
    {
      id: 'bolao-2',
      name: 'Bolão 2',
      subtitle: '3 Apostas de 11 dezenas',
      equivalentLabel: 'Equivale a 1.386 apostas simples',
      fullPrice: 90,
      halfPrice: 45,
      totalCotas: 105,
      active: true,
      sheetColumns: {
        cotaCol: 'F',
        participantCol: 'G',
        valueCol: 'H',
        statusCol: 'I',
      },
    },
  ],
};

function ensureStore(): StoreData {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial: StoreData = {
      config: DEFAULT_CONFIG,
      reservations: [],
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreData;
    const mergedConfig = { ...DEFAULT_CONFIG, ...parsed.config };
    if (mergedConfig.pixHolderName === 'Organizador do Bolão') {
      mergedConfig.pixHolderName = 'Allyson Leandro';
    }
    return {
      config: mergedConfig,
      reservations: Array.isArray(parsed.reservations) ? parsed.reservations : [],
    };
  } catch {
    const fallback: StoreData = { config: DEFAULT_CONFIG, reservations: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallback, null, 2), 'utf-8');
    return fallback;
  }
}

function saveStore(data: StoreData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    const store = ensureStore();
    res.json(store.config);
  });

  app.put('/api/config', (req, res) => {
    const store = ensureStore();
    const incoming = req.body as Partial<AppConfig>;

    const nextConfig: AppConfig = {
      ...store.config,
      eventTitle: typeof incoming.eventTitle === 'string' && incoming.eventTitle.trim()
        ? incoming.eventTitle.trim().slice(0, 80)
        : store.config.eventTitle,
      estimatedPrize: typeof incoming.estimatedPrize === 'string'
        ? incoming.estimatedPrize.trim().slice(0, 80)
        : store.config.estimatedPrize,
      pixKey: typeof incoming.pixKey === 'string' && incoming.pixKey.trim()
        ? incoming.pixKey.trim().slice(0, 100)
        : store.config.pixKey,
      pixHolderName: typeof incoming.pixHolderName === 'string'
        ? incoming.pixHolderName.trim().slice(0, 80)
        : store.config.pixHolderName,
      paymentDeadline: typeof incoming.paymentDeadline === 'string' && incoming.paymentDeadline.trim()
        ? incoming.paymentDeadline.trim().slice(0, 40)
        : store.config.paymentDeadline,
      organizerWhatsapp: typeof incoming.organizerWhatsapp === 'string'
        ? incoming.organizerWhatsapp.replace(/[^\d]/g, '').slice(0, 20)
        : store.config.organizerWhatsapp,
      spreadsheetUrlOrId: typeof incoming.spreadsheetUrlOrId === 'string'
        ? incoming.spreadsheetUrlOrId.trim().slice(0, 300)
        : store.config.spreadsheetUrlOrId,
      sheetTabName: typeof incoming.sheetTabName === 'string' && incoming.sheetTabName.trim()
        ? incoming.sheetTabName.trim().slice(0, 80)
        : store.config.sheetTabName,
      pools: Array.isArray(incoming.pools) && incoming.pools.length > 0
        ? incoming.pools.map((p) => ({
            id: String(p.id || makeId('bolao')).slice(0, 40),
            name: String(p.name || 'Bolão').trim().slice(0, 60),
            subtitle: String(p.subtitle || '').trim().slice(0, 120),
            equivalentLabel: String(p.equivalentLabel || '').trim().slice(0, 120),
            fullPrice: Math.max(1, Number(p.fullPrice) || 60),
            halfPrice: Math.max(1, Number(p.halfPrice) || 30),
            totalCotas: Math.max(1, Math.min(500, Math.round(Number(p.totalCotas) || 100))),
            active: Boolean(p.active),
            sheetColumns: p.sheetColumns && p.sheetColumns.participantCol
              ? {
                  cotaCol: String(p.sheetColumns.cotaCol || 'A').toUpperCase().slice(0, 3),
                  participantCol: String(p.sheetColumns.participantCol || 'B').toUpperCase().slice(0, 3),
                  valueCol: String(p.sheetColumns.valueCol || 'C').toUpperCase().slice(0, 3),
                  statusCol: String(p.sheetColumns.statusCol || 'D').toUpperCase().slice(0, 3),
                }
              : { cotaCol: 'A', participantCol: 'B', valueCol: 'C', statusCol: 'D' },
          }))
        : store.config.pools,
    };

    store.config = nextConfig;
    saveStore(store);
    res.json(nextConfig);
  });

  app.get('/api/reservations', (_req, res) => {
    const store = ensureStore();
    res.json({
      reservations: store.reservations,
    });
  });

  app.post('/api/reservations', (req, res) => {
    const store = ensureStore();
    const payload = req.body as CreateReservationPayload;

    const cleanName = typeof payload.participantName === 'string'
      ? payload.participantName.trim().replace(/\s+/g, ' ').slice(0, 100)
      : '';

    if (cleanName.length < 3) {
      res.status(400).json({ error: 'Informe seu nome completo (mínimo 3 caracteres).' });
      return;
    }

    if (!Array.isArray(payload.selections) || payload.selections.length === 0) {
      res.status(400).json({ error: 'Selecione pelo menos 1 cota para confirmar a reserva.' });
      return;
    }

    const slots: ReservationSlot[] = [];
    let totalAmount = 0;

    for (const sel of payload.selections) {
      const pool = store.config.pools.find((p) => p.id === sel.poolId && p.active);
      if (!pool) continue;

      const inteiras = Math.max(0, Math.min(20, Math.floor(Number(sel.inteiras) || 0)));
      const meias = Math.max(0, Math.min(20, Math.floor(Number(sel.meias) || 0)));

      if (inteiras === 0 && meias === 0) continue;

      const alreadyUsed = store.reservations.reduce((acc, r) => {
        return acc + r.slots.filter((s) => s.poolId === pool.id).length;
      }, 0);

      if (alreadyUsed + inteiras + meias > pool.totalCotas) {
        const remaining = Math.max(0, pool.totalCotas - alreadyUsed);
        res.status(409).json({
          error: `${pool.name} possui apenas ${remaining} cota(s) disponível(is) no momento.`,
        });
        return;
      }

      for (let i = 0; i < inteiras; i++) {
        slots.push({
          id: makeId('slot'),
          poolId: pool.id,
          poolName: pool.name,
          kind: 'inteira',
          sheetDisplayName: cleanName,
          unitValue: pool.fullPrice,
          syncedToSheet: false,
        });
        totalAmount += pool.fullPrice;
      }

      for (let i = 0; i < meias; i++) {
        slots.push({
          id: makeId('slot'),
          poolId: pool.id,
          poolName: pool.name,
          kind: 'meia',
          sheetDisplayName: `${cleanName} (MEIA)`,
          unitValue: pool.halfPrice,
          syncedToSheet: false,
        });
        totalAmount += pool.halfPrice;
      }
    }

    if (slots.length === 0) {
      res.status(400).json({ error: 'Escolha pelo menos 1 cota inteira ou meia.' });
      return;
    }

    const reservation: Reservation = {
      id: makeId('res'),
      participantName: cleanName,
      createdAt: new Date().toISOString(),
      totalAmount,
      paymentStatus: 'pending',
      slots,
    };

    store.reservations.unshift(reservation);
    saveStore(store);

    res.status(201).json(reservation);
  });

  app.patch('/api/reservations/:id', (req, res) => {
    const store = ensureStore();
    const { id } = req.params;
    const reservation = store.reservations.find((r) => r.id === id);
    if (!reservation) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }

    const { paymentStatus } = req.body as { paymentStatus?: 'pending' | 'paid' };
    if (paymentStatus === 'pending' || paymentStatus === 'paid') {
      reservation.paymentStatus = paymentStatus;
    }

    saveStore(store);
    res.json(reservation);
  });

  app.delete('/api/reservations/:id', (req, res) => {
    const store = ensureStore();
    const { id } = req.params;
    const before = store.reservations.length;
    store.reservations = store.reservations.filter((r) => r.id !== id);
    if (store.reservations.length === before) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }
    saveStore(store);
    res.json({ deleted: true, id });
  });

  app.post('/api/reservations/mark-synced', (req, res) => {
    const store = ensureStore();
    const { syncedSlots } = req.body as {
      syncedSlots?: Array<{ slotId: string; rowNumber: number; sheetRange: string }>;
    };

    if (!Array.isArray(syncedSlots)) {
      res.status(400).json({ error: 'Payload inválido.' });
      return;
    }

    const lookup = new Map(syncedSlots.map((item) => [item.slotId, item]));
    let updatedCount = 0;

    for (const reservation of store.reservations) {
      for (const slot of reservation.slots) {
        const match = lookup.get(slot.id);
        if (match) {
          slot.syncedToSheet = true;
          slot.sheetRow = match.rowNumber;
          slot.sheetRange = match.sheetRange;
          updatedCount += 1;
        }
      }
    }

    saveStore(store);
    res.json({ updatedCount, reservations: store.reservations });
  });

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist'));

  if (isProd) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bolão server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
