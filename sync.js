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

// Detecta el precio de distribuidor en la lista de precios de un artículo
const ES_DISTRIBUIDOR = /distribu|mayor/i;

function precioDistribuidor(raw) {
  if (!Array.isArray(raw.price)) return null;
  const entrada = raw.price.find((p) => ES_DISTRIBUIDOR.test(p?.name ?? ''));
  if (!entrada) return null;
  const valor = Number(entrada.price ?? 0);
  return valor > 0 ? valor : null;
}

async function traerContactos(auth) {
  const contactos = [];
  let vaciasSeguidas = 0;
  for (let page = 0; page < 400; page++) {
    // limit=30 y orden estable; pedimos el tipo cliente explícitamente
    const url = `${API_BASE}/contacts?start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}&order_field=name&order_direction=ASC`;
    const res = await fetchAlegra(url, auth);
    if (res.status === 400) {
      // Alegra a veces devuelve 400 en una página puntual; no significa fin.
      // Saltamos esa página y seguimos un par de veces antes de rendirnos.
      console.warn(`Alegra respondió 400 en la página de contactos ${page}; la salto y sigo.`);
      vaciasSeguidas++;
      if (vaciasSeguidas >= 3) break;
      await sleep(PAUSA_MS);
      continue;
    }
    if (!res.ok) {
      console.warn(`Alegra respondió ${res.status} leyendo contactos; continúo sin más páginas.`);
      break;
    }
    const lote = await res.json();
    if (!Array.isArray(lote)) break;
    if (lote.length === 0) {
      vaciasSeguidas++;
      if (vaciasSeguidas >= 2) break;
    } else {
      vaciasSeguidas = 0;
      contactos.push(...lote);
    }
    await sleep(PAUSA_MS);
  }
  return contactos;
}

function cedulaDe(contacto) {
  const ident = contacto.identification;
  if (!ident) return null;
  if (typeof ident === 'string') return ident.trim();
  if (typeof ident === 'object' && ident.number) return String(ident.number).trim();
  return null;
}

async function publicarEnRepoPrivado(contenido) {
  const token = process.env.DATOS_TOKEN;
  const repo = process.env.REPO_DATOS;
  if (!token || !repo) {
    console.warn('Sin DATOS_TOKEN / REPO_DATOS: no se publican datos de distribuidores.');
    return;
  }
  const api = `https://api.github.com/repos/${repo}/contents/distribuidores.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  // Obtener sha actual si el archivo ya existe
  let sha;
  const actual = await fetch(api, { headers });
  if (actual.ok) sha = (await actual.json()).sha;

  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Datos de distribuidores actualizados',
      content: Buffer.from(JSON.stringify(contenido, null, 1)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub respondió ${res.status} publicando distribuidores.json`);
  }
  console.log(`distribuidores.json publicado en ${repo} (privado).`);
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

  // ----- Datos de distribuidores (van al repositorio PRIVADO) -----
  const idsEnStock = new Set(enStock.map((p) => p.id));
  const precios = {};
  for (const raw of todos) {
    const pd = precioDistribuidor(raw);
    if (pd && idsEnStock.has(String(raw.id))) {
      precios[String(raw.id)] = pd;
    }
  }
  console.log(`Artículos en stock con precio de distribuidor: ${Object.keys(precios).length}`);

  console.log('Leyendo contactos para identificar distribuidores...');
  const contactos = await traerContactos(auth);
  const distribuidores = contactos
    .filter((c) => {
      const lista = c.priceList?.name ?? c.priceList ?? '';
      return ES_DISTRIBUIDOR.test(String(lista));
    })
    .map((c) => ({
      id: c.id,
      nombre: c.name ?? '',
      cedula: cedulaDe(c),
    }))
    .filter((c) => c.cedula);
  console.log(`Contactos leídos: ${contactos.length}. Distribuidores con cédula: ${distribuidores.length}.`);

  await publicarEnRepoPrivado({
    actualizado: new Date().toISOString(),
    distribuidores,
    precios,
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
