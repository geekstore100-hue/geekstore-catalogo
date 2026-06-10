// sync.js — Descarga el catálogo completo de Alegra y genera productos.json
// con solo los artículos activos y con stock > 0.
// Corre en GitHub Actions (gratis). Las credenciales llegan como variables
// de entorno desde los Secrets del repositorio: nunca quedan en el código.

const fs = require('fs');

const API_BASE = 'https://api.alegra.com/api/v1';
const PAGE_SIZE = 30;
const MAX_PAGES = 200; // hasta 6.000 artículos
const PAUSA_MS = 500;  // pausa entre páginas para respetar el límite de Alegra

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAlegra(url, auth) {
  const esperas = [2000, 4000, 8000, 16000];
  for (let intento = 0; intento <= esperas.length; intento++) {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (res.status !== 429) return res;
    if (intento < esperas.length) {
      console.warn(`Alegra respondió 429, reintentando en ${esperas[intento]} ms`);
      await sleep(esperas[intento]);
    } else {
      return res;
    }
  }
}

function normalizar(raw) {
  const precioEntry = Array.isArray(raw.price) ? raw.price[0] : raw.price;
  const price = Number(precioEntry?.price ?? precioEntry ?? 0);
  const available = Number(raw.inventory?.availableQuantity ?? 0);
  const warehouses = (raw.inventory?.warehouses ?? [])
    .map((w) => ({ name: w.name, quantity: Number(w.availableQuantity ?? 0) }))
    .filter((w) => w.quantity > 0);
  const images = (raw.images ?? [])
    .map((img) => img.url || img.favorite?.url)
    .filter(Boolean);

  return {
    id: String(raw.id),
    name: raw.name ?? 'Producto sin nombre',
    description: raw.description ?? '',
    reference: raw.reference?.reference ?? raw.reference ?? '',
    category: raw.itemCategory?.name ?? '',
    price,
    available,
    warehouses,
    image: images[0] ?? null,
    images,
    status: raw.status ?? 'active',
  };
}

async function main() {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  if (!email || !token) {
    throw new Error(
      'Faltan los secrets ALEGRA_EMAIL / ALEGRA_TOKEN en el repositorio (Settings > Secrets and variables > Actions).'
    );
  }
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  const todos = [];
  let paginas = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API_BASE}/items?start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}&order_field=name`;
    const res = await fetchAlegra(url, auth);
    if (!res.ok) {
      throw new Error(`Alegra respondió ${res.status} en la página ${page}`);
    }
    const lote = await res.json();
    if (!Array.isArray(lote) || lote.length === 0) break;
    todos.push(...lote);
    paginas++;
    if (page % 10 === 0) console.log(`Página ${page}: ${todos.length} artículos acumulados...`);
    if (lote.length < PAGE_SIZE) break;
    await sleep(PAUSA_MS);
  }

  const enStock = todos
    .map(normalizar)
    .filter((p) => p.status === 'active' && p.available > 0);

  fs.writeFileSync(
    'productos.json',
    JSON.stringify(
      {
        actualizado: new Date().toISOString(),
        totalAlegra: todos.length,
        totalEnStock: enStock.length,
        productos: enStock,
      },
      null,
      1
    )
  );

  console.log(
    `Listo: ${todos.length} artículos leídos en ${paginas} páginas. ${enStock.length} con stock guardados en productos.json.`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
